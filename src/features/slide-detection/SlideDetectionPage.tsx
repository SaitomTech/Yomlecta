import { ArrowRight, Check } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useNavigationDisabled } from '../../app/navigationDisabled'
import { ArticleContextRow } from '../../components/ArticleContextRow'
import { WorkflowBar } from '../../components/WorkflowBar'
import { WorkflowPanelHeader } from '../../components/WorkflowPanelHeader'
import type { WorkflowStep } from '../../lib/workflow'
import { requireActiveArticleId, type MediaProject, type SlideBoundary } from '../../types/project'
import { getActiveArticleSourceContext } from '../../lib/project/articleSource'
import { ArticleNavigationBar } from '../article/components/ArticleNavigationBar'
import { useSlideDetection } from './hooks/useSlideDetection'
import { useSlideBoundaryPreviews } from './hooks/useSlideBoundaryPreviews'
import {
  buildSlideData,
  commitSlideDetectionOutput,
  createManualSlideDetectionOutput,
} from './detection'
import { SlideDetectionResultPanel } from './components/SlideDetectionResultPanel'
import { SlideDetectionSettingsStatus } from './components/SlideDetectionSettingsStatus'
import type { PendingSlideDetectionOutput, SlideDetectionOutput } from './types'
import { slideRangeKey } from './utils'

type SlideDetectionPageProps = {
  project: MediaProject
  onCompleted: (output: SlideDetectionOutput) => void | Promise<void>
  onContinue: () => void
  onBackToProject: () => void
  onOpenArticle: (articleId: string) => void | Promise<void>
  onSaveTitle: (title: string) => void | Promise<void>
  maxReachedStep: WorkflowStep
  onStepClick: (step: WorkflowStep) => void
}

export function SlideDetectionPage({
  project,
  onCompleted,
  onContinue,
  onBackToProject,
  onOpenArticle,
  onSaveTitle,
  maxReachedStep,
  onStepClick,
}: SlideDetectionPageProps) {
  const sourceContext = getActiveArticleSourceContext(project)
  const source = sourceContext.source
  const durationMs = sourceContext.range.endMs - sourceContext.range.startMs
  const slideIdPrefix = `slide-${requireActiveArticleId(project)}`
  const [reviewBoundaries, setReviewBoundaries] = useState<SlideBoundary[]>(
    () => project.slideDetection?.boundaries ?? [],
  )
  const [threshold, setThreshold] = useState(
    project.slideDetection?.threshold ?? project.settings.slideDetection.threshold,
  )
  const [sampleIntervalMs, setSampleIntervalMs] = useState(
    project.slideDetection?.sampleIntervalMs ?? project.settings.slideDetection.sampleIntervalMs,
  )
  const [hasUnsavedReview, setHasUnsavedReview] = useState(false)
  const [savedOutput, setSavedOutput] = useState<SlideDetectionOutput | null>(() =>
    project.slideDetection ? { result: project.slideDetection, slides: project.slides } : null,
  )
  const savedSlides = savedOutput?.slides ?? project.slides
  const hasSavedReview = Boolean(
    savedOutput &&
    savedSlides.length > 0 &&
    savedSlides.every((slide) => Boolean(slide.image.representativeFramePath)),
  )
  const [isSavingReview, setIsSavingReview] = useState(false)
  const [reviewSaveError, setReviewSaveError] = useState<string | null>(null)
  const baseSlides = useMemo(
    () =>
      buildSlideData(reviewBoundaries, durationMs, slideIdPrefix).map((slide) => {
        const savedSlide = savedSlides.find(
          (candidate) => slideRangeKey(candidate) === slideRangeKey(slide),
        )
        return savedSlide ? { ...slide, image: savedSlide.image } : slide
      }),
    [durationMs, reviewBoundaries, savedSlides, slideIdPrefix],
  )
  const { pathsByRange, preparingRanges, discardPreviews } = useSlideBoundaryPreviews(
    project,
    baseSlides,
    hasUnsavedReview && !isSavingReview,
  )
  const slides = useMemo(
    () =>
      baseSlides.map((slide) => {
        const previewPath = pathsByRange[slideRangeKey(slide)]
        return previewPath
          ? { ...slide, image: { ...slide.image, representativeFramePath: previewPath } }
          : slide
      }),
    [baseSlides, pathsByRange],
  )

  const applySavedOutput = useCallback((output: SlideDetectionOutput) => {
    setSavedOutput(output)
    setReviewBoundaries(output.result.boundaries)
    setThreshold(output.result.threshold)
    setSampleIntervalMs(output.result.sampleIntervalMs)
    setHasUnsavedReview(false)
  }, [])

  const discardPreviewsWithWarning = useCallback(
    async (logMessage: string, userMessage: string) => {
      try {
        await discardPreviews()
        return null
      } catch (cleanupError) {
        console.warn(logMessage, cleanupError)
        return userMessage
      }
    },
    [discardPreviews],
  )

  const handleDetectionCompleted = useCallback(
    async (pendingOutput: PendingSlideDetectionOutput) => {
      const nextOutput = await commitSlideDetectionOutput(project, pendingOutput, onCompleted)
      setReviewSaveError(null)
      applySavedOutput(nextOutput)
    },
    [applySavedOutput, onCompleted, project],
  )

  const detection = useSlideDetection(project, { onCompleted: handleDetectionCompleted })
  const isRunning = detection.status === 'running'
  const canContinue = hasSavedReview
  const showSaveReview = !isRunning && (hasUnsavedReview || !canContinue)
  const navigationDisabled = isRunning || isSavingReview || hasUnsavedReview
  useNavigationDisabled(navigationDisabled)

  const updateReviewBoundaries = useCallback((nextBoundaries: SlideBoundary[]) => {
    setReviewBoundaries(
      nextBoundaries.toSorted((first, second) => first.timestampMs - second.timestampMs),
    )
    setHasUnsavedReview(true)
    setReviewSaveError(null)
  }, [])

  const saveReview = async () => {
    if (!hasUnsavedReview && canContinue) return
    setIsSavingReview(true)
    try {
      const cleanupWarning = await discardPreviewsWithWarning(
        '保存前の一時画像を削除できませんでした。',
        '区間は保存しましたが、一時画像を削除できませんでした。',
      )
      const pendingOutput = await createManualSlideDetectionOutput({
        project,
        boundaries: reviewBoundaries,
        threshold,
        sampleIntervalMs,
      })
      const nextOutput = await commitSlideDetectionOutput(project, pendingOutput, onCompleted)
      setReviewSaveError(cleanupWarning)
      applySavedOutput(nextOutput)
    } catch (saveError) {
      console.error(saveError)
      const detail = saveError instanceof Error ? saveError.message : String(saveError)
      setReviewSaveError(`区間を保存できませんでした。${detail}`)
    } finally {
      setIsSavingReview(false)
    }
  }

  const cancelReview = async () => {
    setReviewBoundaries(savedOutput?.result.boundaries ?? [])
    setHasUnsavedReview(false)
    setReviewSaveError(
      await discardPreviewsWithWarning(
        'キャンセルした一時画像を削除できませんでした。',
        '修正はキャンセルしましたが、一時画像を削除できませんでした。',
      ),
    )
  }

  const handleDetect = () => detection.detect({ threshold, sampleIntervalMs })

  return (
    <main className="flex min-h-[calc(100svh-76px)] flex-col bg-[#f4f7f4] font-[Avenir_Next,Hiragino_Sans,Yu_Gothic,system-ui,sans-serif] text-[18px] leading-[1.45] tracking-[0.18px] text-[#18211f]">
      <div className="mx-auto flex min-h-[56px] w-[calc(100%-48px)] max-w-[1040px] items-center md:w-[calc(100%-11.6vw)]">
        <ArticleNavigationBar
          onBack={onBackToProject}
          disabled={isRunning || isSavingReview || hasUnsavedReview}
        />
      </div>
      <ArticleContextRow
        project={project}
        sourceName={source.name}
        onSelect={onOpenArticle}
        onSaveTitle={onSaveTitle}
        disabled={isRunning || isSavingReview || hasUnsavedReview}
      />

      <section className="mx-auto flex w-[calc(100%-48px)] max-w-[1040px] flex-1 flex-col pb-12 md:w-[calc(100%-11.6vw)]">
        <WorkflowBar
          activeStep="detect-slides"
          maxReachedStep={maxReachedStep}
          onStepClick={onStepClick}
          disabled={isRunning || isSavingReview || hasUnsavedReview}
        />
        <div className="overflow-hidden rounded-[18px] border border-[#b7cbc0] bg-[#fbfcfa] shadow-[0_18px_52px_rgba(22,54,42,0.07)]">
          <WorkflowPanelHeader
            eyebrow="02 / DETECT SLIDES"
            title="スライド区間を検出"
            description="画面の変化から区間を自動検出します。解析前でもタイムラインから手動で追加・調整できます。"
          />

          <div className="p-5 md:p-7">
            <SlideDetectionSettingsStatus
              threshold={threshold}
              sampleIntervalMs={sampleIntervalMs}
              status={detection.status}
              stage={detection.stage}
              stageProgress={detection.stageProgress}
              error={detection.error}
              isSaving={isSavingReview}
              isReviewDirty={hasUnsavedReview}
              onThresholdChange={setThreshold}
              onSampleIntervalChange={setSampleIntervalMs}
              onDetect={handleDetect}
            />

            {!isRunning && (
              <SlideDetectionResultPanel
                path={source.path}
                boundaries={reviewBoundaries}
                slides={slides}
                onChange={updateReviewBoundaries}
                preparingRanges={preparingRanges}
                durationMs={durationMs}
                timeOffsetMs={sourceContext.range.startMs}
                disabled={isSavingReview}
              />
            )}
          </div>

          {showSaveReview && (
            <div className="flex justify-end gap-2 border-t border-[#d8e1dc] px-5 py-4">
              {hasUnsavedReview && (
                <button
                  className="inline-flex items-center rounded-[9px] px-3 py-2.5 text-xs font-semibold text-[#71807b] transition hover:bg-[#f1f6f2] hover:text-[#174d3c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={() => void cancelReview()}
                  disabled={isSavingReview || isRunning}
                >
                  修正をキャンセル
                </button>
              )}
              <button
                className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#b7cbc0] bg-[#fbfcfa] px-3 py-2.5 text-xs font-semibold text-[#1d6b50] transition hover:border-[#1d6b50] hover:bg-[#e2eee8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => void saveReview()}
                disabled={isSavingReview || isRunning}
              >
                <Check size={13} />
                {isSavingReview ? '保存中…' : hasUnsavedReview ? '修正を保存' : '区間を保存'}
              </button>
            </div>
          )}

          {reviewSaveError && (
            <p className="border-t border-[#d8e1dc] bg-[#fff5f1] px-5 py-3 text-xs text-[#9d422d]">
              {reviewSaveError}
            </p>
          )}

          {canContinue && !hasUnsavedReview && (
            <div className="flex justify-end border-t border-[#d8e1dc] px-5 py-4">
              <button
                className="inline-flex items-center gap-2 rounded-[9px] bg-[#1d6b50] px-4 py-3 text-xs font-semibold text-[#f3faf6] shadow-[0_7px_16px_rgba(29,107,80,0.17)] transition hover:bg-[#174d3c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 focus-visible:ring-offset-2"
                type="button"
                onClick={onContinue}
              >
                文字起こしとOCRへ
                <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
