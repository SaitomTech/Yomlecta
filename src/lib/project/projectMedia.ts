import { DEFAULT_SETTINGS } from './article'
import { extractVideoThumbnail } from '../media/ffmpeg'
import { copyFile, renameAbsolutePath } from '../tauri/filesystem'
import {
  getProjectVideoPath,
  getProjectVideoThumbnailPath,
  removeProjectVideoAssetDirectory,
  removeProjectVideoThumbnail,
} from '../storage/projectAssets'
import { normalizeTrimRange } from './videoRange'
import { normalizeArticleCrop } from './articleSource'
import type { SelectedVideo } from '../../features/import/types'
import { projectWithVideos } from './project'
import type {
  Article,
  ArticleInputMedia,
  CropRegion,
  Project,
  MediaSource,
  ProjectVideo,
  PerspectiveCrop,
  VideoTrimRange,
} from '../../types/project'

function relativeVideoPath(videoId: string, extension: string) {
  return `videos/${videoId}/original.${extension}`
}

function withManagedPath(source: MediaSource, path: string, managedRelativePath: string) {
  return {
    ...source,
    path,
    metadata: { ...source.metadata, path },
    ownership: 'managed' as const,
    managedRelativePath,
  }
}

export async function addProjectVideo(project: Project, selected: SelectedVideo) {
  if (!selected.metadata) throw new Error('動画メタデータがありません。')
  const youtubeOrigin = selected.origin?.kind === 'youtube' ? selected.origin : null
  if (
    youtubeOrigin &&
    project.videos.some(
      (video) =>
        video.media.origin?.kind === 'youtube' &&
        video.media.origin.videoId === youtubeOrigin.videoId,
    )
  ) {
    throw new Error('このYouTube動画は、すでにプロジェクトへ追加されています。')
  }
  const videoId = crypto.randomUUID()
  const extension = selected.extension
  try {
    const outputPath = await getProjectVideoPath(project.id, videoId, extension)
    const thumbnailPath = await getProjectVideoThumbnailPath(project.id, videoId)
    const relativePath = relativeVideoPath(videoId, extension)
    if (youtubeOrigin) {
      try {
        await renameAbsolutePath(selected.path, outputPath)
      } catch (error) {
        console.warn('YouTube動画を直接移動できなかったためコピーします。', error)
        await copyFile(selected.path, outputPath)
      }
    } else {
      await copyFile(selected.path, outputPath)
    }
    let hasThumbnail = false
    try {
      await extractVideoThumbnail(outputPath, thumbnailPath)
      hasThumbnail = true
    } catch (error) {
      console.warn('動画サムネイルを生成できませんでした', error)
      await removeProjectVideoThumbnail(project.id, videoId).catch(() => undefined)
    }
    const metadata = { ...selected.metadata, path: outputPath }
    const source: MediaSource = {
      path: outputPath,
      name: selected.name,
      extension,
      sizeBytes: selected.sizeBytes,
      metadata,
      origin: selected.origin ?? { kind: 'local-file' },
    }
    const now = new Date().toISOString()
    const video: ProjectVideo = {
      id: videoId,
      title: selected.name.replace(/\.[^.]+$/, ''),
      media: {
        ...withManagedPath(source, outputPath, relativePath),
        ...(hasThumbnail ? { thumbnailPath } : {}),
      },
      createdAt: now,
      updatedAt: now,
    }
    return { project: projectWithVideos(project, [...project.videos, video]), video }
  } catch (error) {
    try {
      await removeProjectVideoAssetDirectory(project.id, videoId)
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        '動画追加後の一時ファイル回収に失敗しました。',
      )
    }
    throw error
  }
}

export async function createArticleFromRange(
  project: Project,
  videoId: string,
  title: string,
  requestedRange: VideoTrimRange,
  requestedCrop: CropRegion,
  requestedPerspectiveCrop?: PerspectiveCrop,
): Promise<Article> {
  const video = project.videos.find((candidate) => candidate.id === videoId)
  if (!video) throw new Error('元動画が見つかりません。')
  const durationMs = video.media.metadata.durationMs
  const range = normalizeTrimRange(requestedRange, durationMs)
  const articleId = crypto.randomUUID()
  const crop = normalizeArticleCrop(requestedCrop, video.media.metadata)
  const now = new Date().toISOString()
  // Keep the project video as the canonical source.  Range and crop settings
  // are article-local metadata and are applied by the processing pipeline.
  const inputMedia: ArticleInputMedia = {
    ...video.media,
    preparedFromVideoId: video.id,
    preparation: 'reference',
    preparedAt: now,
  }
  return {
    id: articleId,
    title: title.trim() || `記事 ${project.articles.length + 1}`,
    sourceVideoId: video.id,
    inputMedia,
    sourceRange: range,
    crop,
    ...(requestedPerspectiveCrop ? { perspectiveCrop: requestedPerspectiveCrop } : {}),
    settings: DEFAULT_SETTINGS,
    visualSegments: [],
    blocks: [],
    workflow: {
      lastVisitedStep: 'crop',
      maxReachedStep: 'crop',
      lastOpenedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  }
}

export function createArticlesFromRanges(
  project: Project,
  videoId: string,
  ranges: Array<{
    title: string
    range: VideoTrimRange
  }>,
  crop: CropRegion,
  perspectiveCrop?: PerspectiveCrop,
) {
  return Promise.all(
    ranges.map((item) =>
      createArticleFromRange(project, videoId, item.title, item.range, crop, perspectiveCrop),
    ),
  )
}
