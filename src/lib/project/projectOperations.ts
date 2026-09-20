import type { SelectedVideo } from '../../features/import/types'
import type {
  CropRegion,
  MediaProject,
  PerspectiveCrop,
  ProjectVideo,
  VideoTrimRange,
} from '../../types/project'
import { addProjectVideo, createArticlesFromRanges } from './projectMedia'
import { projectWithArticle, syncActiveArticle } from './project'
import {
  checkStorageReference,
  createArticles,
  createProjectBundle,
  createVideoAndUpdateProject,
  updateArticleWorkflow,
  updateProject,
} from '../storage/projectStorage'
import {
  removeArticleAssetDirectory,
  removeProjectVideoAssetDirectory,
} from '../storage/projectAssets'

export async function persistProjectWorkflow(project: MediaProject) {
  const synced = syncActiveArticle(project)
  const activeArticle = synced.activeArticleId
    ? synced.articles.find((article) => article.id === synced.activeArticleId)
    : undefined
  if (activeArticle) await updateArticleWorkflow(synced, activeArticle)
  else await updateProject(synced)
  return synced
}

export async function renameProject(project: MediaProject, title: string) {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('プロジェクト名を入力してください。')
  const next = { ...project, title: trimmed, updatedAt: new Date().toISOString() }
  await updateProject(next)
  return next
}

export async function createProjectFromVideo(
  project: MediaProject,
  selectedVideo: SelectedVideo,
): Promise<{ project: MediaProject; video: ProjectVideo }> {
  const added = await addProjectVideo(project, selectedVideo)
  try {
    const metadata = added.video.media.metadata
    const article = (
      await createArticlesFromRanges(
        added.project,
        added.video.id,
        [{ title: added.video.title, range: { startMs: 0, endMs: metadata.durationMs } }],
        { x: 0, y: 0, width: metadata.width, height: metadata.height },
      )
    )[0]
    if (!article) throw new Error('記事作成フローを開始できませんでした。')
    const nextProject = projectWithArticle(
      { ...added.project, articles: [...added.project.articles, article] },
      article,
    )
    await createProjectBundle(nextProject, added.video, article)
    return { project: nextProject, video: added.video }
  } catch (error) {
    const reference = await checkStorageReference('project', project.id).catch(() => null)
    if (reference?.referenced === false)
      await removeProjectVideoAssetDirectory(project.id, added.video.id).catch(() => undefined)
    throw error
  }
}

export async function addVideoToProject(
  project: MediaProject,
  selectedVideo: SelectedVideo,
): Promise<{ project: MediaProject; video: ProjectVideo }> {
  const added = await addProjectVideo(project, selectedVideo)
  try {
    await createVideoAndUpdateProject(added.project, added.video)
    return { project: added.project, video: added.video }
  } catch (error) {
    const reference = await checkStorageReference('video', project.id, added.video.id).catch(
      () => null,
    )
    if (reference?.referenced === false)
      await removeProjectVideoAssetDirectory(project.id, added.video.id).catch(() => undefined)
    throw error
  }
}

export async function addArticlesToProject(
  project: MediaProject,
  videoId: string,
  ranges: Array<{ title: string; range: VideoTrimRange }>,
  crop: CropRegion,
  perspectiveCrop?: PerspectiveCrop,
) {
  const created = await createArticlesFromRanges(project, videoId, ranges, crop, perspectiveCrop)
  if (created.length === 0) throw new Error('記事を作成できませんでした。')
  const nextProject: MediaProject = {
    ...project,
    articles: [...project.articles, ...created],
    updatedAt: new Date().toISOString(),
  }
  try {
    await createArticles(nextProject, created)
    return { project: nextProject, articles: created }
  } catch (error) {
    for (const article of created) {
      const reference = await checkStorageReference('article', project.id, article.id).catch(
        () => null,
      )
      if (reference?.referenced === false)
        await removeArticleAssetDirectory(project.id, article.id).catch(() => undefined)
    }
    throw error
  }
}
