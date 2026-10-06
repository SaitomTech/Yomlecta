import * as changes from './article'
import * as storage from '../storage/projectStorage'
import {
  boundarySourceSlides,
  boundaryPlanInputsCurrent,
  currentBoundaryPlan,
  assignedArticleSlides,
} from '../pipeline/transcriptBoundaries'
import { articleInputFingerprint } from '../../features/article/article'
import { removeArticleRunDirectories } from '../storage/projectAssets'
import type { SlideDetectionOutput } from '../../features/slide-detection/types'
import type {
  Article,
  ArticleContext,
  ArticleDraft,
  ArticleOutputLanguage,
  ArticleSections,
  ArticleSummary,
  ArticleTranslation,
  ContentProcessingResult,
  CropRegion,
  PerspectiveCrop,
  SlideOcrResult,
  SlideResultEdits,
  TranscriptBoundaryPlan,
  TranscriptionResult,
  VideoTrimRange,
} from '../../types/project'

function nextContext(context: ArticleContext, article: Article): ArticleContext {
  return {
    project: {
      ...context.project,
      updatedAt:
        article.updatedAt > context.project.updatedAt
          ? article.updatedAt
          : context.project.updatedAt,
    },
    article,
  }
}
async function saveDocument(
  context: ArticleContext,
  article: Article,
  options: Parameters<typeof storage.updateDocumentAndArticle>[3] = {},
) {
  if (article === context.article) return article
  await storage.updateDocumentAndArticle(
    nextContext(context, article).project,
    article,
    article.document,
    options,
  )
  return article
}
export async function saveArticleDraft(context: ArticleContext, draft: ArticleDraft) {
  const article = changes.updateArticleDraft(context.article, draft)
  if (article === context.article) return article
  await storage.updateArticleContent(nextContext(context, article).project, article, article.blocks)
  return article
}
export const saveArticleSections = (context: ArticleContext, sections: ArticleSections | null) =>
  saveDocument(context, changes.updateArticleSections(context.article, sections), {
    runKind: sections && sections.model !== 'manual' ? 'chapter_generation' : undefined,
  })
export const saveArticleSummary = (context: ArticleContext, summary: ArticleSummary) =>
  saveDocument(context, changes.updateArticleSummary(context.article, summary), {
    runKind: 'summary_generation',
  })
export const saveArticleTranslation = (context: ArticleContext, translation: ArticleTranslation) =>
  saveDocument(context, changes.updateArticleTranslation(context.article, translation))
export const saveArticleOutputLanguage = (
  context: ArticleContext,
  language: ArticleOutputLanguage,
) => saveDocument(context, changes.updateArticleOutputLanguage(context.article, language))
export async function saveArticleTitle(context: ArticleContext, title: string) {
  const article = changes.updateArticleTitle(context.article, title)
  if (article === context.article) return article
  await storage.updateArticleTitle(nextContext(context, article).project, article)
  return article
}
export async function saveArticleWorkflow(context: ArticleContext, article: Article) {
  if (article === context.article) return article
  await storage.updateArticleWorkflow(nextContext(context, article).project, article)
  return article
}
export async function saveArticleSource(
  context: ArticleContext,
  range: VideoTrimRange,
  crop: CropRegion,
  perspectiveCrop?: PerspectiveCrop,
) {
  const sourceMetadata = context.project.videos.find(
    (video) => video.id === context.article.sourceVideoId,
  )?.media.metadata
  const article = changes.updateArticleSourceSettings(
    context.article,
    range,
    crop,
    perspectiveCrop,
    { sourceMetadata },
  )
  if (article === context.article) return article
  await storage.updateArticleSource(nextContext(context, article).project, article)
  await removeArticleRunDirectories(context.project.id, article.id).catch((error) =>
    console.warn('古い記事解析ファイルを削除できませんでした。', error),
  )
  return article
}
export async function saveSlideDetection(context: ArticleContext, output: SlideDetectionOutput) {
  const article = changes.updateArticleSlideDetection(context.article, output.result, output.slides)
  if (article === context.article) return article
  await storage.commitSlideDetection(
    nextContext(context, article),
    output.result,
    article.visualSegments,
  )
  return article
}
export async function saveTranscription(context: ArticleContext, result: TranscriptionResult) {
  const article = changes.updateArticleTranscription(context.article, result)
  if (article === context.article) return article
  await storage.commitTranscription(nextContext(context, article), article.transcription ?? result)
  return article
}
export async function saveOcrBatch(
  context: ArticleContext,
  results: Array<{ slideId: string; ocr: SlideOcrResult }>,
) {
  const now = new Date().toISOString()
  const article = results.reduce(
    (article, item) => changes.updateArticleSlideOcr(article, item.slideId, item.ocr, now),
    context.article,
  )
  if (article === context.article) return article
  await storage.commitOcrBatch(
    nextContext(context, article),
    results.map((item) => ({
      ...item,
      transcript: article.blocks.find((block) => block.imageSegmentId === item.slideId)?.transcript,
    })),
  )
  return article
}
export async function saveTranscriptBoundaryPlan(
  context: ArticleContext,
  plan: TranscriptBoundaryPlan,
) {
  if (!boundaryPlanInputsCurrent(plan, boundarySourceSlides(context)))
    throw new Error('文字起こしやOCRが変更されました。本文生成を再実行してください。')
  if (JSON.stringify(context.article.document?.boundaryPlan) === JSON.stringify(plan))
    return context.article
  const article = {
    ...context.article,
    document: { ...context.article.document, boundaryPlan: plan },
    workflow: { ...context.article.workflow, maxReachedStep: 'article-review' as const },
    updatedAt: new Date().toISOString(),
  }
  return saveDocument(context, article)
}
export async function saveSlideContentBatch(
  context: ArticleContext,
  results: Array<{ slideId: string; result: ContentProcessingResult }>,
) {
  const plan = currentBoundaryPlan(context)
  if (!plan || !boundaryPlanInputsCurrent(plan, boundarySourceSlides(context)))
    throw new Error('本文の生成中に文字起こしやOCRが変更されました。再実行してください。')
  const assigned = new Map(assignedArticleSlides(context, plan).map((block) => [block.id, block]))
  for (const item of results) {
    const block = assigned.get(item.slideId)
    if (
      !block ||
      articleInputFingerprint(block, item.result.article.model) !==
        item.result.article.inputFingerprint
    )
      throw new Error('本文の生成中に入力が変更されました。再実行してください。')
  }
  const now = new Date().toISOString()
  const article = results.reduce(
    (article, item) => changes.updateArticleSlideContent(article, item.slideId, item.result, now),
    context.article,
  )
  if (article === context.article) return article
  const items = results.map((item) => {
    const transcript = article.blocks.find((block) => block.id === item.slideId)?.transcript
    if (!transcript) throw new Error('記事ブロックの発話がありません。')
    return { ...item, transcript }
  })
  await storage.commitSlideContentBatch(nextContext(context, article), items)
  return article
}
export async function saveSlideResultEdits(
  context: ArticleContext,
  blockId: string,
  edits: SlideResultEdits,
) {
  const article = changes.updateArticleSlideResultEdits(context.article, blockId, edits)
  if (article === context.article) return article
  const block = article.blocks.find((block) => block.id === blockId)!
  const ocr = article.visualSegments.find((segment) => segment.id === block.imageSegmentId)?.ocr
  await storage.updateSlideResults(nextContext(context, article), blockId, block.transcript, ocr)
  return article
}
