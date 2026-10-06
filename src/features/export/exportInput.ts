import type { ArticleContext } from '../../types/project'

// Workflow timestamps change after export completion without changing the output.
export function articleExportInputKey(project: ArticleContext) {
  return JSON.stringify({
    id: project.project.id,
    articleId: project.article.id,
    title: project.article.title,
    source: project.article.inputMedia,
    sourceRange: project.article.sourceRange,
    transcription: project.article.transcription,
    slides: project.article.visualSegments,
    articleBlocks: project.article.blocks,
    article: project.article.document,
  })
}
