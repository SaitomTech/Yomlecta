import { useMemo, useRef, useState } from 'react'
import { getUserErrorMessage } from '../../../lib/errors'
import type {
  ArticleTranslation,
  ArticleTranslationLanguage,
  MediaProject,
} from '../../../types/project'
import {
  getCurrentArticleTranslation,
  isArticleTranslationFromEngine,
  runArticleTranslation,
  type TranslationEngineId,
  type TranslationProgress,
  type TranslationStage,
} from '../translation'

export type TranslationStatus = 'idle' | 'running' | 'completed' | 'cancelled' | 'error'

export function useArticleTranslation(
  project: MediaProject,
  engineId: TranslationEngineId,
  sourceLanguage: ArticleTranslationLanguage,
  targetLanguage: ArticleTranslationLanguage,
  onCompleted: (translation: ArticleTranslation) => void | Promise<void>,
  getCurrentProject?: () => MediaProject | null,
) {
  const [status, setStatus] = useState<TranslationStatus>('idle')
  const [stage, setStage] = useState<TranslationStage>('preparing-model')
  const [progress, setProgress] = useState<TranslationProgress>({
    stage: 'preparing-model',
    completed: 0,
    total: 0,
    stageProgress: null,
  })
  const [error, setError] = useState<string | null>(null)
  const activeController = useRef<AbortController | null>(null)
  const currentTranslation = useMemo(
    () => getCurrentArticleTranslation(project, targetLanguage, sourceLanguage),
    [project, sourceLanguage, targetLanguage],
  )

  async function generate(force = false): Promise<boolean> {
    if (activeController.current) return false
    const currentProject = getCurrentProject?.() ?? project
    const currentSavedTranslation = getCurrentArticleTranslation(
      currentProject,
      targetLanguage,
      sourceLanguage,
    )
    if (
      currentSavedTranslation &&
      isArticleTranslationFromEngine(currentSavedTranslation, engineId) &&
      !force
    ) {
      setStatus('completed')
      return true
    }

    const controller = new AbortController()
    activeController.current = controller
    setStatus('running')
    setStage('preparing-model')
    setProgress({ stage: 'preparing-model', completed: 0, total: 0, stageProgress: null })
    setError(null)

    try {
      const translation = await runArticleTranslation({
        project: currentProject,
        engineId,
        sourceLanguage,
        targetLanguage,
        signal: controller.signal,
        onProgress: (nextProgress) => {
          setStage(nextProgress.stage)
          setProgress(nextProgress)
        },
      })
      await onCompleted(translation)
      if (controller.signal.aborted) throw new DOMException('処理を中止しました。', 'AbortError')
      setStatus('completed')
      setProgress((current) => ({ ...current, completed: current.total, stageProgress: 1 }))
      return true
    } catch (translationError) {
      if (controller.signal.aborted) {
        setStatus('cancelled')
        setError(null)
      } else {
        console.error(translationError)
        setStatus('error')
        setError(
          getUserErrorMessage(
            translationError,
            '記事を翻訳できませんでした。言語設定と翻訳エンジンを確認して、再試行してください。',
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

  const isUpToDate = isArticleTranslationFromEngine(currentTranslation, engineId)
  const visibleStatus: TranslationStatus =
    status === 'running' || status === 'cancelled' || status === 'error'
      ? status
      : isUpToDate
        ? 'completed'
        : 'idle'

  return {
    status: visibleStatus,
    stage,
    progress,
    error,
    isUpToDate,
    currentTranslation,
    generate,
    cancel,
  }
}

export type ArticleTranslationController = ReturnType<typeof useArticleTranslation>
