import type { SlideDetectionOutput } from '../../features/slide-detection/types'
import {
  commitOcr,
  commitSlideContent,
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
  updateProjectArticleSections,
  updateProjectArticleSourceSettings,
  updateProjectArticleSummary,
  updateProjectArticleTitle,
  updateProjectSlideContent,
  updateProjectSlideDetection,
  updateProjectSlideOcr,
  updateProjectSlideResultEdits,
  updateProjectTranscription,
} from './project'
import type {
  ContentProcessingResult,
  ArticleDraft,
  ArticleSections,
  ArticleSummary,
  CropRegion,
  MediaProject,
  PerspectiveCrop,
  SlideOcrResult,
  SlideResultEdits,
  TranscriptionResult,
  VideoTrimRange,
} from '../../types/project'

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

export async function saveArticleDraft(project: MediaProject, draft: ArticleDraft) {
  const updated = updateProjectArticleDraft(project, draft)
  if (updated === project) return project
  const synced = syncedArticle(updated)
  if (!synced) return null
  await updateArticleContent(synced.next, synced.article, synced.next.slides)
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
  await commitTranscription(next, next.transcription ?? transcription, next.slides)
  return next
}

export async function saveOcr(project: MediaProject, slideId: string, ocr: SlideOcrResult) {
  const updated = updateProjectSlideOcr(project, slideId, ocr)
  if (updated === project) return null
  const next = syncActiveArticle(updated)
  const transcript = next.slides.find((slide) => slide.id === slideId)?.transcript
  await commitOcr(next, slideId, ocr, transcript)
  return next
}

export async function saveSlideContent(
  project: MediaProject,
  slideId: string,
  result: ContentProcessingResult,
) {
  const updated = updateProjectSlideContent(project, slideId, result)
  if (updated === project) return null
  const next = syncActiveArticle(updated)
  const transcript = next.slides.find((slide) => slide.id === slideId)?.transcript
  if (!transcript) return null
  await commitSlideContent(next, slideId, result, transcript)
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
