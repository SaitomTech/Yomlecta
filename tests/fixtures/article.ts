import { createEmptyProject, replaceLoadedArticle } from '../../src/lib/project/project'
import { DEFAULT_SETTINGS } from '../../src/lib/project/article'
import { articleBlockViews } from '../../src/lib/pipeline/articleBlocks'
import type { Article, ArticleContext } from '../../src/types/project'

export function createArticleFixture(
  projectId = 'project-1',
  articleId = 'article-1',
): ArticleContext {
  const now = '2026-09-15T00:00:00.000Z'
  const media = {
    path: '/tmp/lecture.mp4',
    name: 'lecture.mp4',
    extension: 'mp4' as const,
    metadata: { path: '/tmp/lecture.mp4', durationMs: 10000, width: 1920, height: 1080 },
    origin: { kind: 'local-file' as const },
    ownership: 'managed' as const,
    managedRelativePath: 'videos/video-1/original.mp4',
    thumbnailPath: '/tmp/lecture.jpg',
  }
  const article: Article = {
    id: articleId,
    title: 'article',
    sourceVideoId: 'video-1',
    inputMedia: {
      ...media,
      preparation: 'reference',
      preparedFromVideoId: 'video-1',
      preparedAt: now,
    },
    sourceRange: { startMs: 0, endMs: 10000 },
    settings: DEFAULT_SETTINGS,
    visualSegments: [
      {
        id: 'slide-1',
        index: 0,
        startMs: 0,
        endMs: 10000,
        autoKind: 'slide',
        personLayout: 'none',
        detection: { source: 'auto' },
        image: { representativeFramePath: '/tmp/slide.jpg' },
        ocr: { rawText: 'OCR', model: 'ocr-model', inputFingerprint: 'ocr-fingerprint' },
      },
    ],
    blocks: [
      {
        id: 'slide-1',
        index: 0,
        visualSegmentIds: ['slide-1'],
        imageSegmentId: 'slide-1',
        startMs: 0,
        endMs: 10000,
        transcript: {
          raw: 'transcript',
          model: 'transcription-model',
          articleBody: 'body',
          articleModel: 'article-model',
          articleInputFingerprint: 'article-fingerprint',
        },
      },
    ],
    slideDetection: {
      sampleIntervalMs: 500,
      threshold: 12,
      framesAnalyzed: 20,
      boundaries: [],
      detectedAt: now,
    },
    transcription: {
      model: 'transcription-model',
      provider: 'local',
      audioPath: '/tmp/audio.wav',
      segments: [],
      transcribedAt: now,
      inputFingerprint: 'transcription-fingerprint',
    },
    document: {},
    workflow: {
      lastVisitedStep: 'article-review',
      maxReachedStep: 'article-review',
      lastOpenedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  }
  const project = {
    ...createEmptyProject('workflow', projectId),
    createdAt: now,
    updatedAt: now,
    videos: [{ id: 'video-1', title: 'lecture', media, createdAt: now, updatedAt: now }],
    articles: [{ kind: 'loaded' as const, article }],
  }
  return { project, article }
}
export function withArticle(context: ArticleContext, article: Article): ArticleContext {
  return {
    project: replaceLoadedArticle({ ...context.project, updatedAt: article.updatedAt }, article),
    article,
  }
}
export function editArticle<Args extends unknown[]>(
  operation: (article: Article, ...args: Args) => Article,
) {
  return (context: ArticleContext, ...args: Args) =>
    withArticle(context, operation(context.article, ...args))
}
export function blockViews(context: ArticleContext) {
  return articleBlockViews(context.article.visualSegments, context.article.blocks)
}
