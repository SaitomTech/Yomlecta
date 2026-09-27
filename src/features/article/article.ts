import { DEFAULT_ARTICLE_MODEL_ID } from '../../lib/article/articleModel'
import { articleBlockViews } from '../../lib/pipeline/articleBlocks'
import type { MediaProject, SlideData } from '../../types/project'

const ARTICLE_PROMPT_VERSION = 'content-processing-v16-infer-source-language'
const ARTICLE_SUMMARY_PROMPT_VERSION = 'article-summary-v4-infer-source-language'
const ARTICLE_SECTIONS_PROMPT_VERSION = 'article-sections-v4-infer-source-language'

export function articleInputFingerprint(
  slide: SlideData,
  modelId = slide.transcript?.articleModel ?? DEFAULT_ARTICLE_MODEL_ID,
) {
  return JSON.stringify([
    slide.id,
    slide.transcript?.raw ?? '',
    slide.ocr?.rawText ?? '',
    modelId,
    ARTICLE_PROMPT_VERSION,
  ])
}

export function hasCurrentArticle(slide: SlideData, modelId?: string) {
  const articleModelId = modelId ?? slide.transcript?.articleModel ?? DEFAULT_ARTICLE_MODEL_ID
  return (
    Boolean(slide.transcript?.articleBody?.trim()) &&
    slide.transcript?.articleInputFingerprint === articleInputFingerprint(slide, articleModelId)
  )
}

export function articleSlidesWithSpeech(project: MediaProject) {
  return articleBlockViews(project.slides, project.articleBlocks).filter((slide) =>
    Boolean(slide.transcript?.raw.trim()),
  )
}

export function articleTranscriptInput(project: MediaProject) {
  return articleSlidesWithSpeech(project)
    .map((slide) => slide.transcript?.raw ?? '')
    .join('\n\n')
}

export function hasAllSpeechArticleBodies(project: MediaProject) {
  const slides = articleSlidesWithSpeech(project)
  return (
    slides.length > 0 && slides.every((slide) => Boolean(slide.transcript?.articleBody?.trim()))
  )
}

export function articleSummaryInput(project: MediaProject) {
  return articleSlidesWithSpeech(project)
    .flatMap((slide) => {
      const body = slide.transcript?.articleBody?.trim()
      return body
        ? [
            `<SLIDE ${String(slide.index + 1).padStart(2, '0')} ARTICLE BODY>\n${body}\n</SLIDE ARTICLE BODY>`,
          ]
        : []
    })
    .join('\n\n')
}

export function articleSummaryInputFingerprint(
  project: MediaProject,
  modelId = project.article?.summary?.model ?? DEFAULT_ARTICLE_MODEL_ID,
) {
  return JSON.stringify([
    articleSlidesWithSpeech(project).map((slide) => [
      slide.id,
      slide.transcript?.articleBody ?? '',
    ]),
    modelId,
    ARTICLE_SUMMARY_PROMPT_VERSION,
  ])
}

export function hasCurrentArticleSummary(
  project: MediaProject,
  modelId = project.article?.summary?.model ?? DEFAULT_ARTICLE_MODEL_ID,
) {
  const summary = project.article?.summary
  return Boolean(
    summary?.overview.trim() &&
    summary.mainMessage.trim() &&
    summary.keyPoints.length > 0 &&
    summary.keywords.length > 0 &&
    summary.inputFingerprint === articleSummaryInputFingerprint(project, modelId),
  )
}

export function articleSectionsInput(project: MediaProject) {
  return articleSlidesWithSpeech(project)
    .map((slide) => {
      return [
        `<SLIDE id="${slide.id}" index="${slide.index + 1}">`,
        `<ARTICLE BODY>\n${slide.transcript?.articleBody?.trim() || '(本文なし)'}\n</ARTICLE BODY>`,
        '</SLIDE>',
      ].join('\n')
    })
    .join('\n\n')
}

export function articleSectionsInputFingerprint(
  project: MediaProject,
  modelId = project.article?.sections?.model ?? DEFAULT_ARTICLE_MODEL_ID,
) {
  return JSON.stringify([
    articleSlidesWithSpeech(project).map((slide) => [
      slide.id,
      slide.index,
      slide.transcript?.articleBody ?? '',
    ]),
    modelId,
    ARTICLE_SECTIONS_PROMPT_VERSION,
  ])
}

export function hasCurrentArticleSections(
  project: MediaProject,
  modelId = project.article?.sections?.model ?? DEFAULT_ARTICLE_MODEL_ID,
) {
  const sections = project.article?.sections
  return Boolean(
    sections?.sections.length &&
    sections.inputFingerprint === articleSectionsInputFingerprint(project, modelId),
  )
}
