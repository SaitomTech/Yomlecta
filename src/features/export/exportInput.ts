import type { MediaProject } from '../../types/project'

// Workflow timestamps change after export completion without changing the output.
export function articleExportInputKey(project: MediaProject) {
  return JSON.stringify({
    id: project.id,
    articleId: project.activeArticleId,
    title: project.articles.find((article) => article.id === project.activeArticleId)?.title,
    source: project.source,
    sourceRange: project.sourceRange,
    transcription: project.transcription,
    slides: project.slides,
    articleBlocks: project.articleBlocks,
    article: project.article,
  })
}
