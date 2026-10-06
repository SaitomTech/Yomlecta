import { DEFAULT_ARTICLE_MODEL_ID } from '../../lib/article/articleModel'
import { assignedArticleSlides } from '../../lib/pipeline/transcriptBoundaries'
import type { ArticleContext, ArticleBlockView } from '../../types/project'

const ARTICLE_PROMPT_VERSION = 'content-processing-v19-assigned-transcripts'
const ARTICLE_SUMMARY_PROMPT_VERSION = 'article-summary-v4-infer-source-language'
const ARTICLE_SECTIONS_PROMPT_VERSION = 'article-sections-v4-infer-source-language'

export function articleInputFingerprint(
  slide: ArticleBlockView,
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

export function hasCurrentArticle(slide: ArticleBlockView, modelId?: string) {
  const articleModelId = modelId ?? slide.transcript?.articleModel ?? DEFAULT_ARTICLE_MODEL_ID
  return (
    (slide.transcript?.raw.trim()
      ? Boolean(slide.transcript?.articleBody?.trim())
      : slide.transcript?.articleBody === '') &&
    slide.transcript?.articleInputFingerprint === articleInputFingerprint(slide, articleModelId)
  )
}

export function articleSlidesWithSpeech(project: ArticleContext) {
  return assignedArticleSlides(project).filter((slide) => Boolean(slide.transcript?.raw.trim()))
}

export function articleTranscriptInput(project: ArticleContext) {
  return articleSlidesWithSpeech(project)
    .map((slide) => slide.transcript?.raw ?? '')
    .join('\n\n')
}

export function hasAllSpeechArticleBodies(project: ArticleContext) {
  const slides = articleSlidesWithSpeech(project)
  return (
    slides.length > 0 && slides.every((slide) => Boolean(slide.transcript?.articleBody?.trim()))
  )
}

export function articleSummaryInput(project: ArticleContext) {
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
  project: ArticleContext,
  modelId = project.article.document?.summary?.model ?? DEFAULT_ARTICLE_MODEL_ID,
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

export function articleSectionsInput(project: ArticleContext) {
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
  project: ArticleContext,
  modelId = project.article.document?.sections?.model ?? DEFAULT_ARTICLE_MODEL_ID,
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
  project: ArticleContext,
  modelId = project.article.document?.sections?.model ?? DEFAULT_ARTICLE_MODEL_ID,
) {
  const sections = project.article.document?.sections
  return Boolean(
    sections?.sections.length &&
    sections.inputFingerprint === articleSectionsInputFingerprint(project, modelId),
  )
}
