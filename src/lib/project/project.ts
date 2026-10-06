import { PROJECT_VERSION, type Article, type Project, type ProjectVideo } from '../../types/project'
import { articleMetadata } from './articleSelectors'

export function createEmptyProject(
  title: string,
  projectId: string = crypto.randomUUID(),
): Project {
  const now = new Date().toISOString()
  return {
    version: PROJECT_VERSION,
    id: projectId,
    title: title.trim() || '無題のプロジェクト',
    videos: [],
    articles: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function replaceLoadedArticle(project: Project, article: Article): Project {
  let found = false
  const entries = project.articles.map((entry) => {
    if (articleMetadata(entry).id === article.id) {
      found = true
      return { kind: 'loaded' as const, article }
    }
    return entry.kind === 'loaded'
      ? { kind: 'metadata' as const, metadata: articleMetadata(entry) }
      : entry
  })
  if (!found) throw new Error('記事が見つかりません。')
  return { ...project, articles: entries }
}

export function projectWithVideos(project: Project, videos: ProjectVideo[]): Project {
  return { ...project, videos, updatedAt: new Date().toISOString() }
}
