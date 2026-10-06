import { UserFacingError, withUserFacingError } from '../../lib/errors'
import type { ArticleSections, MediaProject } from '../../types/project'
import { hasAllSpeechArticleBodies, hasCurrentArticleSections } from '../article/article'
import { runArticleSectionGeneration } from '../article/sectionGenerator'
import { runContentProcessing, type ContentProcessingStage } from './contentProcessing'

export type ArticleContentProcessingStage =
  | ContentProcessingStage
  | 'preparing-sections'
  | 'generating-sections'

type Input = Omit<Parameters<typeof runContentProcessing>[0], 'onStage'> & {
  getCurrentProject: () => MediaProject | null
  onSectionsCompleted: (sections: ArticleSections) => void | Promise<void>
  onStage?: (stage: ArticleContentProcessingStage) => void
}

export async function runArticleContentProcessing(
  input: Input,
  runners = { processContent: runContentProcessing, generateSections: runArticleSectionGeneration },
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
  if (!input.force && hasCurrentArticleSections(project, input.modelId)) return
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
