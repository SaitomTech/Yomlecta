import { getActiveArticle } from '../../lib/project/articleSelectors'
import { normalizeTrimRange } from './videoRange'
import type {
  CropRegion,
  ArticleContext,
  MediaSource,
  PerspectiveCrop,
  VideoTrimRange,
} from '../../types/project'

export type ArticleSourceContext = {
  source: MediaSource
  range: VideoTrimRange
  crop: CropRegion
  perspectiveCrop?: PerspectiveCrop
  usesOriginalVideo: boolean
}

function fullCrop(source: MediaSource): CropRegion {
  return {
    x: 0,
    y: 0,
    width: Math.max(1, source.metadata.width),
    height: Math.max(1, source.metadata.height),
  }
}

export function normalizeArticleCrop(
  requested: CropRegion,
  metadata: MediaSource['metadata'],
): CropRegion {
  const sourceWidth = Math.max(1, Math.round(metadata.width))
  const sourceHeight = Math.max(1, Math.round(metadata.height))
  const x = Math.min(sourceWidth - 1, Math.max(0, Math.round(requested.x)))
  const y = Math.min(sourceHeight - 1, Math.max(0, Math.round(requested.y)))
  const right = Math.min(sourceWidth, Math.max(x + 1, Math.round(requested.x + requested.width)))
  const bottom = Math.min(sourceHeight, Math.max(y + 1, Math.round(requested.y + requested.height)))
  return { x, y, width: right - x, height: bottom - y }
}

/**
 * Resolve the source used by processing and playback for the active article.
 * New reference articles point at the project video and keep their range/crop
 * as metadata; legacy prepared articles continue to use their prepared input.
 */
export function getActiveArticleSourceContext(project: ArticleContext): ArticleSourceContext {
  const article = getActiveArticle(project)
  const sourceVideo = article?.sourceVideoId
    ? project.project.videos.find((video) => video.id === article.sourceVideoId)
    : undefined
  const usesOriginalVideo = article?.inputMedia.preparation === 'reference' && Boolean(sourceVideo)
  const source = usesOriginalVideo ? sourceVideo!.media : project.article.inputMedia
  const duration = Math.max(1, source.metadata.durationMs)
  const range = normalizeTrimRange(
    usesOriginalVideo
      ? (article?.sourceRange ?? { startMs: 0, endMs: duration })
      : { startMs: 0, endMs: duration },
    duration,
  )
  const crop = normalizeArticleCrop(article?.crop ?? fullCrop(source), source.metadata)
  return {
    source,
    range,
    crop,
    ...(article?.perspectiveCrop ? { perspectiveCrop: article.perspectiveCrop } : {}),
    usesOriginalVideo,
  }
}

export function getActiveArticleDuration(project: ArticleContext) {
  const context = getActiveArticleSourceContext(project)
  return context.range.endMs - context.range.startMs
}
