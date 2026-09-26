import { z } from 'zod'
import {
  PROJECT_VERSION,
  type MediaProject,
  type PersistedProject,
  type ProjectSettings,
} from '../types/project'

const IsoDateSchema = z.iso.datetime()
const IdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/)
const ManagedRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith('/') &&
      !path.includes('\\') &&
      !path.split('/').some((segment) => !segment || segment === '.' || segment === '..'),
    '管理対象の相対パスが不正です。',
  )
const VideoExtensionSchema = z.enum(['mp4', 'webm', 'mov', 'mkv', 'm4v'])

const MediaMetadataSchema = z.strictObject({
  path: z.string().min(1),
  durationMs: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
  fps: z.number().positive().optional(),
  videoCodec: z.string().min(1).optional(),
  videoPixelFormat: z.string().min(1).optional(),
  audioCodec: z.string().min(1).optional(),
  formatName: z.string().min(1).optional(),
})

const YoutubeImportQualitySchema = z.enum(['720p', '1080p', 'best'])

const MediaSourceOriginSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('local-file') }),
  z.strictObject({
    kind: z.literal('youtube'),
    originalUrl: z.url(),
    videoId: z.string().min(1),
    canonicalUrl: z.url(),
    pageTitle: z.string().min(1).optional(),
    channelTitle: z.string().min(1).optional(),
    thumbnailUrl: z.url().optional(),
    importedAt: IsoDateSchema,
    downloader: z.strictObject({ name: z.literal('yt-dlp'), version: z.string().min(1) }),
    quality: YoutubeImportQualitySchema,
  }),
])

const MediaSourceSchema = z.strictObject({
  path: z.string().min(1),
  name: z.string().min(1),
  extension: VideoExtensionSchema,
  sizeBytes: z.number().nonnegative().optional(),
  metadata: MediaMetadataSchema,
  origin: MediaSourceOriginSchema.default({ kind: 'local-file' }),
})

const ManagedMediaSchema = MediaSourceSchema.extend({
  ownership: z.literal('managed'),
  managedRelativePath: ManagedRelativePathSchema,
  thumbnailPath: z.string().min(1).optional(),
})

const ProjectVideoSchema = z.strictObject({
  id: IdSchema,
  title: z.string().min(1),
  media: ManagedMediaSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})

const ArticleInputMediaSchema = ManagedMediaSchema.extend({
  preparedFromVideoId: IdSchema.optional(),
  preparation: z.enum(['copy', 'prepared', 'reference']).optional(),
  preparedAt: IsoDateSchema.optional(),
})

const VideoTrimRangeSchema = z
  .strictObject({
    startMs: z.number().nonnegative(),
    endMs: z.number().nonnegative(),
  })

  .refine((range) => range.endMs > range.startMs, '動画範囲が不正です。')

const CropRegionSchema = z.strictObject({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
})

const PerspectivePointSchema = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})

const PerspectiveCropSchema = z.strictObject({
  corners: z.strictObject({
    topLeft: PerspectivePointSchema,
    topRight: PerspectivePointSchema,
    bottomRight: PerspectivePointSchema,
    bottomLeft: PerspectivePointSchema,
  }),
  aspectRatio: z.strictObject({
    mode: z.enum(['16:9', '4:3', 'estimated', 'custom']),
    value: z.number().positive(),
  }),
  transformVersion: z.literal(1),
})

const SlideBoundarySchema = z.strictObject({
  id: IdSchema,
  timestampMs: z.number().nonnegative(),
  distance: z.number().nonnegative(),
  source: z.enum(['auto', 'manual']),
})

const SlideDetectionResultSchema = z.strictObject({
  sampleIntervalMs: z.number().positive(),
  threshold: z.number().nonnegative(),
  framesAnalyzed: z.number().int().nonnegative(),
  boundaries: z.array(SlideBoundarySchema),
  detectedAt: IsoDateSchema,
})

const TranscriptSegmentSchema = z
  .strictObject({
    id: z.string().min(1),
    startMs: z.number().nonnegative(),
    endMs: z.number().nonnegative(),
    text: z.string(),
  })

  .refine((segment) => segment.endMs >= segment.startMs, '文字起こし区間が不正です。')

const TranscriptionKeywordChunkSchema = z
  .strictObject({
    startMs: z.number().nonnegative(),
    endMs: z.number().nonnegative(),
    keywords: z.array(z.string()),
  })

  .refine((chunk) => chunk.endMs >= chunk.startMs, 'キーワード区間が不正です。')

const TranscriptionKeywordContextSchema = z.strictObject({
  chunks: z.array(TranscriptionKeywordChunkSchema),
  generatedAt: IsoDateSchema,
})

const TranscriptionResultSchema = z.strictObject({
  model: z.string().min(1),
  provider: z.enum(['local', 'openai', 'apple']).optional(),
  engineVersion: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
  audioPath: z.string().min(1),
  segments: z.array(TranscriptSegmentSchema),
  transcribedAt: IsoDateSchema,
  inputFingerprint: z.string().min(1),
  keywordContext: TranscriptionKeywordContextSchema.optional(),
})

const OcrTextBlockSchema = z.strictObject({
  text: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  polygon: z
    .array(z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
    .optional(),
})

const SlideOcrResultSchema = z.strictObject({
  rawText: z.string(),
  model: z.string().min(1),
  provider: z.enum(['local', 'vision', 'openai']).optional(),
  blocks: z.array(OcrTextBlockSchema).optional(),
  engineVersion: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
  usage: z
    .strictObject({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    })

    .optional(),
  requestId: z.string().min(1).optional(),
  inputFingerprint: z.string().min(1).optional(),
})

const ProjectSettingsSchema = z.strictObject({
  slideDetection: z.strictObject({
    sampleIntervalMs: z.number().positive(),
    threshold: z.number().nonnegative(),
  }),
  transcription: z.boolean(),
  ocr: z.boolean(),
  correction: z.boolean(),
  articleFormatting: z.boolean(),
})

const SlideTranscriptSchema = z.strictObject({
  raw: z.string(),
  articleBody: z.string().optional(),
  articleModel: z.string().min(1).optional(),
  articleInputFingerprint: z.string().min(1).optional(),
  articleProvider: z.enum(['local', 'openai', 'apple']).optional(),
  articleEngineVersion: z.string().min(1).optional(),
  articleInputTokens: z.number().int().nonnegative().optional(),
  articleOutputTokens: z.number().int().nonnegative().optional(),
  articleRequestId: z.string().min(1).optional(),
  articleGeneratedAt: IsoDateSchema.optional(),
  model: z.string().min(1),
})

const SlideDataSchema = z
  .strictObject({
    id: IdSchema,
    index: z.number().int().nonnegative(),
    startMs: z.number().nonnegative(),
    endMs: z.number().nonnegative(),
    detection: z.strictObject({
      source: z.enum(['auto', 'manual']),
      hash: z.string().min(1).optional(),
      distance: z.number().nonnegative().optional(),
    }),
    image: z.strictObject({ representativeFramePath: z.string().min(1).optional() }),
    ocr: SlideOcrResultSchema.optional(),
    transcript: SlideTranscriptSchema.optional(),
  })

  .refine((slide) => slide.endMs >= slide.startMs, 'スライド区間が不正です。')

const ArticleSummarySchema = z.strictObject({
  overview: z.string(),
  mainMessage: z.string(),
  keyPoints: z.array(z.string()),
  keywords: z.array(z.string()),
  model: z.string().min(1),
  inputFingerprint: z.string().min(1),
})

const ArticleSectionSchema = z.strictObject({
  id: z.string().min(1),
  heading: z.string().min(1),
  slideIds: z.array(IdSchema).min(1),
})

const ArticleSectionsSchema = z.strictObject({
  sections: z.array(ArticleSectionSchema).min(1),
  model: z.string().min(1),
  inputFingerprint: z.string().min(1),
  provider: z.enum(['local', 'openai', 'apple']).optional(),
  engineVersion: z.string().min(1).optional(),
  usage: z
    .strictObject({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    })
    .optional(),
  requestId: z.string().min(1).optional(),
  generatedAt: IsoDateSchema.optional(),
})

const ArticleTranslationSchema = z.strictObject({
  sourceLanguage: z.enum(['ja', 'en']),
  targetLanguage: z.enum(['ja', 'en']),
  engine: z.enum(['apple-translation', 'openai', 'local']),
  model: z.string().min(1),
  inputFingerprint: z.string().min(1),
  generatedAt: IsoDateSchema,
  title: z.string(),
  bodies: z.record(z.string(), z.string()),
  summary: z
    .strictObject({
      overview: z.string(),
      mainMessage: z.string(),
      keyPoints: z.array(z.string()),
      keywords: z.array(z.string()),
    })
    .optional(),
  sections: z.array(ArticleSectionSchema).optional(),
})

const ArticleDataSchema = z.strictObject({
  title: z.string().min(1),
  summary: ArticleSummarySchema.optional(),
  sections: ArticleSectionsSchema.optional(),
  translations: z.record(z.string(), ArticleTranslationSchema).optional(),
  outputLanguage: z.enum(['ja', 'en', 'both']).optional(),
})

const ProjectWorkflowSchema = z.strictObject({
  lastVisitedStep: z.enum(['crop', 'detect-slides', 'generate-notes', 'article-review', 'export']),
  maxReachedStep: z.enum(['crop', 'detect-slides', 'generate-notes', 'article-review', 'export']),
  lastOpenedAt: IsoDateSchema,
  lastExportedAt: IsoDateSchema.optional(),
})

const ArticleSchema = z.strictObject({
  id: IdSchema,
  title: z.string().min(1),
  sourceVideoId: z.string().min(1).optional(),
  inputMedia: ArticleInputMediaSchema,
  sourceRange: VideoTrimRangeSchema,
  crop: CropRegionSchema.optional(),
  perspectiveCrop: PerspectiveCropSchema.optional(),
  settings: ProjectSettingsSchema,
  slides: z.array(SlideDataSchema),
  slideDetection: SlideDetectionResultSchema.optional(),
  transcription: TranscriptionResultSchema.optional(),
  article: ArticleDataSchema.optional(),
  workflow: ProjectWorkflowSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})

const ProjectFileSchema = z
  .strictObject({
    version: z.literal(PROJECT_VERSION),
    id: IdSchema,
    title: z.string().min(1),
    videos: z.array(ProjectVideoSchema),
    articles: z.array(ArticleSchema),
    activeArticleId: IdSchema.optional(),
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema,
  })

  .superRefine((project, context) => {
    const videoIds = new Set<string>()
    for (const video of project.videos) {
      if (videoIds.has(video.id)) {
        context.addIssue({ code: 'custom', path: ['videos'], message: '動画IDが重複しています。' })
      }
      videoIds.add(video.id)
    }

    const articleIds = new Set<string>()
    for (const article of project.articles) {
      if (articleIds.has(article.id)) {
        context.addIssue({
          code: 'custom',
          path: ['articles'],
          message: '記事IDが重複しています。',
        })
      }
      articleIds.add(article.id)
      if (article.sourceVideoId && !videoIds.has(article.sourceVideoId)) {
        context.addIssue({
          code: 'custom',
          path: ['articles'],
          message: '記事の参照元動画が見つかりません。',
        })
      }
    }
    if (project.activeArticleId && !articleIds.has(project.activeArticleId)) {
      context.addIssue({
        code: 'custom',
        path: ['activeArticleId'],
        message: '選択中の記事が見つかりません。',
      })
    }
  })

const DEFAULT_SETTINGS: ProjectSettings = {
  slideDetection: { sampleIntervalMs: 500, threshold: 12 },
  transcription: true,
  ocr: true,
  correction: true,
  articleFormatting: true,
}

const EMPTY_SOURCE = {
  path: '',
  name: '',
  extension: 'mp4' as const,
  metadata: { path: '', durationMs: 0, width: 1, height: 1 },
  origin: { kind: 'local-file' as const },
}

function workspaceFor(project: PersistedProject): MediaProject {
  const article = project.activeArticleId
    ? project.articles.find((candidate) => candidate.id === project.activeArticleId)
    : undefined
  const video = project.videos[0]
  return {
    ...project,
    source: article?.inputMedia ?? video?.media ?? EMPTY_SOURCE,
    sourceRange: article?.sourceRange,
    crop: article?.crop,
    perspectiveCrop: article?.perspectiveCrop,
    settings: article?.settings ?? DEFAULT_SETTINGS,
    slides: article?.slides ?? [],
    ...(article?.slideDetection ? { slideDetection: article.slideDetection } : {}),
    ...(article?.transcription ? { transcription: article.transcription } : {}),
    ...(article?.article ? { article: article.article } : {}),
    workflow: article?.workflow ?? {
      lastVisitedStep: 'detect-slides',
      maxReachedStep: 'detect-slides',
      lastOpenedAt: project.updatedAt,
    },
  }
}

export function parseMediaProject(value: unknown): MediaProject {
  const parsed = ProjectFileSchema.parse(value)
  return workspaceFor(parsed)
}
