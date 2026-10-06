import { useEffect, useRef, useState } from 'react'
import { getErrorDetail, withUserFacingError } from '../../../lib/errors'
import type { TranscriptionModelId } from '../../../lib/transcription/transcriptionModel'
import type { ArticleContext, TranscriptionResult } from '../../../types/project'
import {
  runTranscription,
  type TranscriptionChunkProgress,
  type TranscriptionLanguage,
  type TranscriptionStage,
} from '../transcription'

export type TranscriptionStatus = 'idle' | 'running' | 'completed' | 'cancelled' | 'error'

export function useTranscription(
  project: ArticleContext,
  modelId: TranscriptionModelId,
  onCompleted: (result: TranscriptionResult) => void | Promise<void>,
  getCurrentProject?: () => ArticleContext | null,
) {
  const projectRef = useRef(project)
  useEffect(() => {
    projectRef.current = project
  }, [project])
  const hasCurrentTranscription = project.article.transcription?.model === modelId
  const [status, setStatus] = useState<TranscriptionStatus>(
    hasCurrentTranscription ? 'completed' : 'idle',
  )
  const [stage, setStage] = useState<TranscriptionStage>('preparing-model')
  const [stageProgress, setStageProgress] = useState<number | null>(
    hasCurrentTranscription ? 1 : null,
  )
  const [chunkProgress, setChunkProgress] = useState<TranscriptionChunkProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [operationModelId, setOperationModelId] = useState<TranscriptionModelId>(modelId)
  const activeController = useRef<AbortController | null>(null)

  async function transcribe(language: TranscriptionLanguage): Promise<boolean> {
    if (activeController.current) return false

    const controller = new AbortController()
    activeController.current = controller
    setOperationModelId(modelId)
    setStatus('running')
    setStage('preparing-model')
    setStageProgress(null)
    setChunkProgress(null)
    setError(null)

    try {
      const result = await runTranscription({
        project: getCurrentProject?.() ?? projectRef.current,
        language,
        modelId,
        signal: controller.signal,
        onStage: (nextStage) => {
          setStage(nextStage)
          setStageProgress(null)
          setChunkProgress(null)
        },
        onProgress: setStageProgress,
        onChunkProgress: setChunkProgress,
      })
      setStage('saving')
      setStageProgress(null)
      setChunkProgress(null)
      await withUserFacingError(
        '文字起こし結果を保存できませんでした。空き容量を確認して、再試行してください。',
        () => onCompleted(result),
      )
      if (controller.signal.aborted) {
        throw new DOMException('処理を中止しました。', 'AbortError')
      }
      setStageProgress(1)
      setStatus('completed')
      return true
    } catch (transcriptionError) {
      if (controller.signal.aborted) {
        setStatus('cancelled')
        setError(null)
      } else {
        console.error(transcriptionError)
        setStatus('error')
        setError(
          getErrorDetail(
            transcriptionError,
            '文字起こしを完了できませんでした。アプリを再起動して、再試行してください。',
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

  const isOperationForSelectedModel = operationModelId === modelId
  const visibleStatus = isOperationForSelectedModel
    ? status
    : hasCurrentTranscription
      ? 'completed'
      : 'idle'
  const visibleStageProgress = isOperationForSelectedModel
    ? stageProgress
    : hasCurrentTranscription
      ? 1
      : null
  const visibleError = isOperationForSelectedModel ? error : null
  const visibleChunkProgress = isOperationForSelectedModel ? chunkProgress : null

  return {
    status: visibleStatus,
    stage,
    stageProgress: visibleStageProgress,
    chunkProgress: visibleChunkProgress,
    error: visibleError,
    transcribe,
    cancel,
  }
}
