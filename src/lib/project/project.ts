import { normalizeTranscriptSegments } from '../pipeline/normalizeTranscriptSegments'
import {
  articleBlockHostSegmentId,
  applyArticleBlocksToSegments,
  assignTranscriptToArticleBlocks,
  buildArticleBlocks,
} from '../pipeline/articleBlocks'
import {
  PROJECT_VERSION,
  getActiveArticle,
  type Article,
  type ArticleDraft,
  type ArticleOutputLanguage,
  type ArticleSections,
  type ArticleSummary,
  type ArticleTranslation,
  type ContentProcessingResult,
  type CropRegion,
  type MediaProject,
  type MediaSource,
  type PerspectiveCrop,
  type ProjectSettings,
  type ProjectStep,
  type ProjectVideo,
  type SlideData,
  type SlideDetectionResult,
  type SlideOcrResult,
  type SlideResultEdits,
  type TranscriptionResult,
  type VideoTrimRange,
} from '../../types/project'
import { getFurthestWorkflowStep, getWorkflowStepIndex } from '../workflow'
import { normalizeTrimRange } from './videoRange'
import { normalizeArticleCrop } from './articleSource'

export const DEFAULT_SETTINGS: ProjectSettings = {
  slideDetection: { sampleIntervalMs: 500, threshold: 12 },
  transcription: true,
  ocr: true,
  correction: true,
  articleFormatting: true,
}

function sameValue(first: unknown, second: unknown) {
  return JSON.stringify(first) === JSON.stringify(second)
}

function sameSlideDetection(first: SlideDetectionResult | undefined, second: SlideDetectionResult) {
  if (!first) return false
  const withoutTimestamps = (result: SlideDetectionResult) => {
    return {
      sampleIntervalMs: result.sampleIntervalMs,
      threshold: result.threshold,
      framesAnalyzed: result.framesAnalyzed,
      boundaries: result.boundaries,
    }
  }
  return sameValue(withoutTimestamps(first), withoutTimestamps(second))
}

function sameSlideStructure(first: SlideData[], second: SlideData[]) {
  const comparable = ({ transcript: _transcript, ocr: _ocr, ...segment }: SlideData) => segment
  return sameValue(first.map(comparable), second.map(comparable))
}

function articleToWorkspace(project: MediaProject, article: Article): MediaProject {
  return {
    ...project,
    activeArticleId: article.id,
    source: article.inputMedia,
    sourceRange: article.sourceRange,
    crop: article.crop,
    perspectiveCrop: article.perspectiveCrop,
    settings: article.settings,
    slides: article.slides,
    articleBlocks: article.articleBlocks,
    slideDetection: article.slideDetection,
    transcription: article.transcription,
    article: article.article,
    workflow: article.workflow,
  }
}

function workflowWithReachableStep(
  project: MediaProject,
  maxReachedStep: ProjectStep,
  lastVisitedStep = project.workflow.lastVisitedStep,
) {
  const lastVisitedIndex = getWorkflowStepIndex(lastVisitedStep)
  const maxReachedIndex = getWorkflowStepIndex(maxReachedStep)
  return {
    ...project.workflow,
    lastVisitedStep: lastVisitedIndex > maxReachedIndex ? maxReachedStep : lastVisitedStep,
    maxReachedStep,
  }
}

export function activateArticle(project: MediaProject, articleId: string): MediaProject {
  const article = project.articles.find((candidate) => candidate.id === articleId)
  if (!article) throw new Error('記事が見つかりません。')
  return articleToWorkspace(project, article)
}

/** Copies the transient workspace fields back into the active Article before persistence. */
export function syncActiveArticle(project: MediaProject): MediaProject {
  const article = getActiveArticle(project)
  if (!article) return project
  const nextTitle = article.title.trim() || project.article?.title?.trim() || '無題の記事'
  const nextArticle: Article = {
    ...article,
    title: nextTitle,
    settings: project.settings,
    slides: project.slides,
    articleBlocks: project.articleBlocks,
    slideDetection: project.slideDetection,
    transcription: project.transcription,
    article: project.article,
    sourceRange: project.sourceRange ?? article.sourceRange,
    crop: project.crop,
    perspectiveCrop: project.perspectiveCrop,
    workflow: project.workflow,
    updatedAt: project.updatedAt,
  }
  return {
    ...project,
    articles: project.articles.map((candidate) =>
      candidate.id === article.id ? nextArticle : candidate,
    ),
  }
}

export function createEmptyProject(title: string, projectId = crypto.randomUUID()): MediaProject {
  const now = new Date().toISOString()
  const placeholder: MediaSource = {
    path: '',
    name: '',
    extension: 'mp4',
    metadata: { path: '', durationMs: 0, width: 1, height: 1 },
    origin: { kind: 'local-file' },
  }
  return {
    version: PROJECT_VERSION,
    id: projectId,
    title: title.trim() || '無題のプロジェクト',
    videos: [],
    articles: [],
    createdAt: now,
    updatedAt: now,
    source: placeholder,
    settings: DEFAULT_SETTINGS,
    slides: [],
    articleBlocks: [],
    workflow: {
      lastVisitedStep: 'detect-slides',
      maxReachedStep: 'detect-slides',
      lastOpenedAt: now,
    },
  }
}

/** Save the article-local range/crop selection and invalidate downstream outputs. */
export function updateProjectArticleSourceSettings(
  project: MediaProject,
  range: VideoTrimRange,
  crop: CropRegion,
  perspectiveCrop?: PerspectiveCrop,
): MediaProject {
  const article = getActiveArticle(project)
  if (!article) return project
  const sourceVideo = article.sourceVideoId
    ? project.videos.find((video) => video.id === article.sourceVideoId)
    : undefined
  const duration = sourceVideo?.media.metadata.durationMs ?? project.source.metadata.durationMs
  const sourceMetadata = sourceVideo?.media.metadata ?? project.source.metadata
  const nextRange = normalizeTrimRange(range, duration)
  const nextCrop = normalizeArticleCrop(crop, sourceMetadata)
  const now = new Date().toISOString()
  const nextArticle: Article = {
    ...article,
    sourceRange: nextRange,
    crop: nextCrop,
    ...(perspectiveCrop ? { perspectiveCrop } : { perspectiveCrop: undefined }),
    slides: [],
    articleBlocks: [],
    slideDetection: undefined,
    transcription: undefined,
    article: undefined,
    workflow: {
      ...article.workflow,
      lastVisitedStep: 'detect-slides',
      maxReachedStep: 'detect-slides',
      lastOpenedAt: now,
    },
    updatedAt: now,
  }
  return articleToWorkspace(
    {
      ...project,
      articles: project.articles.map((candidate) =>
        candidate.id === article.id ? nextArticle : candidate,
      ),
      updatedAt: now,
    },
    nextArticle,
  )
}

export function updateProjectWorkflow(project: MediaProject, step: ProjectStep): MediaProject {
  return {
    ...project,
    workflow: {
      ...project.workflow,
      lastVisitedStep: step,
      maxReachedStep: getFurthestWorkflowStep(project.workflow.maxReachedStep, step),
    },
    updatedAt: project.updatedAt,
  }
}

export function markProjectOpened(project: MediaProject, step: ProjectStep): MediaProject {
  return {
    ...project,
    workflow: {
      ...project.workflow,
      lastVisitedStep: step,
      lastOpenedAt: new Date().toISOString(),
    },
  }
}

export function markProjectExported(project: MediaProject): MediaProject {
  const now = new Date().toISOString()
  return {
    ...project,
    workflow: {
      ...project.workflow,
      lastVisitedStep: 'export',
      maxReachedStep: 'export',
      lastExportedAt: now,
      lastOpenedAt: now,
    },
    updatedAt: now,
  }
}

export function updateProjectSlideDetection(
  project: MediaProject,
  result: SlideDetectionResult,
  slides: SlideData[],
): MediaProject {
  const proposedBlocks = buildArticleBlocks(slides, project.articleBlocks)
  const nextBlocks = project.transcription
    ? assignTranscriptToArticleBlocks(
        proposedBlocks,
        project.transcription.segments,
        project.transcription.model,
      )
    : proposedBlocks
  const nextSlides = applyArticleBlocksToSegments(slides, nextBlocks)
  const nextSettings = {
    ...project.settings,
    slideDetection: { sampleIntervalMs: result.sampleIntervalMs, threshold: result.threshold },
  }
  if (
    sameSlideDetection(project.slideDetection, result) &&
    sameSlideStructure(project.slides, nextSlides) &&
    sameValue(project.articleBlocks, nextBlocks) &&
    sameValue(project.settings, nextSettings)
  )
    return project
  return {
    ...project,
    slideDetection: result,
    slides: nextSlides,
    articleBlocks: nextBlocks,
    settings: nextSettings,
    workflow: workflowWithReachableStep(project, 'generate-notes', 'detect-slides'),
    updatedAt: new Date().toISOString(),
  }
}

export function updateProjectTranscription(
  project: MediaProject,
  transcription: TranscriptionResult,
): MediaProject {
  const normalized = {
    ...transcription,
    segments: normalizeTranscriptSegments(transcription.segments),
  }
  const nextBlocks = assignTranscriptToArticleBlocks(
    buildArticleBlocks(project.slides, project.articleBlocks),
    normalized.segments,
    normalized.model,
  )
  const nextSlides = applyArticleBlocksToSegments(project.slides, nextBlocks)
  if (
    project.transcription?.inputFingerprint === normalized.inputFingerprint &&
    project.transcription.model === normalized.model &&
    sameValue(project.transcription.segments, normalized.segments)
  )
    return project
  return {
    ...project,
    transcription: normalized,
    slides: nextSlides,
    articleBlocks: nextBlocks,
    workflow: workflowWithReachableStep(project, 'generate-notes', 'generate-notes'),
    updatedAt: new Date().toISOString(),
  }
}

export function updateProjectSlideOcr(
  project: MediaProject,
  slideId: string,
  ocr: SlideOcrResult,
): MediaProject {
  const currentSlide = project.slides.find((slide) => slide.id === slideId)
  if (!currentSlide) return project
  const ocrChanged = !sameValue(currentSlide.ocr, ocr)
  if (!ocrChanged) return project
  const nextTranscript = currentSlide.transcript
    ? { raw: currentSlide.transcript.raw, model: currentSlide.transcript.model }
    : undefined
  const nextBlocks = project.articleBlocks.map((block) =>
    articleBlockHostSegmentId(block) === slideId ? { ...block, transcript: nextTranscript } : block,
  )
  return {
    ...project,
    slides: project.slides.map((slide) =>
      slide.id === slideId
        ? {
            ...slide,
            ocr,
            transcript: nextTranscript,
          }
        : slide,
    ),
    articleBlocks: nextBlocks,
    workflow: workflowWithReachableStep(project, 'generate-notes', 'generate-notes'),
    updatedAt: new Date().toISOString(),
  }
}

export function updateProjectSlideContent(
  project: MediaProject,
  slideId: string,
  result: ContentProcessingResult,
): MediaProject {
  const currentSlide = project.slides.find((slide) => slide.id === slideId)
  if (!currentSlide) return project
  const nextTranscript = {
    raw: currentSlide.transcript?.raw ?? '',
    model: currentSlide.transcript?.model ?? project.transcription?.model ?? result.article.model,
    ...currentSlide.transcript,
    articleBody: result.article.body,
    articleModel: result.article.model,
    articleInputFingerprint: result.article.inputFingerprint,
    articleProvider: result.article.provider,
    articleEngineVersion: result.article.engineVersion,
    articleInputTokens: result.article.usage?.inputTokens,
    articleOutputTokens: result.article.usage?.outputTokens,
    articleRequestId: result.article.requestId,
    articleGeneratedAt: result.article.generatedAt,
  }
  if (
    currentSlide.transcript?.articleInputFingerprint === result.article.inputFingerprint &&
    currentSlide.transcript?.articleBody === result.article.body &&
    currentSlide.transcript?.articleModel === result.article.model
  )
    return project
  return {
    ...project,
    slides: project.slides.map((slide) => {
      if (slide.id !== slideId) return slide
      return {
        ...slide,
        transcript: nextTranscript,
      }
    }),
    articleBlocks: project.articleBlocks.map((block) =>
      articleBlockHostSegmentId(block) === slideId
        ? { ...block, transcript: nextTranscript }
        : block,
    ),
    workflow: workflowWithReachableStep(project, 'article-review', 'generate-notes'),
    updatedAt: new Date().toISOString(),
  }
}

export function updateProjectSlideResultEdits(
  project: MediaProject,
  slideId: string,
  edits: SlideResultEdits,
): MediaProject {
  const currentSlide = project.slides.find((slide) => slide.id === slideId)
  if (!currentSlide) return project
  const nextOcr = currentSlide.ocr ? { ...currentSlide.ocr, rawText: edits.ocrText } : undefined
  const nextTranscript = currentSlide.transcript
    ? { ...currentSlide.transcript, raw: edits.transcriptRaw, articleBody: edits.articleBody }
    : undefined
  if (sameValue(currentSlide.ocr, nextOcr) && sameValue(currentSlide.transcript, nextTranscript))
    return project
  return {
    ...project,
    slides: project.slides.map((slide) =>
      slide.id === slideId
        ? {
            ...slide,
            ocr: nextOcr,
            transcript: nextTranscript,
          }
        : slide,
    ),
    articleBlocks: project.articleBlocks.map((block) =>
      articleBlockHostSegmentId(block) === slideId
        ? { ...block, transcript: nextTranscript }
        : block,
    ),
    workflow: workflowWithReachableStep(project, 'generate-notes', 'generate-notes'),
    updatedAt: new Date().toISOString(),
  }
}

export function updateProjectArticleDraft(
  project: MediaProject,
  draft: ArticleDraft,
): MediaProject {
  const activeArticle = getActiveArticle(project)
  const title =
    draft.title.trim() ||
    activeArticle?.title.trim() ||
    project.article?.title?.trim() ||
    project.source.name.replace(/\.[^.]+$/, '')
  const nextArticle = { ...project.article, title }
  const nextArticles = activeArticle
    ? project.articles.map((article) =>
        article.id === activeArticle.id && article.title !== title
          ? { ...article, title }
          : article,
      )
    : project.articles
  const nextSlides = project.slides.map((slide) => {
    const body = draft.bodies[slide.id]
    if (body === undefined || !slide.transcript || body === slide.transcript.articleBody)
      return slide
    return { ...slide, transcript: { ...slide.transcript, articleBody: body } }
  })
  const nextBlocks = project.articleBlocks.map((block) => {
    const body = draft.bodies[articleBlockHostSegmentId(block)]
    if (body === undefined || !block.transcript || body === block.transcript.articleBody)
      return block
    return { ...block, transcript: { ...block.transcript, articleBody: body } }
  })
  if (
    sameValue(project.article, nextArticle) &&
    sameValue(project.articles, nextArticles) &&
    sameValue(project.slides, nextSlides) &&
    sameValue(project.articleBlocks, nextBlocks)
  )
    return project
  return {
    ...project,
    articles: nextArticles,
    article: nextArticle,
    slides: nextSlides,
    articleBlocks: nextBlocks,
    workflow: workflowWithReachableStep(
      project,
      getWorkflowStepIndex(project.workflow.maxReachedStep) >= getWorkflowStepIndex('export')
        ? 'export'
        : 'article-review',
      'article-review',
    ),
    updatedAt: new Date().toISOString(),
  }
}

export function updateProjectArticleTitle(project: MediaProject, draftTitle: string): MediaProject {
  const activeArticle = getActiveArticle(project)
  if (!activeArticle) return project
  const title = draftTitle.trim()
  if (!title) throw new Error('記事タイトルを入力してください。')

  const nextArticle = { ...project.article, title }
  const nextArticles = project.articles.map((article) =>
    article.id === activeArticle.id && article.title !== title ? { ...article, title } : article,
  )
  if (sameValue(project.article, nextArticle) && sameValue(project.articles, nextArticles))
    return project

  return {
    ...project,
    articles: nextArticles,
    article: nextArticle,
    updatedAt: new Date().toISOString(),
  }
}

export function updateProjectArticleOutputLanguage(
  project: MediaProject,
  outputLanguage: ArticleOutputLanguage,
): MediaProject {
  const activeArticle = getActiveArticle(project)
  if (!activeArticle) return project
  const title =
    activeArticle.title.trim() ||
    project.article?.title?.trim() ||
    project.source.name.replace(/\.[^.]+$/, '')
  const nextArticle = { ...project.article, title, outputLanguage }
  if (sameValue(project.article, nextArticle)) return project
  return {
    ...project,
    article: nextArticle,
    workflow: workflowWithReachableStep(
      project,
      getWorkflowStepIndex(project.workflow.maxReachedStep) >= getWorkflowStepIndex('export')
        ? 'export'
        : 'article-review',
      'article-review',
    ),
    updatedAt: new Date().toISOString(),
  }
}

export function updateProjectArticleSections(
  project: MediaProject,
  sections: ArticleSections | null,
): MediaProject {
  const activeArticle = getActiveArticle(project)
  const title =
    activeArticle?.title.trim() ||
    project.article?.title?.trim() ||
    project.source.name.replace(/\.[^.]+$/, '')
  const currentArticle = project.article ?? { title }
  const { sections: _currentSections, ...articleWithoutSections } = currentArticle
  const nextArticle = sections
    ? { ...currentArticle, title, sections }
    : { ...articleWithoutSections, title }
  if (sameValue(project.article, nextArticle)) return project
  return {
    ...project,
    article: nextArticle,
    workflow: workflowWithReachableStep(
      project,
      getWorkflowStepIndex(project.workflow.maxReachedStep) >= getWorkflowStepIndex('export')
        ? 'export'
        : 'article-review',
      'article-review',
    ),
    updatedAt: new Date().toISOString(),
  }
}

export function updateProjectArticleSummary(
  project: MediaProject,
  summary: ArticleSummary,
): MediaProject {
  const activeArticle = getActiveArticle(project)
  const title =
    activeArticle?.title.trim() ||
    project.article?.title?.trim() ||
    project.source.name.replace(/\.[^.]+$/, '')
  const nextArticle = { ...project.article, title, summary }
  if (sameValue(project.article, nextArticle)) return project
  return {
    ...project,
    article: nextArticle,
    workflow: workflowWithReachableStep(
      project,
      getWorkflowStepIndex(project.workflow.maxReachedStep) >= getWorkflowStepIndex('export')
        ? 'export'
        : 'article-review',
      'article-review',
    ),
    updatedAt: new Date().toISOString(),
  }
}

export function updateProjectArticleTranslation(
  project: MediaProject,
  translation: ArticleTranslation,
): MediaProject {
  const activeArticle = getActiveArticle(project)
  const title =
    activeArticle?.title.trim() ||
    project.article?.title?.trim() ||
    project.source.name.replace(/\.[^.]+$/, '')
  const currentArticle = project.article ?? { title }
  const nextArticle = {
    ...currentArticle,
    title,
    translations: {
      ...currentArticle.translations,
      [translation.targetLanguage]: translation,
    },
  }
  if (sameValue(project.article, nextArticle)) return project
  return {
    ...project,
    article: nextArticle,
    workflow: workflowWithReachableStep(
      project,
      getWorkflowStepIndex(project.workflow.maxReachedStep) >= getWorkflowStepIndex('export')
        ? 'export'
        : 'article-review',
      'article-review',
    ),
    updatedAt: new Date().toISOString(),
  }
}

export function projectWithArticle(project: MediaProject, article: Article): MediaProject {
  return articleToWorkspace(project, article)
}

export function projectWithVideos(project: MediaProject, videos: ProjectVideo[]): MediaProject {
  const next = { ...project, videos, updatedAt: new Date().toISOString() }
  const active = getActiveArticle(next)
  return active ? articleToWorkspace(next, active) : next
}
