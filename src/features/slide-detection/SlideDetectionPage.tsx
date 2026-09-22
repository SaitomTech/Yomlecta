import { ArrowRight, Check } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigationDisabled } from '../../app/navigationDisabled'
import { ArticleContextRow } from '../../components/ArticleContextRow'
import { WorkflowBar } from '../../components/WorkflowBar'
import { WorkflowPanelHeader } from '../../components/WorkflowPanelHeader'
import type { WorkflowStep } from '../../lib/workflow'
import type { MediaProject, SlideBoundary } from '../../types/project'
import { getActiveArticleSourceContext } from '../../lib/project/articleSource'
import { ArticleNavigationBar } from '../article/components/ArticleNavigationBar'
import { useSlideDetection } from './hooks/useSlideDetection'
import { buildSlideData } from './detection'
import { SlideDetectionResultPanel } from './components/SlideDetectionResultPanel'
import { SlideDetectionSettingsStatus } from './components/SlideDetectionSettingsStatus'
import type { SlideDetectionOutput } from './types'

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
  const [reviewBoundaries, setReviewBoundaries] = useState<SlideBoundary[] | null>(
    () => project.slideDetection?.boundaries ?? null,
  )
  const savedReviewBoundariesRef = useRef<SlideBoundary[] | null>(
    project.slideDetection?.boundaries ?? null,
  )
  const [threshold, setThreshold] = useState(
    project.slideDetection?.threshold ?? project.settings.slideDetection.threshold,
  )
  const [sampleIntervalMs, setSampleIntervalMs] = useState(
    project.slideDetection?.sampleIntervalMs ?? project.settings.slideDetection.sampleIntervalMs,
  )
  const [hasUnsavedReview, setHasUnsavedReview] = useState(false)
  const [isSavingReview, setIsSavingReview] = useState(false)
  const handleDetectionCompleted = useCallback(
    async (nextOutput: SlideDetectionOutput) => {
      setReviewBoundaries(nextOutput.result.boundaries)
      savedReviewBoundariesRef.current = nextOutput.result.boundaries
      setThreshold(nextOutput.result.threshold)
      setSampleIntervalMs(nextOutput.result.sampleIntervalMs)
      setHasUnsavedReview(false)
      await onCompleted(nextOutput)
    },
    [onCompleted],
  )

  const detection = useSlideDetection(project, { onCompleted: handleDetectionCompleted })
  const output = useMemo(
    () =>
      detection.output
        ? {
            result: {
              ...detection.output.result,
              boundaries: reviewBoundaries ?? detection.output.result.boundaries,
            },
            slides: buildSlideData(
              reviewBoundaries ?? detection.output.result.boundaries,
              durationMs,
              detection.output.slides,
            ),
          }
        : null,
    [detection.output, durationMs, reviewBoundaries],
  )
  const slides = output?.slides ?? []
  const boundaries = output?.result.boundaries ?? []
  const isRunning = detection.status === 'running'
  const isCompleted = detection.status === 'completed'
  const navigationDisabled = isRunning || isSavingReview || hasUnsavedReview
  useNavigationDisabled(navigationDisabled)

  const updateReviewBoundaries = useCallback((nextBoundaries: SlideBoundary[]) => {
    setReviewBoundaries(
      nextBoundaries.toSorted((first, second) => first.timestampMs - second.timestampMs),
    )
    setHasUnsavedReview(true)
  }, [])

  const saveReview = async () => {
    if (!output || !hasUnsavedReview) return
    setIsSavingReview(true)
    try {
      await onCompleted(output)
      savedReviewBoundariesRef.current = output.result.boundaries
      setHasUnsavedReview(false)
    } catch (saveError) {
      console.error(saveError)
    } finally {
      setIsSavingReview(false)
    }
  }

  const cancelReview = () => {
    setReviewBoundaries(savedReviewBoundariesRef.current)
    setHasUnsavedReview(false)
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
            description="画面の変化を比較して、スライド区間を自動で分けます。"
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
              onThresholdChange={setThreshold}
              onSampleIntervalChange={setSampleIntervalMs}
              onDetect={handleDetect}
            />

            {output && isCompleted && (
              <SlideDetectionResultPanel
                path={source.path}
                boundaries={boundaries}
                slides={slides}
                onChange={updateReviewBoundaries}
                durationMs={durationMs}
                timeOffsetMs={sourceContext.range.startMs}
              />
            )}
          </div>

          {hasUnsavedReview && (
            <div className="flex justify-end gap-2 border-t border-[#d8e1dc] px-5 py-4">
              <button
                className="inline-flex items-center rounded-[9px] px-3 py-2.5 text-xs font-semibold text-[#71807b] transition hover:bg-[#f1f6f2] hover:text-[#174d3c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={cancelReview}
                disabled={isSavingReview || isRunning}
              >
                修正をキャンセル
              </button>
              <button
                className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#b7cbc0] bg-[#fbfcfa] px-3 py-2.5 text-xs font-semibold text-[#1d6b50] transition hover:border-[#1d6b50] hover:bg-[#e2eee8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => void saveReview()}
                disabled={isSavingReview || isRunning}
              >
                <Check size={13} />
                {isSavingReview ? '保存中…' : '修正を保存'}
              </button>
            </div>
          )}

          {output && isCompleted && !hasUnsavedReview && (
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
