import { expect, test } from 'bun:test'
import type { ArticleBlockView } from '../src/types/project'
import {
  assignedTranscript,
  createBoundaryPlan,
  validateBoundaryPlan,
  boundaryPlanInputsCurrent,
} from '../src/lib/pipeline/transcriptBoundaries'
import { adjustTranscriptBoundaries } from '../src/features/content-processing/boundaryAdjustment'
import type { BoundaryDecision } from '../src/features/content-processing/articleGenerator'
function slides(...texts: string[]): ArticleBlockView[] {
  return texts.map((raw, index) => ({
    id: `slide-${index}`,
    index,
    startMs: index * 1000,
    endMs: (index + 1) * 1000,
    autoKind: 'slide',
    personLayout: 'none',
    detection: { source: 'auto' },
    image: {},
    transcript: { raw, model: 'test' },
  }))
}
function rejoin(plan: ReturnType<typeof createBoundaryPlan>) {
  return plan.originalRanges.map((_, index) => assignedTranscript(plan, index).text).join('')
}

async function adjust(input: ArticleBlockView[], decision: BoundaryDecision) {
  let calls = 0
  const plan = await adjustTranscriptBoundaries({
    slides: input,
    modelId: 'test',
    concurrency: 2,
    selectBoundary: async () => {
      calls++
      return decision
    },
  })
  expect(calls).toBe(input.length - 1)
  expect(validateBoundaryPlan(plan, input)).toBe(true)
  expect(rejoin(plan)).toBe(createBoundaryPlan(input).sourceText)
  return plan
}
test('左末尾の導入を右へ移し、全発話を一度ずつ維持する', async () => {
  const plan = await adjust(slides('Overview. Next, the method is', 'recording temperature.'), {
    move: 'left_to_right',
    text: 'Next, the method is',
    reason: '導入をまとめる',
  })
  expect(assignedTranscript(plan, 0).text.trim()).toBe('Overview.')
  expect(assignedTranscript(plan, 1).text.trim()).toBe(
    'Next, the method is\n\nrecording temperature.',
  )
})
test('右冒頭の文末を左に取り込む', async () => {
  const plan = await adjust(slides('測定は', '3回繰り返しました。では結果です。'), {
    move: 'right_to_left',
    text: '3回繰り返しました。',
    reason: '文を完結する',
  })
  expect(assignedTranscript(plan, 0).text.trim()).toBe('測定は\n\n3回繰り返しました。')
  expect(assignedTranscript(plan, 1).text).toBe('では結果です。')
})
test('改変・途中の引用・空の移動・keepの移動テキストを拒否する', async () => {
  for (const decision of [
    { move: 'left_to_right', text: 'Next the method is' },
    { move: 'right_to_left', text: 'temperature' },
    { move: 'left_to_right', text: '' },
    { move: 'keep', text: 'anything' },
  ] as Array<Omit<BoundaryDecision, 'reason'>>) {
    const plan = await adjust(slides('Overview. Next, the method is', 'recording temperature.'), {
      ...decision,
      reason: 'test',
    })
    expect(plan.boundaries[0]!.status).toBe('fallback')
    expect(plan.boundaries[0]!.resolvedOffset).toBe(plan.boundaries[0]!.originalOffset)
  }
})
test('一ブロック・空のブロック・Unicodeも保持する', async () => {
  await adjust(slides('単独😀'), { move: 'keep', text: '', reason: '維持' })
  await adjust(slides('', '日本語😀'), { move: 'keep', text: '', reason: '維持' })
  const plan = await adjust(slides('説明。次は😀', 'の例です。'), {
    move: 'left_to_right',
    text: '次は😀',
    reason: '導入',
  })
  expect(assignedTranscript(plan, 1).text).toBe('次は😀\n\nの例です。')
})
test('隣り合う移動が逆転したら元の区切りに戻す', async () => {
  const input = slides('A', 'middle', 'C')
  const plan = await adjustTranscriptBoundaries({
    slides: input,
    modelId: 'test',
    concurrency: 2,
    selectBoundary: async (prompt) =>
      JSON.parse(prompt).leftTranscript === 'A'
        ? { move: 'right_to_left', text: 'middle', reason: 'test' }
        : { move: 'left_to_right', text: 'middle', reason: 'test' },
  })
  expect(plan.boundaries.every((b) => b.status === 'fallback')).toBe(true)
  expect(rejoin(plan)).toBe(createBoundaryPlan(input).sourceText)
})
test('キャッシュは同じ入力だけ再利用し、OCR変更で無効になる', async () => {
  const input = slides('左。', '右。')
  const plan = await adjust(input, { move: 'keep', text: '', reason: '維持' })
  await adjustTranscriptBoundaries({
    slides: input,
    previous: plan,
    modelId: 'test',
    concurrency: 1,
    selectBoundary: async () => {
      throw new Error('must not call')
    },
  })
  expect(boundaryPlanInputsCurrent(plan, input)).toBe(true)
  input[0] = { ...input[0]!, ocr: { rawText: '変更', model: 'test' } }
  expect(boundaryPlanInputsCurrent(plan, input)).toBe(false)
})
test('中止をfallbackにせず伝播する', async () => {
  const controller = new AbortController()
  controller.abort()
  expect(
    adjustTranscriptBoundaries({
      slides: slides('A', 'B'),
      modelId: 'test',
      concurrency: 1,
      signal: controller.signal,
      selectBoundary: async () => ({ move: 'keep', text: '', reason: '維持' }),
    }),
  ).rejects.toThrow()
})
