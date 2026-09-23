import { useRef, useState } from 'react'
import { getUserErrorMessage } from '../../../lib/errors'
import type { ArticleModelId } from '../../../lib/article/articleModel'
import type { ArticleSummary, MediaProject } from '../../../types/project'
import { hasCurrentArticleSummary } from '../article'
import { runArticleSummaryGeneration } from '../summaryGenerator'

export type ArticleSummaryStatus = 'idle' | 'running' | 'completed' | 'cancelled' | 'error'
export type ArticleSummaryStage = 'preparing-model' | 'generating'

export function useArticleSummary(
  project: MediaProject,
  modelId: ArticleModelId,
  onCompleted: (summary: ArticleSummary) => void | Promise<void>,
  getCurrentProject?: () => MediaProject | null,
) {
  const articleSlides = project.slides.filter((slide) => slide.transcript)
  const hasAllArticleBodies =
    articleSlides.length > 0 &&
    articleSlides.every((slide) => slide.transcript?.articleBody?.trim())
  const isUpToDate = hasCurrentArticleSummary(project, modelId)
  const [status, setStatus] = useState<ArticleSummaryStatus>('idle')
  const [stage, setStage] = useState<ArticleSummaryStage>('preparing-model')
  const [stageProgress, setStageProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const activeController = useRef<AbortController | null>(null)

  async function generate(force = false): Promise<boolean> {
    if (activeController.current) return false
    const currentProject = getCurrentProject?.() ?? project
    const currentArticleSlides = currentProject.slides.filter((slide) => slide.transcript)
    const currentHasAllArticleBodies =
      currentArticleSlides.length > 0 &&
      currentArticleSlides.every((slide) => slide.transcript?.articleBody?.trim())
    const currentIsUpToDate = hasCurrentArticleSummary(currentProject, modelId)
    if (!currentHasAllArticleBodies) {
      setStatus('error')
      setError('Slide本文をすべて生成してから、文書全体の要約を作成してください。')
      return false
    }
    if (currentIsUpToDate && !force) {
      setStatus('completed')
      return true
    }

    const controller = new AbortController()
    activeController.current = controller
    setStatus('running')
    setStage('preparing-model')
    setStageProgress(null)
    setError(null)

    try {
      const summary = await runArticleSummaryGeneration({
        project: currentProject,
        modelId,
        signal: controller.signal,
        onPreparationProgress: setStageProgress,
        onReady: () => {
          setStage('generating')
          setStageProgress(null)
        },
      })
      await onCompleted(summary)
      if (controller.signal.aborted) {
        throw new DOMException('処理を中止しました。', 'AbortError')
      }
      setStageProgress(1)
      setStatus('completed')
      return true
    } catch (generationError) {
      if (controller.signal.aborted) {
        setStatus('cancelled')
        setError(null)
      } else {
        console.error(generationError)
        setStatus('error')
        setError(
          getUserErrorMessage(
            generationError,
            '文書全体の要約を生成できませんでした。設定と入力内容を確認して、再試行してください。',
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

  const visibleStatus: ArticleSummaryStatus =
    status === 'running' || status === 'cancelled' || status === 'completed' || status === 'error'
      ? status
      : isUpToDate
        ? 'completed'
        : 'idle'

  return {
    status: visibleStatus,
    stage,
    stageProgress,
    error,
    isUpToDate,
    hasAllArticleBodies,
    generate,
    cancel,
  }
}

export type ArticleSummaryController = ReturnType<typeof useArticleSummary>
