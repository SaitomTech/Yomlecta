import {
  assignedArticleSlides,
  currentBoundaryPlan,
  boundarySourceSlides,
  hasCurrentBoundaryDecisions,
} from '../../../lib/pipeline/transcriptBoundaries'
import { useEffect, useRef, useState } from 'react'
import { getUserErrorMessage } from '../../../lib/errors'
import type { ArticleModelId } from '../../../lib/article/articleModel'
import type { MediaProject, TranscriptBoundaryPlan } from '../../../types/project'
import {
  hasCurrentContent,
  runContentProcessing,
  type ContentProcessingProgress,
  type ContentProcessingSlideCompleted,
  type ContentProcessingSlideSkipped,
  type ContentProcessingStage,
} from '../contentProcessing'

export type ContentProcessingStatus = 'idle' | 'running' | 'completed' | 'cancelled' | 'error'

export function useContentProcessing(
  project: MediaProject,
  onSlideCompleted: ContentProcessingSlideCompleted,
  modelId: ArticleModelId,
  getCurrentProject: (() => MediaProject | null) | undefined,
  onBoundaryPlanCompleted: (plan: TranscriptBoundaryPlan) => Promise<void>,
) {
  const projectRef = useRef(project)
  useEffect(() => {
    projectRef.current = project
  }, [project])
  const contextSlides = assignedArticleSlides(project)
  const targetSlides = contextSlides.some((slide) => slide.transcript?.raw.trim())
    ? contextSlides
    : []
  const completedFromProject = targetSlides.filter((slide) =>
    hasCurrentContent(slide, modelId),
  ).length
  const plan = currentBoundaryPlan(project)
  const sourceSlides = boundarySourceSlides(project)
  const boundariesCurrent = hasCurrentBoundaryDecisions(plan, sourceSlides, modelId)
  const isUpToDate =
    boundariesCurrent && completedFromProject === targetSlides.length && targetSlides.length > 0
  const [status, setStatus] = useState<ContentProcessingStatus>('idle')
  const [stage, setStage] = useState<ContentProcessingStage>('preparing-model')
  const [progress, setProgress] = useState<ContentProcessingProgress>({
    completed: 0,
    total: 0,
    stageProgress: null,
  })
  const [boundaryFallbacks, setBoundaryFallbacks] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [skippedSlides, setSkippedSlides] = useState<
    Array<Parameters<ContentProcessingSlideSkipped>>
  >([])
  const lastRunForce = useRef(false)
  const activeController = useRef<AbortController | null>(null)

  function reset() {
    setStatus('idle')
    setError(null)
    setSkippedSlides([])
    setBoundaryFallbacks(0)
    setProgress({ completed: 0, total: 0, stageProgress: null })
    setStage('preparing-model')
  }

  async function process(force = false): Promise<boolean> {
    if (activeController.current) return false
    lastRunForce.current = force
    const controller = new AbortController()
    activeController.current = controller
    setStatus('running')
    setError(null)
    setSkippedSlides([])
    setBoundaryFallbacks(0)
    try {
      await runContentProcessing({
        project: getCurrentProject?.() ?? projectRef.current,
        modelId,
        signal: controller.signal,
        onStage: setStage,
        onProgress: setProgress,
        onBoundaryPlanCompleted,
        onBoundaryFallbacks: setBoundaryFallbacks,
        onSlideCompleted,
        onSlideSkipped: (slideId, slideIndex, reason) => {
          setSkippedSlides((current) => [...current, [slideId, slideIndex, reason]])
        },
        force,
      })
      setProgress((current) => ({ ...current, completed: current.total, stageProgress: 1 }))
      setStatus('completed')
      return true
    } catch (processingError) {
      if (controller.signal.aborted) {
        setStatus('cancelled')
        setError(null)
      } else {
        console.error(processingError)
        setStatus('error')
        setError(
          getUserErrorMessage(
            processingError,
            '記事本文の生成を完了できませんでした。アプリを再起動して、再試行してください。',
          ),
        )
      }
      return false
    } finally {
      if (activeController.current === controller) activeController.current = null
    }
  }

  function cancel() {
    activeController.current?.abort()
  }

  const visibleProgress =
    status === 'running' || status === 'cancelled' || (status === 'completed' && progress.total > 0)
      ? progress
      : {
          completed: completedFromProject,
          total: targetSlides.length,
          stageProgress: isUpToDate ? 1 : null,
        }
  const visibleStatus: ContentProcessingStatus =
    status === 'running' || status === 'cancelled' || status === 'completed' || status === 'error'
      ? status
      : isUpToDate
        ? 'completed'
        : 'idle'

  return {
    status: visibleStatus,
    stage,
    progress: visibleProgress,
    error,
    boundaryFallbacks,
    retry: () => process(lastRunForce.current),
    skippedSlides: skippedSlides.map(([, slideIndex, reason]) => ({ slideIndex, reason })),
    process,
    cancel,
    reset,
  }
}

export type ContentProcessingController = ReturnType<typeof useContentProcessing>
