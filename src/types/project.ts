import type { VideoExtension } from './media'

export const PROJECT_VERSION = 11

export type ProjectStep = 'crop' | 'detect-slides' | 'generate-notes' | 'article-review' | 'export'
export type ProjectWorkflow = {
  lastVisitedStep: ProjectStep
  maxReachedStep: ProjectStep
  lastOpenedAt: string
  lastExportedAt?: string
}
export type MediaMetadata = {
  path: string
  durationMs: number
  width: number
  height: number
  fps?: number
  videoCodec?: string
  videoPixelFormat?: string
  audioCodec?: string
  formatName?: string
}
export type YoutubeImportQuality = '720p' | '1080p' | 'best'
export type MediaSourceOrigin =
  | { kind: 'local-file' }
  | {
      kind: 'youtube'
      originalUrl: string
      videoId: string
      canonicalUrl: string
      pageTitle?: string
      channelTitle?: string
      thumbnailUrl?: string
      importedAt: string
      downloader: { name: 'yt-dlp'; version: string }
      quality: YoutubeImportQuality
    }
export type MediaSource = {
  path: string
  name: string
  extension: VideoExtension
  sizeBytes?: number
  metadata: MediaMetadata
  origin?: MediaSourceOrigin
}
export type ManagedMedia = MediaSource & {
  ownership: 'managed'
  managedRelativePath: string
  thumbnailPath?: string
}
export type ProjectVideo = {
  id: string
  title: string
  media: ManagedMedia
  createdAt: string
  updatedAt: string
}
export type VideoTrimRange = { startMs: number; endMs: number }
/**
 * The media a generated article reads from.
 *
 * New articles reference the project-owned original video directly and keep
 * the preparation metadata used by the current processing pipeline.
 */
export type ArticleInputMedia = ManagedMedia & {
  preparedFromVideoId?: string
  preparation?: 'copy' | 'prepared' | 'reference'
  preparedAt?: string
}
export type CropRegion = { x: number; y: number; width: number; height: number }
export type NormalizedPoint = { x: number; y: number }
export type PerspectiveCorners = {
  topLeft: NormalizedPoint
  topRight: NormalizedPoint
  bottomRight: NormalizedPoint
  bottomLeft: NormalizedPoint
}
export type CropAspectRatio = { mode: '16:9' | '4:3' | 'estimated' | 'custom'; value: number }
export type PerspectiveCrop = {
  corners: PerspectiveCorners
  aspectRatio: CropAspectRatio
  transformVersion: 1
}
export type SlideBoundary = {
  id: string
  timestampMs: number
  distance: number
  source: 'auto' | 'manual'
}
export type SlideDetectionResult = {
  sampleIntervalMs: number
  threshold: number
  framesAnalyzed: number
  boundaries: SlideBoundary[]
  detectedAt: string
}
export type TranscriptSegment = { id: string; startMs: number; endMs: number; text: string }
export type TranscriptionKeywordChunk = { startMs: number; endMs: number; keywords: string[] }
export type TranscriptionKeywordContext = {
  chunks: TranscriptionKeywordChunk[]
  generatedAt: string
}
export type TranscriptionResult = {
  model: string
  provider?: 'local' | 'openai' | 'apple'
  engineVersion?: string
  language?: string
  audioPath: string
  segments: TranscriptSegment[]
  transcribedAt: string
  inputFingerprint: string
  keywordContext?: TranscriptionKeywordContext
}
export type SlideOcrResult = {
  rawText: string
  model: string
  provider?: 'local' | 'vision' | 'openai'
  blocks?: OcrTextBlock[]
  engineVersion?: string
  language?: string
  usage?: { inputTokens: number; outputTokens: number }
  requestId?: string
  inputFingerprint?: string
}
export type OcrTextBlock = {
  text: string
  confidence?: number
  polygon?: Array<{ x: number; y: number }>
}
export type ArticleFormattingResult = {
  body: string
  model: string
  inputFingerprint: string
  provider?: 'local' | 'openai' | 'apple'
  engineVersion?: string
  usage?: { inputTokens: number; outputTokens: number }
  requestId?: string
  generatedAt?: string
}
export type ArticleSummary = {
  overview: string
  mainMessage: string
  keyPoints: string[]
  keywords: string[]
  model: string
  inputFingerprint: string
}
export type ArticleSection = {
  id: string
  heading: string
  slideIds: string[]
}
export type ArticleSections = {
  sections: ArticleSection[]
  model: string
  inputFingerprint: string
  provider?: 'local' | 'openai' | 'apple'
  engineVersion?: string
  usage?: { inputTokens: number; outputTokens: number }
  requestId?: string
  generatedAt?: string
}
export type ContentProcessingResult = { article: ArticleFormattingResult }
export type ArticleData = {
  title: string
  summary?: ArticleSummary
  sections?: ArticleSections
}
export type ArticleDraft = { title: string; bodies: Record<string, string> }
export type SlideResultEdits = { ocrText: string; transcriptRaw: string; articleBody: string }
export type ProjectSettings = {
  slideDetection: { sampleIntervalMs: number; threshold: number }
  transcription: boolean
  ocr: boolean
  correction: boolean
  articleFormatting: boolean
}
export type SlideData = {
  id: string
  index: number
  startMs: number
  endMs: number
  detection: { source: 'auto' | 'manual'; hash?: string; distance?: number }
  image: { representativeFramePath?: string }
  ocr?: SlideOcrResult
  transcript?: {
    raw: string
    articleBody?: string
    articleModel?: string
    articleInputFingerprint?: string
    articleProvider?: 'local' | 'openai' | 'apple'
    articleEngineVersion?: string
    articleInputTokens?: number
    articleOutputTokens?: number
    articleRequestId?: string
    articleGeneratedAt?: string
    model: string
  }
}
export type Article = {
  id: string
  title: string
  sourceVideoId?: string
  inputMedia: ArticleInputMedia
  sourceRange: VideoTrimRange
  crop?: CropRegion
  perspectiveCrop?: PerspectiveCrop
  settings: ProjectSettings
  slides: SlideData[]
  slideDetection?: SlideDetectionResult
  transcription?: TranscriptionResult
  article?: ArticleData
  workflow: ProjectWorkflow
  createdAt: string
  updatedAt: string
}
export type ProjectHealth = 'ready' | 'source-missing' | 'needs-repair'
export type ProjectSummary = {
  projectVersion: number
  id: string
  title: string
  sourceName: string
  sourcePath: string
  extension: VideoExtension
  durationMs: number
  slideCount: number
  ocrCompleted: number
  articleCompleted: number
  articleTarget: number
  videoCount: number
  articleCount: number
  thumbnailPath?: string
  resumeStep: ProjectStep
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
  health: ProjectHealth
}
export type ProjectListEntry =
  | { kind: 'project'; summary: ProjectSummary }
  | { kind: 'invalid'; id: string; error: string }

export type ArticleListItem = {
  articleId: string
  projectId: string
  title: string
  projectTitle: string
  createdAt: string
  updatedAt: string
  lastVisitedStep: ProjectStep
  maxReachedStep: ProjectStep
}
/** Stable project fields retained by the SQLite-backed project DTO. */
export type PersistedProject = {
  version: number
  id: string
  title: string
  videos: ProjectVideo[]
  articles: Article[]
  activeArticleId?: string
  createdAt: string
  updatedAt: string
}

/** Root fields after the active article is materialized for the editor. */
export type ArticleWorkspace = PersistedProject & {
  source: MediaSource
  sourceRange?: VideoTrimRange
  crop?: CropRegion
  perspectiveCrop?: PerspectiveCrop
  settings: ProjectSettings
  slides: SlideData[]
  slideDetection?: SlideDetectionResult
  transcription?: TranscriptionResult
  article?: ArticleData
  workflow: ProjectWorkflow
}

/** @deprecated Use ArticleWorkspace for editor state and PersistedProject for storage. */
export type MediaProject = ArticleWorkspace

export function getActiveArticle(project: PersistedProject): Article | null {
  if (!project.activeArticleId) return null
  return project.articles.find((article) => article.id === project.activeArticleId) ?? null
}

export function requireActiveArticleId(project: PersistedProject) {
  if (!project.activeArticleId) throw new Error('記事が選択されていません。')
  return project.activeArticleId
}

export function getActiveMediaSource(project: MediaProject): MediaSource {
  return project.source
}
