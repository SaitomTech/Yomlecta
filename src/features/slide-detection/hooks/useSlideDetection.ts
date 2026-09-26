import { useCallback, useState } from 'react'
import { runSlideDetection } from '../detection'
import type { MediaProject } from '../../../types/project'
import type { PendingSlideDetectionOutput, SlideDetectionStage } from '../types'

export type SlideDetectionStatus = 'idle' | 'running' | 'completed' | 'error'

function hasRepresentativeFrames(project: MediaProject) {
  return (
    project.slides.length > 0 &&
    project.slides.every((slide) => Boolean(slide.image.representativeFramePath))
  )
}

function hasPersistedAutomaticDetection(project: MediaProject) {
  return Boolean(
    project.slideDetection &&
    project.slideDetection.framesAnalyzed > 0 &&
    hasRepresentativeFrames(project),
  )
}

type UseSlideDetectionOptions = {
  onCompleted: (output: PendingSlideDetectionOutput) => void | Promise<void>
}

export type SlideDetectionParameters = {
  threshold?: number
  sampleIntervalMs?: number
}

export function useSlideDetection(
  project: MediaProject,
  { onCompleted }: UseSlideDetectionOptions,
) {
  const hasPersistedResult = hasPersistedAutomaticDetection(project)
  const [status, setStatus] = useState<SlideDetectionStatus>(
    hasPersistedResult ? 'completed' : 'idle',
  )
  const [stage, setStage] = useState<SlideDetectionStage>(
    hasPersistedResult ? 'completed' : 'preparing',
  )
  const [stageProgress, setStageProgress] = useState<number | null>(hasPersistedResult ? 1 : null)
  const [error, setError] = useState<string | null>(null)

  const detect = useCallback(
    async ({ threshold, sampleIntervalMs }: SlideDetectionParameters = {}) => {
      setStatus('running')
      setStage('preparing')
      setStageProgress(null)
      setError(null)

      try {
        const nextOutput = await runSlideDetection({
          project,
          threshold,
          sampleIntervalMs,
          onStage: (nextStage) => {
            setStage(nextStage)
            setStageProgress(null)
          },
          onProgress: setStageProgress,
        })
        setStage('saving')
        setStageProgress(null)
        await onCompleted(nextOutput)
        setStage('completed')
        setStageProgress(1)
        setStatus('completed')
      } catch (detectionError) {
        console.error(detectionError)
        setStatus('error')
        const detail =
          detectionError instanceof Error ? detectionError.message : String(detectionError)
        setError(`スライドを検出できませんでした。${detail}`)
      }
    },
    [onCompleted, project],
  )

  return {
    status,
    stage,
    stageProgress,
    error,
    detect,
  }
}
