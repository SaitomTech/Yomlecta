import type {
  Article,
  ArticleDraft,
  ArticleDocument,
  ArticleOutputLanguage,
  ArticleSections,
  ArticleSummary,
  ArticleTranslation,
  ContentProcessingResult,
  CropRegion,
  MediaMetadata,
  PerspectiveCrop,
  ProjectSettings,
  ProjectStep,
  SlideData,
  SlideDetectionResult,
  SlideOcrResult,
  SlideResultEdits,
  TranscriptionResult,
  VideoTrimRange,
} from '../../types/project'
import { getFurthestWorkflowStep, getWorkflowStepIndex } from '../workflow'
import { normalizeTranscriptSegments } from '../pipeline/normalizeTranscriptSegments'
import { assignTranscriptToArticleBlocks, buildArticleBlocks } from '../pipeline/articleBlocks'
import { normalizeTrimRange } from './videoRange'
import { normalizeArticleCrop } from './articleSource'

export const DEFAULT_SETTINGS: ProjectSettings = {
  slideDetection: { sampleIntervalMs: 500, threshold: 12 },
  transcription: true,
  ocr: true,
  correction: true,
  articleFormatting: true,
}
const sameValue = (first: unknown, second: unknown) =>
  JSON.stringify(first) === JSON.stringify(second)

function workflowWithReachableStep(
  article: Article,
  maxReachedStep: ProjectStep,
  lastVisitedStep = article.workflow.lastVisitedStep,
) {
  return {
    ...article.workflow,
    lastVisitedStep:
      getWorkflowStepIndex(lastVisitedStep) > getWorkflowStepIndex(maxReachedStep)
        ? maxReachedStep
        : lastVisitedStep,
    maxReachedStep,
  }
}
function documentUpdate(article: Article, document: ArticleDocument, now: string): Article {
  if (sameValue(article.document, document)) return article
  return {
    ...article,
    document,
    workflow: workflowWithReachableStep(
      article,
      article.workflow.maxReachedStep === 'export' ? 'export' : 'article-review',
      'article-review',
    ),
    updatedAt: now,
  }
}
export function updateArticleSourceSettings(
  article: Article,
  range: VideoTrimRange,
  crop: CropRegion,
  perspectiveCrop?: PerspectiveCrop,
  options: { sourceMetadata?: MediaMetadata; now?: string } = {},
): Article {
  const now = options.now ?? new Date().toISOString()
  const metadata = options.sourceMetadata ?? article.inputMedia.metadata
  const sourceRange = normalizeTrimRange(range, metadata.durationMs)
  const nextCrop = normalizeArticleCrop(crop, metadata)
  if (
    sameValue(article.sourceRange, sourceRange) &&
    sameValue(article.crop, nextCrop) &&
    sameValue(article.perspectiveCrop, perspectiveCrop)
  )
    return article
  return {
    ...article,
    sourceRange,
    crop: nextCrop,
    perspectiveCrop,
    visualSegments: [],
    blocks: [],
    slideDetection: undefined,
    transcription: undefined,
    document: undefined,
    workflow: {
      ...article.workflow,
      lastVisitedStep: 'detect-slides',
      maxReachedStep: 'detect-slides',
      lastOpenedAt: now,
    },
    updatedAt: now,
  }
}
export function updateArticleWorkflow(article: Article, step: ProjectStep): Article {
  const workflow = {
    ...article.workflow,
    lastVisitedStep: step,
    maxReachedStep: getFurthestWorkflowStep(article.workflow.maxReachedStep, step),
  }
  return sameValue(workflow, article.workflow) ? article : { ...article, workflow }
}
export function markArticleOpened(
  article: Article,
  step: ProjectStep,
  now = new Date().toISOString(),
): Article {
  return { ...article, workflow: { ...article.workflow, lastVisitedStep: step, lastOpenedAt: now } }
}
export function markArticleExported(article: Article, now = new Date().toISOString()): Article {
  return {
    ...article,
    workflow: {
      ...article.workflow,
      lastVisitedStep: 'article-review',
      maxReachedStep: 'export',
      lastExportedAt: now,
      lastOpenedAt: now,
    },
    updatedAt: now,
  }
}
export function updateArticleSlideDetection(
  article: Article,
  result: SlideDetectionResult,
  segments: SlideData[],
  now = new Date().toISOString(),
): Article {
  const proposed = buildArticleBlocks(segments, article.blocks)
  const blocks = article.transcription
    ? assignTranscriptToArticleBlocks(
        proposed,
        article.transcription.segments,
        article.transcription.model,
      )
    : proposed
  const settings = {
    ...article.settings,
    slideDetection: { sampleIntervalMs: result.sampleIntervalMs, threshold: result.threshold },
  }
  const comparable = (value: SlideDetectionResult | undefined) =>
    value
      ? {
          sampleIntervalMs: value.sampleIntervalMs,
          threshold: value.threshold,
          framesAnalyzed: value.framesAnalyzed,
          boundaries: value.boundaries,
        }
      : value
  if (
    sameValue(comparable(article.slideDetection), comparable(result)) &&
    sameValue(article.visualSegments, segments) &&
    sameValue(article.blocks, blocks) &&
    sameValue(article.settings, settings)
  )
    return article
  return {
    ...article,
    slideDetection: result,
    visualSegments: segments,
    blocks,
    settings,
    workflow: workflowWithReachableStep(article, 'generate-notes', 'detect-slides'),
    updatedAt: now,
  }
}
export function updateArticleTranscription(
  article: Article,
  transcription: TranscriptionResult,
  now = new Date().toISOString(),
): Article {
  const normalized = {
    ...transcription,
    segments: normalizeTranscriptSegments(transcription.segments),
  }
  if (
    article.transcription?.inputFingerprint === normalized.inputFingerprint &&
    article.transcription.model === normalized.model &&
    sameValue(article.transcription.segments, normalized.segments)
  )
    return article
  const blocks = assignTranscriptToArticleBlocks(
    buildArticleBlocks(article.visualSegments, article.blocks),
    normalized.segments,
    normalized.model,
  )
  return {
    ...article,
    transcription: normalized,
    blocks,
    workflow: workflowWithReachableStep(article, 'generate-notes', 'generate-notes'),
    updatedAt: now,
  }
}
export function updateArticleSlideOcr(
  article: Article,
  segmentId: string,
  ocr: SlideOcrResult,
  now = new Date().toISOString(),
): Article {
  const segment = article.visualSegments.find((segment) => segment.id === segmentId)
  if (!segment) throw new Error('映像区間が見つかりません。')
  if (sameValue(segment.ocr, ocr)) return article
  return {
    ...article,
    visualSegments: article.visualSegments.map((segment) =>
      segment.id === segmentId ? { ...segment, ocr } : segment,
    ),
    workflow: workflowWithReachableStep(article, 'generate-notes', 'generate-notes'),
    updatedAt: now,
  }
}
export function updateArticleSlideContent(
  article: Article,
  blockId: string,
  result: ContentProcessingResult,
  now = new Date().toISOString(),
): Article {
  const block = article.blocks.find((block) => block.id === blockId)
  if (!block) throw new Error('記事ブロックが見つかりません。')
  const transcript = {
    raw: block.transcript?.raw ?? '',
    model: block.transcript?.model ?? article.transcription?.model ?? result.article.model,
    ...block.transcript,
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
  if (sameValue(block.transcript, transcript)) return article
  return {
    ...article,
    blocks: article.blocks.map((block) =>
      block.id === blockId ? { ...block, transcript } : block,
    ),
    workflow: workflowWithReachableStep(article, 'article-review', 'generate-notes'),
    updatedAt: now,
  }
}
export function updateArticleSlideResultEdits(
  article: Article,
  blockId: string,
  edits: SlideResultEdits,
  now = new Date().toISOString(),
): Article {
  const block = article.blocks.find((block) => block.id === blockId)
  if (!block) throw new Error('記事ブロックが見つかりません。')
  const segment = article.visualSegments.find((segment) => segment.id === block.imageSegmentId)
  const ocr = segment?.ocr ? { ...segment.ocr, rawText: edits.ocrText } : undefined
  const transcript = block.transcript
    ? { ...block.transcript, raw: edits.transcriptRaw, articleBody: edits.articleBody }
    : undefined
  if (sameValue(segment?.ocr, ocr) && sameValue(block.transcript, transcript)) return article
  return {
    ...article,
    visualSegments: article.visualSegments.map((value) =>
      value.id === segment?.id ? { ...value, ocr } : value,
    ),
    blocks: article.blocks.map((value) =>
      value.id === blockId ? { ...value, transcript } : value,
    ),
    workflow: workflowWithReachableStep(article, 'generate-notes', 'generate-notes'),
    updatedAt: now,
  }
}
export function updateArticleDraft(
  article: Article,
  draft: ArticleDraft,
  now = new Date().toISOString(),
): Article {
  const title = draft.title.trim() || article.title
  for (const id of Object.keys(draft.bodies))
    if (!article.blocks.some((block) => block.id === id))
      throw new Error('記事ブロックが見つかりません。')
  const blocks = article.blocks.map((block) =>
    draft.bodies[block.id] === undefined ||
    !block.transcript ||
    draft.bodies[block.id] === block.transcript.articleBody
      ? block
      : { ...block, transcript: { ...block.transcript, articleBody: draft.bodies[block.id] } },
  )
  if (title === article.title && sameValue(blocks, article.blocks)) return article
  return {
    ...article,
    title,
    blocks,
    workflow: workflowWithReachableStep(
      article,
      article.workflow.maxReachedStep === 'export' ? 'export' : 'article-review',
      'article-review',
    ),
    updatedAt: now,
  }
}
export function updateArticleTitle(
  article: Article,
  draftTitle: string,
  now = new Date().toISOString(),
): Article {
  const title = draftTitle.trim()
  if (!title) throw new Error('記事タイトルを入力してください。')
  return title === article.title ? article : { ...article, title, updatedAt: now }
}
export function updateArticleOutputLanguage(
  article: Article,
  outputLanguage: ArticleOutputLanguage,
  now = new Date().toISOString(),
) {
  return documentUpdate(article, { ...article.document, outputLanguage }, now)
}
export function updateArticleSections(
  article: Article,
  sections: ArticleSections | null,
  now = new Date().toISOString(),
) {
  const { sections: _sections, ...rest } = article.document ?? {}
  return documentUpdate(article, sections ? { ...rest, sections } : rest, now)
}
export function updateArticleSummary(
  article: Article,
  summary: ArticleSummary,
  now = new Date().toISOString(),
) {
  return documentUpdate(article, { ...article.document, summary }, now)
}
export function updateArticleTranslation(
  article: Article,
  translation: ArticleTranslation,
  now = new Date().toISOString(),
) {
  return documentUpdate(
    article,
    {
      ...article.document,
      translations: {
        ...article.document?.translations,
        [translation.targetLanguage]: translation,
      },
    },
    now,
  )
}
