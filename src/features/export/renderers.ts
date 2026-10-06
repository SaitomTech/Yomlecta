import { PDF_TEXT_FLOW_SCRIPT } from './pdfTextFlow'
import { formatTimestamp } from '../../lib/time'
import type { ArticleSummary, ArticleTranslationSummary } from '../../types/project'
import { articleLanguageLabel } from '../article/articleLanguage'
import type { ExportDocument, ExportSection } from './export'

const EXPORT_LABELS = {
  ja: {
    article: '生成された記事',
    summary: 'AI要約',
    markdownSummary: '要約',
    sourceVideo: '元動画',
    noSpeech: '（発話なし）',
    mainMessage: '中心メッセージ',
    keyPoints: '主なポイント',
    keywords: 'キーワード',
    enlargeImage: '画像を拡大',
    enlarge: '拡大',
    representativeImage: '代表画像',
    close: '閉じる',
    enlargedImage: '拡大画像',
  },
  en: {
    article: 'Generated article',
    summary: 'AI summary',
    markdownSummary: 'Summary',
    sourceVideo: 'Source video',
    noSpeech: '(No speech)',
    mainMessage: 'Main message',
    keyPoints: 'Key points',
    keywords: 'Keywords',
    enlargeImage: 'Enlarge image',
    enlarge: 'Enlarge',
    representativeImage: 'Representative image',
    close: 'Close',
    enlargedImage: 'Enlarged image',
  },
} as const

function exportLabels(language: string) {
  return language === 'en' ? EXPORT_LABELS.en : EXPORT_LABELS.ja
}

function escapeHtml(value: string) {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }

  return value.replace(/[&<>"']/g, (character) => entities[character])
}

function safeHeading(value: string) {
  return value
    .replace(/[\r\n]/g, ' ')
    .replace(/^#+\s*/, '')
    .trim()
}

function renderBodyHtml(body: string) {
  return body
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
}

function renderSummaryLanguageBlock(
  content: string,
  language: string,
  showLanguageLabel: boolean,
  isSecondary: boolean,
) {
  return [
    `            <div class="summary-language-block${isSecondary ? ' summary-language-block-secondary' : ''}" lang="${escapeHtml(language)}">`,
    showLanguageLabel
      ? `              <p class="summary-language-label">${escapeHtml(articleLanguageLabel(language))}</p>`
      : '',
    content,
    '            </div>',
  ]
    .filter(Boolean)
    .join('\n')
}

function renderSummaryIcon() {
  return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /><path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" /></svg>'
}

function renderSummaryHtml(
  summary?: ArticleSummary | ArticleTranslationSummary,
  language = 'ja',
  heading: string = exportLabels(language).summary,
  secondarySummary?: ArticleTranslationSummary,
  secondaryLanguage?: string,
) {
  if (!summary) return ''

  const labels = exportLabels(language)
  const bilingual = Boolean(secondarySummary && secondaryLanguage)
  const languages = [
    { summary, language, secondary: false },
    ...(secondarySummary && secondaryLanguage
      ? [{ summary: secondarySummary, language: secondaryLanguage, secondary: true }]
      : []),
  ]
  const overviews = languages
    .map(({ summary: value, language: contentLanguage, secondary }) =>
      renderSummaryLanguageBlock(
        renderBodyHtml(value.overview),
        contentLanguage,
        bilingual,
        secondary,
      ),
    )
    .join('\n')
  const messages = languages
    .map(({ summary: value, language: contentLanguage, secondary }) =>
      renderSummaryLanguageBlock(
        `              <p>${escapeHtml(value.mainMessage)}</p>`,
        contentLanguage,
        bilingual,
        secondary,
      ),
    )
    .join('\n')
  const keyPoints = languages
    .map(({ summary: value, language: contentLanguage, secondary }) =>
      renderSummaryLanguageBlock(
        [
          '              <ul>',
          ...value.keyPoints.map((point) => `                <li>${escapeHtml(point)}</li>`),
          '              </ul>',
        ].join('\n'),
        contentLanguage,
        bilingual,
        secondary,
      ),
    )
    .join('\n')
  const keywords = languages
    .map(({ summary: value, language: contentLanguage, secondary }) =>
      renderSummaryLanguageBlock(
        [
          '              <div class="keywords">',
          ...value.keywords.map((keyword) => `                <span>${escapeHtml(keyword)}</span>`),
          '              </div>',
        ].join('\n'),
        contentLanguage,
        bilingual,
        secondary,
      ),
    )
    .join('\n')

  return [
    `      <section class="article-summary" lang="${escapeHtml(language)}">`,
    '        <header class="summary-header">',
    '          <h2 class="summary-title">',
    renderSummaryIcon(),
    `            ${escapeHtml(heading)}`,
    '          </h2>',
    '        </header>',
    '        <div class="summary-body">',
    `          <div class="summary-overview">\n${overviews}\n          </div>`,
    '          <div class="summary-group summary-message">',
    `            <h3>${escapeHtml(labels.mainMessage)}</h3>`,
    messages,
    '          </div>',
    '          <div class="summary-grid">',
    '            <div class="summary-group">',
    `              <h3>${escapeHtml(labels.keyPoints)}</h3>`,
    keyPoints,
    '            </div>',
    '            <div class="summary-group">',
    `              <h3>${escapeHtml(labels.keywords)}</h3>`,
    keywords,
    '            </div>',
    '          </div>',
    '        </div>',
    '      </section>',
  ]
    .filter(Boolean)
    .join('\n')
}

function renderMarkdownSummary(
  summary?: ArticleSummary | ArticleTranslationSummary,
  language = 'ja',
  heading: string = exportLabels(language).markdownSummary,
) {
  if (!summary) return ''

  const labels = exportLabels(language)
  return [
    `## ${heading}`,
    '',
    summary.overview,
    '',
    `### ${labels.mainMessage}`,
    '',
    summary.mainMessage,
    '',
    `### ${labels.keyPoints}`,
    '',
    ...summary.keyPoints.map((point) => `- ${point}`),
    '',
    `### ${labels.keywords}`,
    '',
    summary.keywords.map((keyword) => `\`${keyword}\``).join(' · '),
  ].join('\n')
}

function renderTxtSummary(
  summary?: ArticleSummary | ArticleTranslationSummary,
  language = 'ja',
  heading: string = exportLabels(language).markdownSummary,
) {
  if (!summary) return ''

  const labels = exportLabels(language)
  return [
    heading,
    '====',
    summary.overview,
    '',
    labels.mainMessage,
    summary.mainMessage,
    '',
    labels.keyPoints,
    ...summary.keyPoints.map((point) => `・${point}`),
    '',
    labels.keywords,
    summary.keywords.map((keyword) => `・${keyword}`).join('\n'),
  ].join('\n')
}

type ArticleChapter = {
  heading?: string
  slides: ExportSection[]
}

function renderSlideHtml(slide: ExportSection, sourceLanguage: string) {
  const labels = exportLabels(sourceLanguage)
  const body = slide.body.trim() ? renderBodyHtml(slide.body) : ''
  const translations = slide.translations
    .filter((translation) => translation.body.trim())
    .map((translation) =>
      [
        `                <section class="translated-body" lang="${escapeHtml(translation.language)}">`,
        `                  <p class="translation-label">${escapeHtml(articleLanguageLabel(translation.language))}</p>`,
        `                  ${renderBodyHtml(translation.body)}`,
        '                </section>',
      ].join('\n'),
    )
  const sourceLabel =
    body && translations.length
      ? `<p class="translation-label">${escapeHtml(articleLanguageLabel(sourceLanguage))}</p>`
      : ''
  const figure = slide.imagePath
    ? [
        '              <figure class="slide-figure">',
        `                <button class="image-preview-trigger" type="button" data-preview-image="${escapeHtml(slide.imagePath)}" aria-label="${labels.enlargeImage}">`,
        `                  <img src="${escapeHtml(slide.imagePath)}" alt="${labels.representativeImage}">`,
        `                  <span class="image-preview-hint" aria-hidden="true">${labels.enlarge}</span>`,
        '                </button>',
        `                <figcaption class="slide-time">${formatTimestamp(slide.startMs)} — ${formatTimestamp(slide.endMs)}</figcaption>`,
        '              </figure>',
      ]
    : [
        `              <p class="slide-time">${formatTimestamp(slide.startMs)} — ${formatTimestamp(slide.endMs)}</p>`,
      ]
  return [
    '          <article class="slide-section">',
    '            <div class="section-content">',
    ...figure,
    `              <div class="content" lang="${escapeHtml(sourceLanguage)}">${sourceLabel}${body}${translations.length ? `\n${translations.join('\n')}` : ''}</div>`,
    '            </div>',
    '          </article>',
  ].join('\n')
}

function getArticleChapters(document: ExportDocument): ArticleChapter[] {
  if (!document.articleSections?.length) return []

  const sectionsBySlideId = new Map(
    document.articleSections.flatMap((section) =>
      section.slideIds.map((slideId) => [slideId, section] as const),
    ),
  )
  const chapters: ArticleChapter[] = []
  let lastChapterId: string | null = null

  for (const slide of [...document.sections].sort((first, second) => first.index - second.index)) {
    const section = sectionsBySlideId.get(slide.id)
    // Unassigned images keep their chronological position without splitting a section.
    if (!section && chapters.length > 0) {
      chapters.at(-1)!.slides.push(slide)
      continue
    }
    const chapterId = section?.id ?? '__unassigned__'
    if (lastChapterId !== chapterId) {
      chapters.push({
        heading: section?.heading,
        slides: [],
      })
      lastChapterId = chapterId
    }
    chapters.at(-1)?.slides.push(slide)
  }

  return chapters
}

function renderArticleSectionsHtml(document: ExportDocument) {
  if (!document.articleSections?.length) return ''
  const chapters = getArticleChapters(document)
    .map((chapter) => {
      const slides = chapter.slides
        .map((slide) => renderSlideHtml(slide, document.sourceLanguage))
        .join('\n')
      const heading = safeHeading(chapter.heading ?? '')
      const translatedHeadings =
        chapter.slides[0]?.translations
          .filter((translation) => translation.heading?.trim())
          .map(
            (translation) =>
              `          <p class="translated-section-heading" lang="${escapeHtml(translation.language)}"><span>${escapeHtml(articleLanguageLabel(translation.language))}</span> ${escapeHtml(safeHeading(translation.heading ?? ''))}</p>`,
          )
          .join('\n') ?? ''
      const sourceHeadingLabel = translatedHeadings
        ? `          <p class="translation-label source-section-heading-label">${escapeHtml(articleLanguageLabel(document.sourceLanguage))}</p>\n`
        : ''
      if (!heading) {
        return [
          '      <section class="article-section article-section-unassigned">',
          slides,
          '      </section>',
        ].join('\n')
      }

      return [
        '      <section class="article-section">',
        '        <div class="article-section-heading">',
        `          <div>${sourceHeadingLabel}<h2 lang="${escapeHtml(document.sourceLanguage)}">${escapeHtml(heading)}</h2>${translatedHeadings ? `\n${translatedHeadings}` : ''}</div>`,
        '        </div>',
        slides,
        '      </section>',
      ].join('\n')
    })
    .join('\n')

  return `    <article class="article-sections">\n${chapters}\n    </article>`
}

export function renderHtml(document: ExportDocument) {
  const labels = exportLabels(document.sourceLanguage)
  const sections = document.articleSections?.length
    ? ''
    : document.sections.map((slide) => renderSlideHtml(slide, document.sourceLanguage)).join('\n')

  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(document.sourceLanguage)}">`,
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${escapeHtml(document.title)}</title>`,
    '  <style>',
    '    :root { color: #18211f; background: #fbfcfa; font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif; }',
    '    * { box-sizing: border-box; }',
    '    body { margin: 0; background: #fbfcfa; }',
    '    main { width: min(100% - 32px, 960px); margin: 0 auto; padding: 24px 0 64px; }',
    '    .article-document-header { margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid #d8e1dc; }',
    '    .article-kicker { margin: 0 0 6px; color: #1d6b50; font-size: 12px; font-weight: 600; }',
    '    .article-title { margin: 0; font-size: clamp(24px, 5vw, 40px); letter-spacing: -0.05em; line-height: 1.2; }',
    '    .translated-title { margin: 12px 0 0; color: #52615b; font-size: clamp(19px, 3.5vw, 28px); line-height: 1.35; }',
    '    .source { margin: 10px 0 0; color: #71807b; font-size: 13px; }',
    '    .article-summary { margin: 0 0 28px; overflow: hidden; border: 1px solid #b7cbc0; border-radius: 15px; background: #fbfcfa; }',
    '    .summary-header { padding: 18px 22px; border-bottom: 1px solid #d8e1dc; background: #eef6f0; }',
    '    .summary-title { display: flex; align-items: center; gap: 7px; margin: 0; color: #1d6b50; font-size: 20px; letter-spacing: -0.04em; }',
    '    .summary-title svg { width: 16px; height: 16px; flex: 0 0 auto; }',
    '    .summary-body { padding: 22px; }',
    '    .summary-overview { margin: 0; }',
    '    .summary-overview p { margin: 0 0 12px; font-size: 15px; line-height: 1.8; }',
    '    .summary-language-label { margin: 0 0 6px; color: #71807b; font-size: 10px; font-weight: 600; }',
    '    .summary-language-block-secondary { margin-top: 12px; padding-top: 12px; border-top: 1px solid #e0e8e3; }',
    '    .summary-message { margin-top: 22px; padding: 14px 18px; border-radius: 9px; background: #f4f8f4; }',
    '    .summary-message p { margin: 0; font-size: 15px; line-height: 1.8; }',
    '    .summary-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 28px; margin-top: 22px; padding-top: 18px; border-top: 1px solid #d8e1dc; }',
    '    .summary-group h3 { margin: 0 0 10px; color: #71807b; font-size: 11px; letter-spacing: .03em; }',
    '    .summary-group ul { margin: 0; padding-left: 18px; }',
    '    .summary-group li { margin: 0 0 7px; font-size: 14px; line-height: 1.7; }',
    '    .keywords { display: flex; flex-wrap: wrap; gap: 7px; }',
    '    .keywords span { padding: 4px 9px; border: 1px solid #b7cbc0; border-radius: 999px; color: #53615b; background: #f4f8f4; font-size: 12px; }',
    '    .article-sections { margin: 0; }',
    '    .article-section { padding: 0 0 24px; }',
    '    .article-section + .article-section { margin-top: 20px; padding-top: 0; }',
    '    .article-section-heading { display: flex; min-height: 44px; align-items: center; margin-bottom: 10px; padding: 7px 12px; border-left: 10px solid #8bb6a2; background: #e8f2ec; }',
    '    .article-section h2 { margin: 0; font-size: 22px; line-height: 1.35; letter-spacing: -.05em; }',
    '    .translated-section-heading { margin: 4px 0 0; color: #53615b; font-size: 15px; line-height: 1.45; }',
    '    .translated-section-heading span, .translation-label { color: #71807b; font-size: 11px; font-weight: 600; letter-spacing: .02em; }',
    '    .translated-section-heading span { margin-right: 5px; }',
    '    .article-section-heading .source-section-heading-label { margin: 0 0 4px; }',
    '    .translated-body { margin-top: 20px; padding-top: 14px; border-top: 1px dashed #c7d4cc; }',
    '    .translated-body .translation-label { margin-bottom: 8px; }',
    '    .slide-section { padding: 8px 0 18px; }',
    '    .section-content { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 32px; align-items: start; }',
    '    figure { margin: 0; }',
    '    .slide-figure { position: relative; }',
    '    .slide-time { position: absolute; right: auto; bottom: 10px; left: 10px; margin: 0; padding: 4px 7px; border-radius: 5px; color: #f3faf6; background: rgba(24,33,31,.78); font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }',
    '    .image-preview-trigger { position: relative; display: block; width: 100%; padding: 0; border: 0; color: inherit; background: transparent; cursor: zoom-in; text-align: left; }',
    '    .image-preview-trigger:focus-visible { outline: 2px solid #1d6b50; outline-offset: 4px; }',
    '    .image-preview-hint { position: absolute; right: 10px; bottom: 10px; padding: 4px 7px; border-radius: 5px; color: #f3faf6; background: rgba(24,33,31,.78); font-size: 11px; opacity: 0; transition: opacity .16s ease; }',
    '    .image-preview-trigger:hover .image-preview-hint, .image-preview-trigger:focus-visible .image-preview-hint { opacity: 1; }',
    '    img { display: block; width: 100%; height: auto; border: 1px solid #d8e1dc; }',
    '    .content { min-width: 0; }',
    '    .content > .translation-label { margin: 0 0 8px; }',
    '    .image-lightbox { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; padding: 24px; background: rgba(24,33,31,.76); }',
    '    .image-lightbox[hidden] { display: none; }',
    '    .image-lightbox img { width: auto; max-width: min(100%, 1280px); max-height: calc(100vh - 48px); object-fit: contain; box-shadow: 0 20px 70px rgba(0,0,0,.28); }',
    '    .image-lightbox-close { position: fixed; top: 16px; right: 16px; display: grid; width: 36px; height: 36px; place-items: center; padding: 0; border: 1px solid rgba(243,250,246,.5); border-radius: 50%; color: #f3faf6; background: rgba(24,33,31,.5); cursor: pointer; font-size: 22px; line-height: 1; }',
    '    .image-lightbox-close:hover, .image-lightbox-close:focus-visible { background: rgba(24,33,31,.78); }',
    '    p { margin: 0 0 16px; font-size: 16px; line-height: 1.9; }',
    '    @media (max-width: 600px) { main { padding-top: 20px; } .summary-body { padding: 18px; } .summary-grid { grid-template-columns: 1fr; gap: 22px; } .article-section-heading { border-left-width: 8px; } .article-section h2 { font-size: 20px; } .slide-section { padding: 6px 0 16px; } .section-content { display: block; } figure { width: auto; margin: 0 0 24px; } .image-preview-hint { opacity: .85; } p { font-size: 14px; } }',
    '    @media print { @page { size: A4; margin: 14mm; } body { background: #fff; } main { width: auto; max-width: none; padding: 0; } .image-preview-trigger { cursor: default; } .image-preview-hint, .image-lightbox { display: none !important; } figure, .summary-group, .article-section-heading { break-inside: avoid; } img { max-height: 100mm; object-fit: contain; } p { orphans: 3; widows: 3; } }',
    '  </style>',
    '</head>',
    '<body>',
    '  <main>',
    '    <header class="article-document-header">',
    `      <p class="article-kicker">${labels.article}</p>`,
    ...(document.translations.length
      ? [
          `      <p class="translation-label">${escapeHtml(articleLanguageLabel(document.sourceLanguage))}</p>`,
        ]
      : []),
    `      <h1 class="article-title" lang="${escapeHtml(document.sourceLanguage)}">${escapeHtml(document.title)}</h1>`,
    ...document.translations.map(
      (translation) =>
        `      <p class="translated-title" lang="${escapeHtml(translation.language)}"><span class="translation-label">${escapeHtml(articleLanguageLabel(translation.language))}</span> ${escapeHtml(translation.title)}</p>`,
    ),
    `      <p class="source">${escapeHtml(document.sourceName)} · ${formatTimestamp(document.durationMs)}</p>`,
    '    </header>',
    renderSummaryHtml(
      document.summary,
      document.sourceLanguage,
      labels.summary,
      document.translations[0]?.summary,
      document.translations[0]?.language,
    ),
    renderArticleSectionsHtml(document),
    sections,
    '  </main>',
    '  <div class="image-lightbox" id="image-lightbox" hidden>',
    `    <button class="image-lightbox-close" type="button" data-close-lightbox aria-label="${labels.close}">×</button>`,
    `    <img alt="${labels.enlargedImage}">`,
    '  </div>',
    '  <script>',
    '    (() => {',
    '      const lightbox = document.getElementById("image-lightbox")',
    '      const lightboxImage = lightbox?.querySelector("img")',
    '      const closeLightbox = () => {',
    '        if (!lightbox || !lightboxImage) return',
    '        lightbox.hidden = true',
    '        lightboxImage.removeAttribute("src")',
    '        document.body.style.removeProperty("overflow")',
    '      }',
    '      document.querySelectorAll("[data-preview-image]").forEach((trigger) => {',
    '        trigger.addEventListener("click", () => {',
    '          const imagePath = trigger.dataset.previewImage || ""',
    '          if (!lightbox || !lightboxImage) return',
    '          lightboxImage.src = imagePath',
    '          lightbox.hidden = false',
    '          document.body.style.overflow = "hidden"',
    '        })',
    '      })',
    '      lightbox?.querySelector("[data-close-lightbox]")?.addEventListener("click", closeLightbox)',
    '      lightbox?.addEventListener("click", (event) => { if (event.target === lightbox) closeLightbox() })',
    '      document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeLightbox() })',
    '    })()',
    '  </script>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

function pdfChapterTitle(chapter: ArticleChapter) {
  const explicitHeading = safeHeading(chapter.heading ?? '')
  if (explicitHeading) return explicitHeading

  const firstSlide = chapter.slides[0]
  const firstLine = firstSlide?.body
    .trim()
    .split(/\n|(?<=[。.!?])\s*/u)[0]
    ?.trim()
  if (firstLine) {
    const title = Array.from(firstLine).slice(0, 42).join('')
    return title.length < firstLine.length ? `${title}…` : title
  }

  return ''
}

function getPdfChapters(document: ExportDocument): ArticleChapter[] {
  const structuredChapters = getArticleChapters(document)
  if (structuredChapters.length) return structuredChapters

  const sortedSlides = [...document.sections].sort((first, second) => first.index - second.index)
  const slidesPerChapter = 5
  const chapters: ArticleChapter[] = []
  for (let index = 0; index < sortedSlides.length; index += slidesPerChapter) {
    chapters.push({ slides: sortedSlides.slice(index, index + slidesPerChapter) })
  }
  return chapters
}

function renderPdfTranslations(slide: ExportSection) {
  return slide.translations
    .filter((translation) => translation.body.trim())
    .map(
      (translation) =>
        `<div class="translation" lang="${escapeHtml(translation.language)}"><h4>${escapeHtml(articleLanguageLabel(translation.language))}</h4>${renderBodyHtml(translation.body)}</div>`,
    )
    .join('\n')
}

function renderPdfSlide(
  slide: ExportSection,
  sourceLanguage: string,
  continuations: ExportSection[] = [],
) {
  const labels = exportLabels(sourceLanguage)
  const body = slide.body.trim() ? renderBodyHtml(slide.body) : `<p>${labels.noSpeech}</p>`
  const leadEnd = body.indexOf('</p>') + 4
  const leadBody = body.slice(0, leadEnd)
  const remainingBody = body.slice(leadEnd)
  const translations = renderPdfTranslations(slide)
  const figure = slide.imagePath
    ? `<figure><img src="${escapeHtml(slide.imagePath)}" alt="${escapeHtml(labels.representativeImage)}"><figcaption>${formatTimestamp(slide.startMs)} — ${formatTimestamp(slide.endMs)}</figcaption></figure>`
    : `<p class="timestamp">${formatTimestamp(slide.startMs)} — ${formatTimestamp(slide.endMs)}</p>`

  return [
    `<article class="pdf-slide" id="slide-${slide.index + 1}">`,
    `<table class="slide-layout slide-start" role="presentation"><tbody><tr><td class="slide-visual">${figure}</td><td class="slide-text">`,
    `<div class="slide-copy"><div class="prose" lang="${escapeHtml(sourceLanguage)}">${leadBody}</div></div>`,
    '</td></tr></tbody></table>',
    `<table class="slide-layout slide-remainder" role="presentation"><tbody><tr><td class="slide-visual"></td><td class="slide-text"><div class="slide-copy"><div class="prose" lang="${escapeHtml(sourceLanguage)}">${remainingBody}</div>${translations}${continuations.map((continuation) => renderPdfContinuation(continuation, sourceLanguage)).join('\n')}</div>`,
    '</td></tr></tbody></table>',
    '</article>',
  ]
    .filter(Boolean)
    .join('\n')
}

function renderPdfContinuation(slide: ExportSection, sourceLanguage: string) {
  const body = slide.body.trim() ? renderBodyHtml(slide.body) : ''
  const translations = renderPdfTranslations(slide)
  return `<div class="pdf-continuation" id="slide-${slide.index + 1}"><p class="timestamp">${formatTimestamp(slide.startMs)} — ${formatTimestamp(slide.endMs)}</p><div class="prose" lang="${escapeHtml(sourceLanguage)}">${body}</div>${translations}</div>`
}

function renderPdfChapter(
  chapter: ArticleChapter,
  index: number,
  sourceLanguage: string,
  marker: string,
) {
  const groups: Array<{ slide: ExportSection; continuations: ExportSection[] }> = []
  for (const slide of chapter.slides) {
    if (!slide.imagePath && groups.length > 0) groups.at(-1)!.continuations.push(slide)
    else groups.push({ slide, continuations: [] })
  }
  const heading = pdfChapterTitle(chapter)
  const translatedHeading = chapter.slides[0]?.translations
    .filter((translation) => translation.heading?.trim())
    .map(
      (translation) =>
        `<p class="translated-heading" lang="${escapeHtml(translation.language)}">${escapeHtml(articleLanguageLabel(translation.language))}: ${escapeHtml(safeHeading(translation.heading ?? ''))}</p>`,
    )
    .join('\n')
  return [
    `<section class="pdf-chapter" id="chapter-${index + 1}">`,
    `<header>${heading ? `<h2 lang="${escapeHtml(sourceLanguage)}">${escapeHtml(heading)}</h2>` : ''}${translatedHeading ?? ''}${marker ? `<span class="pdf-page-marker" aria-hidden="true">${marker}</span>` : ''}</header>`,
    groups
      .map(({ slide, continuations }) => renderPdfSlide(slide, sourceLanguage, continuations))
      .join('\n'),
    '</section>',
  ].join('\n')
}

export function renderPdfHtml(document: ExportDocument) {
  const labels = exportLabels(document.sourceLanguage)
  const chapters = getPdfChapters(document)
  const contentsLabel = document.sourceLanguage === 'en' ? 'Contents' : '目次'
  const summaryLabel = document.sourceLanguage === 'en' ? 'Overview' : 'AI要約'
  const durationLabel = document.sourceLanguage === 'en' ? 'Duration' : '動画時間'
  let numberedChapterCount = 0
  const chapterEntries = chapters.map((chapter, index) => {
    const title = pdfChapterTitle(chapter)
    const marker = title ? `YOMLECTACHAPTER${String(++numberedChapterCount).padStart(4, '0')}` : ''
    return { chapter, index, title, marker }
  })
  const titledEntries = chapterEntries.filter((entry) => entry.title)
  const toc = titledEntries
    .map(
      ({ index, title, marker }) =>
        `<li><a href="#chapter-${index + 1}"><span class="toc-title">${escapeHtml(title)}</span><span class="toc-page" data-target="${marker}">—</span></a></li>`,
    )
    .join('\n')
  const chapterHtml = chapterEntries
    .map(({ chapter, index, marker }) =>
      renderPdfChapter(chapter, index, document.sourceLanguage, marker),
    )
    .join('\n')
  const outline = JSON.stringify(
    titledEntries.map(({ marker, title }) => ({ marker, title })),
  ).replace(/</gu, '\\u003c')
  const translations = document.translations
    .map(
      (translation) =>
        `<p class="translated-title" lang="${escapeHtml(translation.language)}"><span>${escapeHtml(articleLanguageLabel(translation.language))}</span>${escapeHtml(translation.title)}</p>`,
    )
    .join('\n')

  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(document.sourceLanguage)}">`,
    '<head>',
    '  <meta charset="utf-8">',
    `  <title>${escapeHtml(document.title)}</title>`,
    '  <style>',
    '    * { box-sizing: border-box; }',
    '    @page { size: A4; margin: 17mm 18mm 19mm; }',
    '    html { color: #1d2924; font-family: "Hiragino Sans", "Yu Gothic", sans-serif; font-size: 10pt; line-height: 1.72; }',
    '    body { margin: 0; background: #fff; }',
    '    main { width: 174mm; }',
    '    h1 { margin: 0; color: #14231c; font-size: 27pt; line-height: 1.3; letter-spacing: -.04em; }',
    '    .translated-title { margin: 5mm 0 0; color: #4b5b53; font-size: 15pt; line-height: 1.4; }',
    '    .translated-title span { display: block; margin-bottom: 1mm; color: #718078; font-size: 8pt; }',
    '    .source-meta { margin-top: 8mm; padding-top: 4mm; border-top: 1px solid #cbd8d0; color: #65736b; font-size: 9pt; }',
    '    .cover-summary { margin-top: 6mm; }',
    '    .cover-summary > h2, .toc h2 { margin: 0 0 6mm; color: #197052; font-size: 16pt; }',
    '    .cover-summary > h2 { display: flex; align-items: center; gap: 2mm; margin-bottom: 2mm; }',
    '    .cover-summary > h2 svg { width: 5mm; height: 5mm; flex: 0 0 auto; }',
    '    .cover-summary .summary-header { display: none; }',
    '    .cover-summary .article-summary { border: 0; border-top: 2px solid #197052; border-radius: 0; }',
    '    .cover-summary .summary-body { padding: 4mm 0 0; }',
    '    .cover-summary .summary-overview p, .cover-summary .summary-message p { font-size: 9pt; line-height: 1.65; }',
    '    .cover-summary .summary-message { margin-top: 4mm; padding: 3mm 5mm 2mm; border-radius: 2.5mm; background: #f4f8f4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
    '    .cover-summary .summary-message .summary-language-block:last-child > p:last-child { margin-bottom: 0; }',
    '    .cover-summary .summary-grid { margin-top: 4mm; }',
    '    .cover-summary .summary-group h3 { margin: 0 0 2mm; color: #65736b; font-size: 8pt; }',
    '    .cover-summary .summary-group li { margin-bottom: 1mm; font-size: 8pt; }',
    '    .cover-summary .keywords { display: flex; flex-wrap: wrap; gap: 1mm; }',
    '    .cover-summary .keywords span { padding: .5mm 2mm; border: 1px solid #cbd8d0; border-radius: 8mm; color: #53615b; font-size: 7pt; }',
    '    .toc { page-break-before: always; break-before: page; page-break-after: always; break-after: page; }',
    '    .toc-list { margin: 0; padding: 0; list-style: none; border-top: 1px solid #d7e0da; }',
    '    .toc-list li { border-bottom: 1px solid #d7e0da; break-inside: avoid; }',
    '    .toc-list a { display: flex; align-items: baseline; gap: 2mm; padding: 2.5mm 0; color: inherit; text-decoration: none; }',
    '    .toc-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '    .toc-page { display: block; flex: 0 0 16mm; padding: 0 1mm; overflow: visible; color: #197052; text-align: right; font-variant-numeric: tabular-nums; }',
    '    .pdf-chapter { margin-top: 4.5mm; }',
    '    .pdf-chapter > header { position: relative; margin: 0 0 3mm; padding: 0 0 2mm; border-bottom: 1.2px solid #197052; break-after: avoid; }',
    '    h2 { margin: 0; color: #14231c; font-size: 14pt; line-height: 1.3; }',
    '    .translated-heading { margin: 1mm 0 0; color: #65736b; font-size: 8pt; }',
    '    .pdf-page-marker { position: absolute; top: 0; left: 0; color: #fff; font-size: 1px; line-height: 1px; }',
    '    .pdf-slide { display: block; margin: 0 0 3mm; padding: 0 0 2mm; break-inside: auto; }',
    '    .slide-layout { width: 100%; table-layout: fixed; border-collapse: collapse; page-break-inside: auto; break-inside: auto; }',
    '    .slide-layout tr, .slide-layout td { page-break-inside: auto; break-inside: auto; }',
    '    .slide-layout td { padding: 0; vertical-align: top; }',
    '    .slide-start, .slide-start tr, .slide-start td { page-break-inside: avoid; break-inside: avoid; }',
    '    .slide-layout .slide-visual { width: 74mm; padding-right: 4mm; }',
    '    .slide-copy { margin: 0; }',
    '    .pdf-continuation { margin-top: 3mm; }',
    '    .pdf-continuation > .timestamp { margin-bottom: 1mm; }',
    '    figure { margin: 0; break-inside: avoid; }',
    '    figure img { display: block; width: 100%; max-height: 54mm; object-fit: contain; object-position: top center; }',
    '    figcaption, .timestamp { margin: 1mm 0 0; color: #718078; font-size: 7pt; text-align: left; font-variant-numeric: tabular-nums; }',
    '    p { margin: 0 0 1.5mm; orphans: 2; widows: 2; }',
    '    .prose { font-size: 9pt; line-height: 1.52; }',
    '    .slide-start .prose { display: flow-root; }',
    '    .slide-start .prose > p:last-child { margin-bottom: 0; }',
    '    .paragraph-continuation { margin-top: 0; }',
    '    .translation { margin-top: 2mm; padding-top: 1.5mm; border-top: 1px dashed #cbd8d0; }',
    '    .translation h4 { margin: 0 0 1mm; color: #718078; font-size: 7pt; }',
    '    h1, h2, h3, h4 { page-break-after: avoid; break-after: avoid; }',
    '  </style>',
    '</head>',
    '<body>',
    '<main>',
    '<section class="cover">',
    `<h1 lang="${escapeHtml(document.sourceLanguage)}">${escapeHtml(document.title)}</h1>`,
    translations,
    `<p class="source-meta">${escapeHtml(document.sourceName)} · ${durationLabel} ${formatTimestamp(document.durationMs)}</p>`,
    document.summary
      ? `<section class="cover-summary"><h2>${renderSummaryIcon()}${summaryLabel}</h2>${renderSummaryHtml(document.summary, document.sourceLanguage, labels.summary, document.translations[0]?.summary, document.translations[0]?.language)}</section>`
      : '',
    '</section>',
    '<nav class="toc">',
    `<h2>${contentsLabel}</h2>`,
    `<ol class="toc-list">${toc}</ol>`,
    '</nav>',
    chapterHtml,
    '</main>',
    `<script id="pdf-outline-data" type="application/json">${outline}</script>`,
    `<script>${PDF_TEXT_FLOW_SCRIPT}</script>`,
    '</body>',
    '</html>',
    '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function renderMarkdown(document: ExportDocument) {
  const labels = exportLabels(document.sourceLanguage)
  const translatedTitles = document.translations.map(
    (translation) =>
      `## ${articleLanguageLabel(translation.language)}: ${safeHeading(translation.title)}`,
  )
  const translatedSummaries = document.translations
    .map((translation) =>
      renderMarkdownSummary(
        translation.summary,
        translation.language,
        `${exportLabels(translation.language).markdownSummary} · ${articleLanguageLabel(translation.language)}`,
      ),
    )
    .filter(Boolean)

  if (document.articleSections?.length) {
    let chapterNumber = 0
    const chapters = getArticleChapters(document)
      .map((chapter) => {
        const slides = chapter.slides
          .map((slide) => {
            const slideLabel = `Slide ${String(slide.index + 1).padStart(2, '0')}`
            return [
              `### ${slideLabel} · ${formatTimestamp(slide.startMs)} — ${formatTimestamp(slide.endMs)}`,
              '',
              ...(slide.imagePath ? [`![${slideLabel}](${slide.imagePath})`, ''] : []),
              slide.body.trim() || labels.noSpeech,
              ...slide.translations.flatMap((translation) =>
                translation.body.trim()
                  ? [
                      '',
                      `**${articleLanguageLabel(translation.language)}:**`,
                      '',
                      translation.body.trim(),
                    ]
                  : [],
              ),
            ].join('\n')
          })
          .join('\n\n')
        const heading = safeHeading(chapter.heading ?? '')
        const translatedHeadings =
          chapter.slides[0]?.translations
            .filter((translation) => translation.heading?.trim())
            .map(
              (translation) =>
                `### ${articleLanguageLabel(translation.language)}: ${safeHeading(translation.heading ?? '')}`,
            ) ?? []
        if (heading) chapterNumber += 1
        return heading
          ? [
              `## ${String(chapterNumber).padStart(2, '0')} ${heading}`,
              ...translatedHeadings,
              '',
              slides,
            ].join('\n')
          : slides
      })
      .join('\n\n')
    const summary = renderMarkdownSummary(document.summary, document.sourceLanguage)
    return [
      `# ${safeHeading(document.title)}`,
      ...translatedTitles,
      '',
      `${labels.sourceVideo}: ${document.sourceName}`,
      ...(summary ? ['', summary] : []),
      ...translatedSummaries.flatMap((translatedSummary) => ['', translatedSummary]),
      '',
      chapters,
      '',
    ].join('\n')
  }

  const sections = document.sections
    .map((section) => {
      const slideLabel = `Slide ${String(section.index + 1).padStart(2, '0')}`
      const body = section.body.trim() || labels.noSpeech

      return [
        `## ${slideLabel} · ${formatTimestamp(section.startMs)} — ${formatTimestamp(section.endMs)}`,
        '',
        ...(section.imagePath ? [`![${slideLabel}](${section.imagePath})`, ''] : []),
        body,
        ...section.translations.flatMap((translation) =>
          translation.body.trim()
            ? [
                '',
                `**${articleLanguageLabel(translation.language)}:**`,
                '',
                translation.body.trim(),
              ]
            : [],
        ),
      ].join('\n')
    })
    .join('\n\n')

  const summary = renderMarkdownSummary(document.summary, document.sourceLanguage)

  return [
    `# ${safeHeading(document.title)}`,
    ...translatedTitles,
    '',
    `${labels.sourceVideo}: ${document.sourceName}`,
    ...(summary ? ['', summary] : []),
    ...translatedSummaries.flatMap((translatedSummary) => ['', translatedSummary]),
    '',
    sections,
    '',
  ].join('\n')
}

export function renderTxt(document: ExportDocument) {
  const labels = exportLabels(document.sourceLanguage)
  const translatedTitles = document.translations.map(
    (translation) => `${articleLanguageLabel(translation.language)}: ${translation.title}`,
  )
  const translatedSummaries = document.translations
    .map((translation) =>
      renderTxtSummary(
        translation.summary,
        translation.language,
        `${exportLabels(translation.language).markdownSummary} · ${articleLanguageLabel(translation.language)}`,
      ),
    )
    .filter(Boolean)

  if (document.articleSections?.length) {
    let chapterNumber = 0
    const chapters = getArticleChapters(document)
      .map((chapter) => {
        const slides = chapter.slides
          .map((slide) => {
            const slideLabel = `Slide ${String(slide.index + 1).padStart(2, '0')}`
            return [
              `${slideLabel} | ${formatTimestamp(slide.startMs)} — ${formatTimestamp(slide.endMs)}`,
              '',
              slide.body.trim() || labels.noSpeech,
              ...slide.translations.flatMap((translation) =>
                translation.body.trim()
                  ? ['', `${articleLanguageLabel(translation.language)}:`, translation.body.trim()]
                  : [],
              ),
            ].join('\n')
          })
          .join('\n\n')
        const heading = safeHeading(chapter.heading ?? '')
        const translatedHeadings =
          chapter.slides[0]?.translations
            .filter((translation) => translation.heading?.trim())
            .map(
              (translation) =>
                `${articleLanguageLabel(translation.language)}: ${safeHeading(translation.heading ?? '')}`,
            ) ?? []
        if (heading) chapterNumber += 1
        return heading
          ? [
              `${String(chapterNumber).padStart(2, '0')} ${heading}`,
              ...translatedHeadings,
              '',
              slides,
            ]
              .filter(Boolean)
              .join('\n\n')
          : slides
      })
      .join('\n\n------------------------------\n\n')
    const summary = renderTxtSummary(document.summary, document.sourceLanguage)
    return [
      document.title,
      ...translatedTitles,
      `${labels.sourceVideo}: ${document.sourceName}`,
      ...(summary ? ['', summary] : []),
      ...translatedSummaries.flatMap((translatedSummary) => ['', translatedSummary]),
      '',
      chapters,
      '',
    ].join('\n')
  }

  const sections = document.sections
    .map((section) => {
      const slideLabel = `Slide ${String(section.index + 1).padStart(2, '0')}`
      const body = section.body.trim() || labels.noSpeech

      return [
        `${slideLabel} | ${formatTimestamp(section.startMs)} — ${formatTimestamp(section.endMs)}`,
        '',
        body,
        ...section.translations.flatMap((translation) =>
          translation.body.trim()
            ? ['', `${articleLanguageLabel(translation.language)}:`, translation.body.trim()]
            : [],
        ),
      ].join('\n')
    })
    .join('\n\n------------------------------\n\n')

  const summary = renderTxtSummary(document.summary, document.sourceLanguage)

  return [
    document.title,
    ...translatedTitles,
    `${labels.sourceVideo}: ${document.sourceName}`,
    ...(summary ? ['', summary] : []),
    ...translatedSummaries.flatMap((translatedSummary) => ['', translatedSummary]),
    '',
    sections,
    '',
  ].join('\n')
}
