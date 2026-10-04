import { getArticleModel, type ArticleModelId } from '../../lib/article/articleModel'
import { mapWithConcurrency } from '../../lib/async/mapWithConcurrency'
import { withUserFacingError, UserFacingError } from '../../lib/errors'
import type {
  ContentProcessingResult,
  MediaProject,
  TranscriptBoundaryPlan,
} from '../../types/project'
import { articleInputFingerprint, hasCurrentArticle } from '../article/article'
import { createArticleGenerator, type ArticleGenerator } from './articleGenerator'
import {
  assignedArticleSlides,
  boundarySourceSlides,
  currentBoundaryPlan,
  hasCurrentBoundaryDecisions,
} from '../../lib/pipeline/transcriptBoundaries'
import { adjustTranscriptBoundaries } from './boundaryAdjustment'

export type ContentProcessingStage = 'preparing-model' | 'adjusting-boundaries' | 'processing'

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
  onBoundaryPlanCompleted: (plan: TranscriptBoundaryPlan) => Promise<void>
  onBoundaryFallbacks?: (count: number) => void
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

export async function runContentProcessing(
  {
    project,
    modelId,
    onStage,
    onProgress,
    onBoundaryPlanCompleted,
    onBoundaryFallbacks,
    onSlideCompleted,
    onSlideSkipped,
    signal,
    force = false,
  }: RunContentProcessingInput,
  generatorOverride?: ArticleGenerator,
) {
  const sourceSlides = boundarySourceSlides(project)

  if (!sourceSlides.some((slide) => slide.transcript?.raw.trim())) {
    throw new UserFacingError('処理する文字起こしがありません。先に文字起こしを実行してください。')
  }
  const existingPlan = currentBoundaryPlan(project)
  const assignedSlides = assignedArticleSlides(project, existingPlan)
  const boundariesCurrent = hasCurrentBoundaryDecisions(existingPlan, sourceSlides, modelId)
  if (
    !force &&
    boundariesCurrent &&
    assignedSlides.every((slide) => hasCurrentContent(slide, modelId))
  ) {
    onProgress?.({
      completed: assignedSlides.length,
      total: assignedSlides.length,
      stageProgress: 1,
    })
    return
  }
  const generator =
    generatorOverride ??
    createArticleGenerator(getArticleModel(modelId), project.transcription?.language)
  onProgress?.({ completed: 0, total: sourceSlides.length, stageProgress: null })

  throwIfAborted(signal)
  onStage?.('preparing-model')
  await withUserFacingError(generator.failureMessage, () =>
    generator.run({
      signal,
      onPreparationProgress: (stageProgress) =>
        onProgress?.({ completed: 0, total: sourceSlides.length, stageProgress }),
      work: async (generate, selectBoundary) => {
        onStage?.('adjusting-boundaries')
        const plan = await adjustTranscriptBoundaries({
          slides: sourceSlides,
          previous: existingPlan,
          modelId,
          selectBoundary,
          concurrency: generator.maxConcurrentRequests,
          signal,
          onProgress: (completed, total) =>
            onProgress?.({ completed, total, stageProgress: total === 0 ? 1 : completed / total }),
        })
        throwIfAborted(signal)
        await withUserFacingError(
          '文字起こしの区切りを保存できませんでした。再試行してください。',
          () => onBoundaryPlanCompleted(plan),
        )
        throwIfAborted(signal)

        onBoundaryFallbacks?.(
          plan.boundaries.filter((boundary) => boundary.status === 'fallback').length,
        )
        const targetSlides = assignedArticleSlides(project, plan)

        const pendingSlides = force
          ? targetSlides
          : targetSlides.filter((slide) => !hasCurrentContent(slide, modelId))
        let completed = targetSlides.length - pendingSlides.length
        const report = (stageProgress: number | null) =>
          onProgress?.({ completed, total: targetSlides.length, stageProgress })
        onStage?.('processing')
        report(null)
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
              const result = slide.transcript?.raw.trim()
                ? await generate(slide, signal)
                : {
                    article: {
                      body: '',
                      model: modelId,
                      inputFingerprint: articleInputFingerprint(slide, modelId),
                      generatedAt: new Date().toISOString(),
                      provider: getArticleModel(modelId).provider,
                    },
                  }
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
