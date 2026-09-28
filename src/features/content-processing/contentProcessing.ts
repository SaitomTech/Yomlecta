import { getArticleModel, type ArticleModelId } from '../../lib/article/articleModel'
import { mapWithConcurrency } from '../../lib/async/mapWithConcurrency'
import { withUserFacingError, UserFacingError } from '../../lib/errors'
import type { ContentProcessingResult, MediaProject } from '../../types/project'
import { hasCurrentArticle } from '../article/article'
import { createArticleGenerator } from './articleGenerator'
import { articleBlockViews } from '../../lib/pipeline/articleBlocks'

export type ContentProcessingStage = 'preparing-model' | 'processing'

export type ContentProcessingProgress = {
  completed: number
  total: number
  stageProgress: number | null
}

export type ContentProcessingSlideCompleted = (
  results: Array<{ slideId: string; result: ContentProcessingResult }>,
) => void | Promise<void>

export type ContentProcessingSlideSkipped = (
  slideId: string,
  slideIndex: number,
  reason: 'unsupported-language',
) => void

type RunContentProcessingInput = {
  project: MediaProject
  modelId: ArticleModelId
  onStage?: (stage: ContentProcessingStage) => void
  onProgress?: (progress: ContentProcessingProgress) => void
  onSlideCompleted: ContentProcessingSlideCompleted
  onSlideSkipped?: ContentProcessingSlideSkipped
  signal?: AbortSignal
  force?: boolean
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('処理を中止しました。', 'AbortError')
}

export function hasCurrentContent(slide: MediaProject['slides'][number], modelId: ArticleModelId) {
  return hasCurrentArticle(slide, modelId)
}

export async function runContentProcessing({
  project,
  modelId,
  onStage,
  onProgress,
  onSlideCompleted,
  onSlideSkipped,
  signal,
  force = false,
}: RunContentProcessingInput) {
  const generator = createArticleGenerator(
    getArticleModel(modelId),
    project.transcription?.language,
  )
  const targetSlides = articleBlockViews(project.slides, project.articleBlocks).filter((slide) =>
    slide.transcript?.raw.trim(),
  )
  if (targetSlides.length === 0) {
    throw new UserFacingError('処理する文字起こしがありません。先に文字起こしを実行してください。')
  }

  const pendingSlides = force
    ? targetSlides
    : targetSlides.filter((slide) => !hasCurrentContent(slide, modelId))
  let completed = targetSlides.length - pendingSlides.length
  const report = (stageProgress: number | null) => {
    onProgress?.({ completed, total: targetSlides.length, stageProgress })
  }

  report(pendingSlides.length === 0 ? 1 : null)
  if (pendingSlides.length === 0) return

  throwIfAborted(signal)
  onStage?.('preparing-model')
  await withUserFacingError(generator.failureMessage, () =>
    generator.run({
      signal,
      onPreparationProgress: report,
      onReady: () => {
        onStage?.('processing')
        report(null)
      },
      work: async (generate) => {
        // Generation can run concurrently, but project updates must stay ordered because
        // each completion callback reads and writes the current project snapshot.
        let completionTail = Promise.resolve()
        const batch: Array<{
          slideId: string
          slideIndex: number
          result: ContentProcessingResult
        }> = []
        const flush = async () => {
          if (batch.length === 0) return
          const pending = batch.splice(0)
          await withUserFacingError(
            `Slide ${pending[0].slideIndex + 1}以降の解析結果を保存できませんでした。空き容量を確認して、再試行してください。`,
            () => onSlideCompleted(pending.map(({ slideId, result }) => ({ slideId, result }))),
          )
          completed += pending.length
          report(null)
        }
        const completeSlide = (
          slide: (typeof pendingSlides)[number],
          result: ContentProcessingResult | undefined,
        ) => {
          const completion = completionTail.then(async () => {
            throwIfAborted(signal)
            if (!result) {
              onSlideSkipped?.(slide.id, slide.index, 'unsupported-language')
              completed += 1
              report(null)
            } else {
              batch.push({ slideId: slide.id, slideIndex: slide.index, result })
              if (batch.length >= 8) await flush()
            }
            throwIfAborted(signal)
          })
          completionTail = completion
          return completion
        }

        try {
          await mapWithConcurrency(
            pendingSlides,
            generator.maxConcurrentRequests,
            async (slide) => {
              const result = await generate(slide, signal)
              await completeSlide(slide, result)
            },
            signal,
          )
        } finally {
          await completionTail
          await flush()
        }
      },
    }),
  )
}
