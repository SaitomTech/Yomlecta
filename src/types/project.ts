import type { VideoExtension } from './media'

export const PROJECT_VERSION = 12

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
  visualClassifier?: {
    version: string
    personDetection: 'face-and-human'
    samplePolicy: 'adaptive-1-3-5' | 'adaptive-2-3-5'
    frameWidth: number
  }
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
export type ArticleTranslationEngine = 'apple-translation' | 'openai' | 'local'
export type ArticleTranslationLanguage = 'ja' | 'en'
export type ArticleOutputLanguage = 'ja' | 'en' | 'both'
export type ArticleTranslationSummary = Pick<
  ArticleSummary,
  'overview' | 'mainMessage' | 'keyPoints' | 'keywords'
>
export type ArticleTranslation = {
  sourceLanguage: ArticleTranslationLanguage
  targetLanguage: ArticleTranslationLanguage
  engine: ArticleTranslationEngine
  model: string
  inputFingerprint: string
  generatedAt: string
  title: string
  bodies: Record<string, string>
  summary?: ArticleTranslationSummary
  sections?: ArticleSection[]
}
export type ContentProcessingResult = { article: ArticleFormattingResult }
export type TranscriptBoundaryPlan = {
  version: string
  sourceFingerprint: string
  sourceText: string
  originalRanges: Array<{ blockId: string; start: number; end: number }>
  boundaries: Array<{
    leftBlockId: string
    rightBlockId: string
    originalOffset: number
    resolvedOffset: number
    status: 'accepted' | 'unchanged' | 'fallback'
    reason?: string
    inputFingerprint: string
    model?: string
  }>
}
export type ArticleData = {
  boundaryPlan?: TranscriptBoundaryPlan
  title: string
  summary?: ArticleSummary
  sections?: ArticleSections
  translations?: Record<string, ArticleTranslation>
  outputLanguage?: ArticleOutputLanguage
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
export type VisualSegmentKind = 'slide' | 'non-slide' | 'unknown'
export type PersonLayout = 'none' | 'inside-crop' | 'outside-crop' | 'both' | 'dominant'
type VisualClassificationEvidence = {
  samplesAnalyzed: number
  /** Legacy evidence from visual classifier v9 and earlier. */
  cropStableRatio?: number
  cropLongestStableRunRatio?: number
  cropLongestStableRunMs?: number
  cropMotionMedian: number
  textRegionCount?: number
  textRegionAreaRatio?: number
  facePresenceRatio: number
  humanPresenceRatio: number
  largestFaceAreaRatio: number
  largestHumanAreaRatio: number
  personOutsideCropRatio: number
  personCenterMotionMedian: number
  personAreaChangeMedian: number
  personBoxIouMedian: number
  faceLandmarkMotionMax?: number
}
export type VisualClassificationMetadata = {
  confidence: number
  classifierVersion: string
  visionEngineVersion?: string
  evidence: VisualClassificationEvidence
}
export type VisualSegment = {
  id: string
  index: number
  startMs: number
  endMs: number
  autoKind: VisualSegmentKind
  overrideKind?: VisualSegmentKind
  overrideUpdatedAt?: string
  personLayout: PersonLayout
  classification?: VisualClassificationMetadata
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
/** @deprecated Transitional UI name. Persisted rows live in visual_segments. */
export type SlideData = VisualSegment
export type ArticleBlock = {
  id: string
  index: number
  visualSegmentIds: string[]
  imageSegmentId?: string
  startMs: number
  endMs: number
  transcript?: VisualSegment['transcript']
}

export function effectiveVisualKind(segment: VisualSegment): VisualSegmentKind {
  return segment.overrideKind ?? segment.autoKind
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
  articleBlocks: ArticleBlock[]
  slideDetection?: SlideDetectionResult
  transcription?: TranscriptionResult
  article?: ArticleData
  workflow: ProjectWorkflow
  createdAt: string
  updatedAt: string
}
export type ProjectHealth = 'ready' | 'source-missing' | 'needs-repair'
export type ArticleListStatus = 'not-started' | 'working' | 'done'

export type PageInfo = {
  pageSize: number
  total: number
  hasNextPage: boolean
}

export type PagedResult<T> = {
  items: T[]
  pageInfo: PageInfo
  nextPageToken: string | null
}

export type ListPageOptions = {
  pageSize: number
  pageToken?: string
}

export type ListProjectsOptions = ListPageOptions & {
  query?: string
}

export type ListArticlesOptions = ListPageOptions & {
  query?: string
  status?: ArticleListStatus
}

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
  thumbnailPath?: string | null
  thumbnailUrl?: string | null
  articleId: string
  projectId: string
  title: string
  projectTitle: string
  createdAt: string
  updatedAt: string
  lastVisitedStep: ProjectStep
  maxReachedStep: ProjectStep
  status: ArticleListStatus
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
  articleBlocks: ArticleBlock[]
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
