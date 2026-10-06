import { UserFacingError, withUserFacingError } from '../../lib/errors'
import type { ArticleSections, ArticleSummary, MediaProject } from '../../types/project'
import { hasAllSpeechArticleBodies, hasCurrentArticleSections } from '../article/article'
import { runArticleSectionGeneration } from '../article/sectionGenerator'
import { runArticleSummaryGeneration } from '../article/summaryGenerator'
import { runContentProcessing, type ContentProcessingStage } from './contentProcessing'

export type ArticleContentProcessingStage =
  | ContentProcessingStage
  | 'preparing-sections'
  | 'generating-sections'
  | 'preparing-summary'
  | 'generating-summary'

type Input = Omit<Parameters<typeof runContentProcessing>[0], 'onStage'> & {
  includeSummary: boolean
  onSummaryCompleted: (summary: ArticleSummary) => void | Promise<void>
  getCurrentProject: () => MediaProject | null
  onSectionsCompleted: (sections: ArticleSections) => void | Promise<void>
  onStage?: (stage: ArticleContentProcessingStage) => void
}

export async function runArticleContentProcessing(
  input: Input,
  runners = {
    processContent: runContentProcessing,
    generateSections: runArticleSectionGeneration,
    generateSummary: runArticleSummaryGeneration,
  },
) {
  const throwIfAborted = () => {
    if (input.signal?.aborted) throw new DOMException('処理を中止しました。', 'AbortError')
  }
  await runners.processContent(input)
  throwIfAborted()
  input.onStage?.('preparing-sections')
  input.onProgress?.({ completed: 0, total: 1, stageProgress: null })
  const project = input.getCurrentProject()
  if (!project || project.activeArticleId !== input.project.activeArticleId) {
    throw new UserFacingError('編集中の記事が変更されました。本文生成を再実行してください。')
  }
  if (!hasAllSpeechArticleBodies(project)) {
    throw new UserFacingError(
      '本文が未生成の区間があるため、セクション構成を生成できませんでした。使用モデルと入力内容を確認して、再試行してください。',
    )
  }
  if (input.force || !hasCurrentArticleSections(project, input.modelId)) {
    const sections = await runners.generateSections({
      project,
      modelId: input.modelId,
      signal: input.signal,
      onPreparationProgress: (stageProgress) =>
        input.onProgress?.({ completed: 0, total: 1, stageProgress }),
      onReady: () => {
        input.onStage?.('generating-sections')
        input.onProgress?.({ completed: 0, total: 1, stageProgress: null })
      },
    })
    throwIfAborted()
    await withUserFacingError('セクション構成を保存できませんでした。再試行してください。', () =>
      input.onSectionsCompleted(sections),
    )
    throwIfAborted()
  }

  if (!input.includeSummary) return
  throwIfAborted()
  input.onStage?.('preparing-summary')
  input.onProgress?.({ completed: 0, total: 1, stageProgress: null })
  const currentProject = input.getCurrentProject()
  if (!currentProject || currentProject.activeArticleId !== input.project.activeArticleId) {
    throw new UserFacingError('編集中の記事が変更されました。生成を再実行してください。')
  }
  const summary = await runners.generateSummary({
    project: currentProject,
    modelId: input.modelId,
    signal: input.signal,
    onPreparationProgress: (stageProgress) =>
      input.onProgress?.({ completed: 0, total: 1, stageProgress }),
    onReady: () => {
      input.onStage?.('generating-summary')
      input.onProgress?.({ completed: 0, total: 1, stageProgress: null })
    },
  })
  throwIfAborted()
  await withUserFacingError('要約を保存できませんでした。再試行してください。', () =>
    input.onSummaryCompleted(summary),
  )
  throwIfAborted()
}
