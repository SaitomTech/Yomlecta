import { useRef, useState } from 'react'
import { getUserErrorMessage } from '../../../lib/errors'
import type { ArticleModelId } from '../../../lib/article/articleModel'
import type { ArticleSections, MediaProject } from '../../../types/project'
import { hasCurrentArticleSections } from '../article'
import { runArticleSectionGeneration } from '../sectionGenerator'

export type ArticleSectionsStatus = 'idle' | 'running' | 'completed' | 'cancelled' | 'error'
export type ArticleSectionsStage = 'preparing-model' | 'generating'

export function useArticleSections(
  project: MediaProject,
  modelId: ArticleModelId,
  onCompleted: (sections: ArticleSections) => void | Promise<void>,
  getCurrentProject?: () => MediaProject | null,
) {
  const articleSlides = project.slides.filter((slide) => slide.transcript)
  const hasAllArticleBodies =
    articleSlides.length > 0 &&
    articleSlides.every((slide) => slide.transcript?.articleBody?.trim())
  const isUpToDate = hasCurrentArticleSections(project, modelId)
  const [status, setStatus] = useState<ArticleSectionsStatus>('idle')
  const [stage, setStage] = useState<ArticleSectionsStage>('preparing-model')
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
    const currentIsUpToDate = hasCurrentArticleSections(currentProject, modelId)
    if (!currentHasAllArticleBodies) {
      setStatus('error')
      setError('Slide本文をすべて生成してから、セクション構成を作成してください。')
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
      const sections = await runArticleSectionGeneration({
        project: currentProject,
        modelId,
        signal: controller.signal,
        onPreparationProgress: setStageProgress,
        onReady: () => {
          setStage('generating')
          setStageProgress(null)
        },
      })
      await onCompleted(sections)
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
            'セクションを生成できませんでした。設定と入力内容を確認して、再試行してください。',
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

  const visibleStatus: ArticleSectionsStatus =
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

export type ArticleSectionsController = ReturnType<typeof useArticleSections>
