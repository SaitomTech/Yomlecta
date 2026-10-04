import type { SlideData, TranscriptBoundaryPlan } from '../../types/project'
import { mapWithConcurrency } from '../../lib/async/mapWithConcurrency'
import {
  boundaryTransferOffset,
  boundaryInputFingerprint,
  boundaryPrompt,
  createBoundaryPlan,
  resolveBoundaryConflicts,
  validateBoundaryPlan,
} from '../../lib/pipeline/transcriptBoundaries'
import type { SelectBoundary } from './articleGenerator'

export async function adjustTranscriptBoundaries({
  slides,
  previous,
  modelId,
  selectBoundary,
  concurrency,
  signal,
  onProgress,
}: {
  slides: SlideData[]
  previous?: TranscriptBoundaryPlan
  modelId: string
  selectBoundary: SelectBoundary
  concurrency: number
  signal?: AbortSignal
  onProgress?: (completed: number, total: number) => void
}): Promise<TranscriptBoundaryPlan> {
  const plan = createBoundaryPlan(slides)
  const reusable = previous && validateBoundaryPlan(previous, slides) ? previous : undefined
  let completed = 0
  onProgress?.(0, plan.boundaries.length)
  await mapWithConcurrency(
    plan.boundaries,
    concurrency,
    async (boundary, index) => {
      if (signal?.aborted) throw new DOMException('処理を中止しました。', 'AbortError')
      const fingerprint = boundaryInputFingerprint(slides, index, modelId)
      const cached = reusable?.boundaries[index]

      if (cached?.inputFingerprint === fingerprint && cached.status !== 'fallback') {
        Object.assign(boundary, cached)
      } else {
        boundary.inputFingerprint = fingerprint
        boundary.model = modelId
        try {
          const decision = await selectBoundary(boundaryPrompt(slides, index), signal)

          boundary.resolvedOffset = boundaryTransferOffset(plan, slides, index, decision)
          boundary.reason = decision.reason
          boundary.status = decision.move === 'keep' ? 'unchanged' : 'accepted'
        } catch (error) {
          if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError'))
            throw error

          boundary.status = 'fallback'
        }
      }
      completed++
      onProgress?.(completed, plan.boundaries.length)
    },
    signal,
  )
  const resolved = resolveBoundaryConflicts(plan)

  if (!validateBoundaryPlan(resolved, slides))
    throw new Error('文字起こしの区切りを検証できませんでした。')
  return resolved
}
