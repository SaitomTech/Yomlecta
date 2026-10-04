import {
  assignedArticleSlides,
  boundarySourceSlides,
  boundaryPlanInputsCurrent,
  currentBoundaryPlan,
} from '../pipeline/transcriptBoundaries'
import { articleInputFingerprint } from '../../features/article/article'
import type { SlideDetectionOutput } from '../../features/slide-detection/types'
import {
  commitOcrBatch,
  commitSlideContentBatch,
  commitSlideDetection,
  commitTranscription,
  updateArticleSource,
  updateArticleTitle,
  updateArticleContent,
  updateDocumentAndArticle,
  updateSlideResults,
} from '../storage/projectStorage'
import {
  syncActiveArticle,
  updateProjectArticleDraft,
  updateProjectArticleOutputLanguage,
  updateProjectArticleSections,
  updateProjectArticleSourceSettings,
  updateProjectArticleSummary,
  updateProjectArticleTitle,
  updateProjectArticleTranslation,
  updateProjectSlideContent,
  updateProjectSlideDetection,
  updateProjectSlideOcr,
  updateProjectSlideResultEdits,
  updateProjectTranscription,
} from './project'
import type {
  TranscriptBoundaryPlan,
  ContentProcessingResult,
  ArticleDraft,
  ArticleOutputLanguage,
  ArticleSections,
  ArticleSummary,
  ArticleTranslation,
  CropRegion,
  MediaProject,
  PerspectiveCrop,
  SlideOcrResult,
  SlideResultEdits,
  TranscriptionResult,
  VideoTrimRange,
} from '../../types/project'
import { removeArticleRunDirectories } from '../storage/projectAssets'

function activeArticle(project: MediaProject) {
  if (!project.activeArticleId) return null
  return project.articles.find((article) => article.id === project.activeArticleId) ?? null
}

function syncedArticle(project: MediaProject) {
  const next = syncActiveArticle(project)
  const article = activeArticle(next)
  if (!article) return null
  return { next, article }
}

export async function saveTranscriptBoundaryPlan(
  project: MediaProject,
  plan: TranscriptBoundaryPlan,
) {
  const slides = boundarySourceSlides(project)
  if (!boundaryPlanInputsCurrent(plan, slides))
    throw new Error('文字起こしやOCRが変更されました。本文生成を再実行してください。')
  if (JSON.stringify(project.article?.boundaryPlan) === JSON.stringify(plan)) return project
  const updated = {
    ...project,
    article: {
      ...project.article,
      title: project.article?.title ?? activeArticle(project)?.title ?? '無題の記事',
      boundaryPlan: plan,
    },
    workflow: { ...project.workflow, maxReachedStep: 'article-review' as const },
    updatedAt: new Date().toISOString(),
  }
  const synced = syncedArticle(updated)
  if (!synced) throw new Error('記事が選択されていません。')
  await updateDocumentAndArticle(synced.next, synced.article, synced.next.article)
  return synced.next
}

export async function saveArticleDraft(project: MediaProject, draft: ArticleDraft) {
  const updated = updateProjectArticleDraft(project, draft)
  if (updated === project) return project
  const synced = syncedArticle(updated)
  if (!synced) return null
  await updateArticleContent(synced.next, synced.article, synced.next.articleBlocks)
  return synced.next
}

export async function saveArticleSections(project: MediaProject, sections: ArticleSections | null) {
  const updated = updateProjectArticleSections(project, sections)
  if (updated === project) return project
  const synced = syncedArticle(updated)
  if (!synced) return null
  await updateDocumentAndArticle(synced.next, synced.article, synced.next.article, {
    runKind: sections && sections.model !== 'manual' ? 'chapter_generation' : undefined,
  })
  return synced.next
}

export async function saveArticleSummary(project: MediaProject, summary: ArticleSummary) {
  const updated = updateProjectArticleSummary(project, summary)
  if (updated === project) return project
  const synced = syncedArticle(updated)
  if (!synced) return null
  await updateDocumentAndArticle(synced.next, synced.article, synced.next.article, {
    runKind: 'summary_generation',
  })
  return synced.next
}

export async function saveArticleTranslation(
  project: MediaProject,
  translation: ArticleTranslation,
) {
  const updated = updateProjectArticleTranslation(project, translation)
  if (updated === project) return project
  const synced = syncedArticle(updated)
  if (!synced) return null
  await updateDocumentAndArticle(synced.next, synced.article, synced.next.article)
  return synced.next
}

export async function saveArticleOutputLanguage(
  project: MediaProject,
  outputLanguage: ArticleOutputLanguage,
) {
  const updated = updateProjectArticleOutputLanguage(project, outputLanguage)
  if (updated === project) return project
  const synced = syncedArticle(updated)
  if (!synced) return null
  await updateDocumentAndArticle(synced.next, synced.article, synced.next.article)
  return synced.next
}

export async function saveArticleTitle(project: MediaProject, title: string) {
  const updated = updateProjectArticleTitle(project, title)
  if (updated === project) return project
  const synced = syncedArticle(updated)
  if (!synced) return null
  await updateArticleTitle(synced.next, synced.article)
  return synced.next
}

export async function saveArticleSource(
  project: MediaProject,
  range: VideoTrimRange,
  crop: CropRegion,
  perspectiveCrop?: PerspectiveCrop,
) {
  const updated = updateProjectArticleSourceSettings(project, range, crop, perspectiveCrop)
  if (updated === project) return project
  const synced = syncedArticle(updated)
  if (!synced) return null
  await updateArticleSource(synced.next, synced.article)
  await removeArticleRunDirectories(synced.next.id, synced.article.id).catch((error) =>
    console.warn('古い記事解析ファイルを削除できませんでした。', error),
  )
  return synced.next
}

export async function saveSlideDetection(project: MediaProject, output: SlideDetectionOutput) {
  const updated = updateProjectSlideDetection(project, output.result, output.slides)
  if (updated === project) return null
  const next = syncActiveArticle(updated)
  await commitSlideDetection(next, next.slideDetection ?? output.result, next.slides)
  return next
}

export async function saveTranscription(project: MediaProject, transcription: TranscriptionResult) {
  const updated = updateProjectTranscription(project, transcription)
  if (updated === project) return null
  const next = syncActiveArticle(updated)
  await commitTranscription(next, next.transcription ?? transcription)
  return next
}

export async function saveOcrBatch(
  project: MediaProject,
  results: Array<{ slideId: string; ocr: SlideOcrResult }>,
) {
  let next = project
  for (const { slideId, ocr } of results) next = updateProjectSlideOcr(next, slideId, ocr)
  if (next === project) return null
  next = syncActiveArticle(next)
  await commitOcrBatch(
    next,
    results.map(({ slideId, ocr }) => ({
      slideId,
      ocr,
      transcript: next.slides.find((slide) => slide.id === slideId)?.transcript,
    })),
  )
  return next
}

export async function saveSlideContentBatch(
  project: MediaProject,
  results: Array<{ slideId: string; result: ContentProcessingResult }>,
) {
  const plan = currentBoundaryPlan(project)
  if (!plan || !boundaryPlanInputsCurrent(plan, boundarySourceSlides(project))) {
    throw new Error('本文の生成中に文字起こしやOCRが変更されました。再実行してください。')
  }
  const assigned = new Map(assignedArticleSlides(project, plan).map((slide) => [slide.id, slide]))
  for (const { slideId, result } of results) {
    const slide = assigned.get(slideId)
    if (
      !slide ||
      articleInputFingerprint(slide, result.article.model) !== result.article.inputFingerprint
    ) {
      throw new Error('本文の生成中に入力が変更されました。再実行してください。')
    }
  }
  let next = project
  for (const { slideId, result } of results) next = updateProjectSlideContent(next, slideId, result)
  if (next === project) return null
  next = syncActiveArticle(next)
  const items = results.flatMap(({ slideId, result }) => {
    const transcript = next.slides.find((slide) => slide.id === slideId)?.transcript
    return transcript ? [{ slideId, result, transcript }] : []
  })
  if (items.length !== results.length) return null
  await commitSlideContentBatch(next, items)
  return next
}

export async function saveSlideResultEdits(
  project: MediaProject,
  slideId: string,
  edits: SlideResultEdits,
) {
  const updated = updateProjectSlideResultEdits(project, slideId, edits)
  if (updated === project) return null
  const next = syncActiveArticle(updated)
  const transcript = next.slides.find((slide) => slide.id === slideId)?.transcript
  const ocr = next.slides.find((slide) => slide.id === slideId)?.ocr
  await updateSlideResults(next, slideId, transcript, ocr)
  return next
}
