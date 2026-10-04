import type { MediaProject, SlideData, TranscriptBoundaryPlan } from '../../types/project'
import { articleBlockViews } from './articleBlocks'

export const BOUNDARY_VERSION = 'transcript-boundaries-v7-fragment-transfer-guidance'
const WINDOW = 600
const SOURCE_SEPARATOR = '\n\n'

export function boundarySourceSlides(project: Pick<MediaProject, 'slides' | 'articleBlocks'>) {
  return articleBlockViews(project.slides, project.articleBlocks)
}

export function boundarySource(slides: SlideData[]) {
  let sourceText = ''
  const originalRanges = slides.map((slide, index) => {
    const start = sourceText.length
    sourceText +=
      (slide.transcript?.raw ?? '') + (index < slides.length - 1 ? SOURCE_SEPARATOR : '')
    return { blockId: slide.id, start, end: sourceText.length }
  })
  return { sourceText, originalRanges }
}

export function boundarySourceFingerprint(slides: SlideData[]) {
  return JSON.stringify([
    BOUNDARY_VERSION,
    slides.map((slide) => [slide.id, slide.transcript?.raw ?? '']),
  ])
}

export function boundaryInputFingerprint(slides: SlideData[], index: number, model: string) {
  return JSON.stringify([
    BOUNDARY_VERSION,
    model,
    slides
      .slice(index, index + 2)
      .map((slide) => [slide.id, slide.transcript?.raw ?? '', slide.ocr?.rawText ?? '']),
  ])
}

export function createBoundaryPlan(slides: SlideData[]): TranscriptBoundaryPlan {
  const source = boundarySource(slides)
  return {
    version: BOUNDARY_VERSION,
    sourceFingerprint: boundarySourceFingerprint(slides),
    ...source,
    boundaries: source.originalRanges.slice(0, -1).map((range, index) => ({
      leftBlockId: range.blockId,
      rightBlockId: source.originalRanges[index + 1]!.blockId,
      originalOffset: range.end,
      resolvedOffset: range.end,
      status: 'unchanged',
      inputFingerprint: '',
    })),
  }
}

export function boundaryTransferOffset(
  plan: TranscriptBoundaryPlan,
  slides: SlideData[],
  index: number,
  decision: { move: 'keep' | 'left_to_right' | 'right_to_left'; text: string },
) {
  const original = plan.boundaries[index]!.originalOffset
  const input = boundaryContext(slides, index)
  if (decision.move === 'keep') {
    if (decision.text !== '') throw new Error('維持する境界に移動テキストがあります。')
    return original
  }
  if (!decision.text.trim()) throw new Error('移動する原文が空です。')
  if (decision.move === 'left_to_right') {
    if (!input.leftTranscript.endsWith(decision.text))
      throw new Error('移動テキストが左の原文末尾と一致しません。')
    // The synthetic separator belongs to the left original range.
    return original - SOURCE_SEPARATOR.length - decision.text.length
  }
  if (!input.rightTranscript.startsWith(decision.text))
    throw new Error('移動テキストが右の原文冒頭と一致しません。')
  return original + decision.text.length
}

export function validateBoundaryPlan(plan: TranscriptBoundaryPlan, slides: SlideData[]) {
  const expected = boundarySource(slides)
  if (
    plan.version !== BOUNDARY_VERSION ||
    plan.sourceFingerprint !== boundarySourceFingerprint(slides) ||
    plan.sourceText !== expected.sourceText ||
    JSON.stringify(plan.originalRanges) !== JSON.stringify(expected.originalRanges) ||
    plan.boundaries.length !== Math.max(0, slides.length - 1)
  )
    return false
  let previous = 0
  for (const [index, boundary] of plan.boundaries.entries()) {
    const offset = boundary.resolvedOffset
    if (
      boundary.leftBlockId !== slides[index]?.id ||
      boundary.rightBlockId !== slides[index + 1]?.id ||
      boundary.originalOffset !== expected.originalRanges[index]?.end ||
      !Number.isInteger(offset) ||
      offset < previous ||
      offset > plan.sourceText.length ||
      offset <
        Math.max(
          expected.originalRanges[index]!.start,
          boundary.originalOffset - WINDOW - SOURCE_SEPARATOR.length,
        ) ||
      offset >
        Math.min(expected.originalRanges[index + 1]!.end, boundary.originalOffset + WINDOW) ||
      (plan.sourceText.charCodeAt(offset - 1) >= 0xd800 &&
        plan.sourceText.charCodeAt(offset - 1) <= 0xdbff &&
        plan.sourceText.charCodeAt(offset) >= 0xdc00 &&
        plan.sourceText.charCodeAt(offset) <= 0xdfff)
    )
      return false
    previous = offset
  }
  return true
}

export function resolveBoundaryConflicts(plan: TranscriptBoundaryPlan) {
  const next = structuredClone(plan)
  // Returning conflicting neighbors to their original cuts converges because original cuts are ordered.
  let changed = true
  while (changed) {
    changed = false
    for (let index = 0; index < next.boundaries.length - 1; index++) {
      const left = next.boundaries[index]!
      const right = next.boundaries[index + 1]!
      if (left.resolvedOffset <= right.resolvedOffset) continue
      for (const boundary of [left, right]) {
        boundary.resolvedOffset = boundary.originalOffset
        boundary.status = 'fallback'
        boundary.reason = '隣り合う境界が逆転したため、元の位置へ戻しました。'
      }
      changed = true
    }
  }
  return next
}

export function boundaryPlanInputsCurrent(plan: TranscriptBoundaryPlan, slides: SlideData[]) {
  return (
    validateBoundaryPlan(plan, slides) &&
    plan.boundaries.every(
      (boundary, index) =>
        Boolean(boundary.model) &&
        boundary.inputFingerprint === boundaryInputFingerprint(slides, index, boundary.model!),
    )
  )
}

export function currentBoundaryPlan(project: MediaProject) {
  const slides = boundarySourceSlides(project)
  const plan = project.article?.boundaryPlan
  return plan && validateBoundaryPlan(plan, slides) ? plan : undefined
}

export function assignedTranscript(plan: TranscriptBoundaryPlan, index: number) {
  const start = index === 0 ? 0 : plan.boundaries[index - 1]!.resolvedOffset
  const end =
    index === plan.originalRanges.length - 1
      ? plan.sourceText.length
      : plan.boundaries[index]!.resolvedOffset
  return { start, end, text: plan.sourceText.slice(start, end) }
}

export function assignedArticleSlides(project: MediaProject, plan = currentBoundaryPlan(project)) {
  const slides = boundarySourceSlides(project)
  if (!plan) return slides
  return slides.map((slide, index) => ({
    ...slide,
    transcript: {
      ...slide.transcript,
      raw: assignedTranscript(plan, index).text.trim(),
      model: slide.transcript?.model ?? project.transcription?.model ?? 'boundary-assignment',
    },
  }))
}

function boundaryContext(slides: SlideData[], index: number) {
  return {
    leftOcr: slides[index]?.ocr?.rawText.slice(0, 800) ?? '',
    rightOcr: slides[index + 1]?.ocr?.rawText.slice(0, 800) ?? '',
    leftTranscript: (slides[index]?.transcript?.raw ?? '').slice(-WINDOW),
    rightTranscript: (slides[index + 1]?.transcript?.raw ?? '').slice(0, WINDOW),
  }
}

export function boundaryPrompt(slides: SlideData[], index: number) {
  return JSON.stringify(boundaryContext(slides, index))
}

export function hasCurrentBoundaryDecisions(
  plan: TranscriptBoundaryPlan | undefined,
  slides: SlideData[],
  model: string,
) {
  return Boolean(
    plan &&
    plan.boundaries.every(
      (boundary, index) =>
        boundary.status !== 'fallback' &&
        boundary.inputFingerprint === boundaryInputFingerprint(slides, index, model),
    ),
  )
}
