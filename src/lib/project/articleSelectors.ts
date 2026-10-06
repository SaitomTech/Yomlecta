import type {
  Article,
  ArticleContext,
  ArticleMetadata,
  Project,
  ProjectArticleEntry,
} from '../../types/project'

export function articleMetadata(entry: ProjectArticleEntry): ArticleMetadata {
  if (entry.kind === 'metadata') return entry.metadata
  const {
    id,
    title,
    sourceVideoId,
    sourceRange,
    crop,
    perspectiveCrop,
    workflow,
    createdAt,
    updatedAt,
  } = entry.article
  const thumbnailPath =
    entry.article.visualSegments.find((segment) => segment.image.representativeFramePath)?.image
      .representativeFramePath ?? entry.article.inputMedia.thumbnailPath
  const thumbnailUrl =
    entry.article.inputMedia.origin?.kind === 'youtube'
      ? entry.article.inputMedia.origin.thumbnailUrl
      : undefined
  return {
    thumbnailPath,
    thumbnailUrl,
    id,
    title,
    sourceVideoId,
    sourceRange,
    crop,
    perspectiveCrop,
    workflow,
    createdAt,
    updatedAt,
  }
}

export function getLoadedArticle(project: Project): Article | null {
  return project.articles.find((entry) => entry.kind === 'loaded')?.article ?? null
}

export function requireLoadedArticle(project: Project): Article {
  const article = getLoadedArticle(project)
  if (!article) throw new Error('記事が選択されていません。')
  return article
}

export function articleContext(project: Project): ArticleContext {
  return { project, article: requireLoadedArticle(project) }
}

export function getActiveMediaSource(context: ArticleContext) {
  return context.article.inputMedia
}

export function getActiveArticle(context: ArticleContext) {
  return context.article
}

export function requireActiveArticleId(context: ArticleContext) {
  return context.article.id
}
