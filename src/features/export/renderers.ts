import { formatTimestamp } from '../../lib/time'
import type { ArticleSummary } from '../../types/project'
import type { ExportDocument, ExportSection } from './export'

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

function renderSummaryHtml(summary?: ArticleSummary) {
  if (!summary) return ''

  const keyPoints = summary.keyPoints
    .map((point) => `          <li>${escapeHtml(point)}</li>`)
    .join('\n')
  const keywords = summary.keywords
    .map((keyword) => `          <span>${escapeHtml(keyword)}</span>`)
    .join('\n')

  return [
    '      <section class="article-summary">',
    '        <header class="summary-header">',
    '          <h2 class="summary-title">',
    '            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
    '              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />',
    '              <path d="M5 3v4" />',
    '              <path d="M19 17v4" />',
    '              <path d="M3 5h4" />',
    '              <path d="M17 19h4" />',
    '            </svg>',
    '            AI要約',
    '          </h2>',
    '        </header>',
    '        <div class="summary-body">',
    `          <div class="summary-overview">${renderBodyHtml(summary.overview)}</div>`,
    '          <div class="summary-group summary-message">',
    '            <h3>中心メッセージ</h3>',
    `            <p>${escapeHtml(summary.mainMessage)}</p>`,
    '          </div>',
    '          <div class="summary-grid">',
    '            <div class="summary-group">',
    '              <h3>主なポイント</h3>',
    '              <ul>',
    keyPoints,
    '              </ul>',
    '            </div>',
    '            <div class="summary-group">',
    '              <h3>キーワード</h3>',
    '              <div class="keywords">',
    keywords,
    '              </div>',
    '            </div>',
    '          </div>',
    '        </div>',
    '      </section>',
  ]
    .filter(Boolean)
    .join('\n')
}

function renderMarkdownSummary(summary?: ArticleSummary) {
  if (!summary) return ''

  return [
    '## 要約',
    '',
    summary.overview,
    '',
    '### 主なポイント',
    '',
    ...summary.keyPoints.map((point) => `- ${point}`),
    '',
    '### キーワード',
    '',
    summary.keywords.map((keyword) => `\`${keyword}\``).join(' · '),
  ].join('\n')
}

function renderTxtSummary(summary?: ArticleSummary) {
  if (!summary) return ''

  return [
    '要約',
    '====',
    summary.overview,
    '',
    '中心メッセージ',
    summary.mainMessage,
    '',
    '主なポイント',
    ...summary.keyPoints.map((point) => `・${point}`),
    '',
    'キーワード',
    summary.keywords.map((keyword) => `・${keyword}`).join('\n'),
  ].join('\n')
}

type ArticleChapter = {
  heading?: string
  slides: ExportSection[]
}

function renderSlideHtml(slide: ExportSection) {
  const body = slide.body.trim() ? renderBodyHtml(slide.body) : ''
  return [
    '          <article class="slide-section">',
    '            <div class="section-content">',
    '              <figure class="slide-figure">',
    `                <button class="image-preview-trigger" type="button" data-preview-image="${escapeHtml(slide.imagePath)}" aria-label="画像を拡大">`,
    `                  <img src="${escapeHtml(slide.imagePath)}" alt="代表画像">`,
    '                  <span class="image-preview-hint" aria-hidden="true">拡大</span>',
    '                </button>',
    `                <figcaption class="slide-time">${formatTimestamp(slide.startMs)} — ${formatTimestamp(slide.endMs)}</figcaption>`,
    '              </figure>',
    `              <div class="content">${body}</div>`,
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
      const slides = chapter.slides.map(renderSlideHtml).join('\n')
      const heading = safeHeading(chapter.heading ?? '')
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
        `          <h2>${escapeHtml(heading)}</h2>`,
        '        </div>',
        slides,
        '      </section>',
      ].join('\n')
    })
    .join('\n')

  return `    <article class="article-sections">\n${chapters}\n    </article>`
}

export function renderHtml(document: ExportDocument) {
  const sections = document.articleSections?.length
    ? ''
    : document.sections.map(renderSlideHtml).join('\n')

  return [
    '<!doctype html>',
    '<html lang="ja">',
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
    '    .source { margin: 10px 0 0; color: #71807b; font-size: 13px; }',
    '    .article-summary { margin: 0 0 28px; overflow: hidden; border: 1px solid #b7cbc0; border-radius: 15px; background: #fbfcfa; }',
    '    .summary-header { padding: 18px 22px; border-bottom: 1px solid #d8e1dc; background: #eef6f0; }',
    '    .summary-title { display: flex; align-items: center; gap: 7px; margin: 0; color: #1d6b50; font-size: 20px; letter-spacing: -0.04em; }',
    '    .summary-title svg { width: 16px; height: 16px; flex: 0 0 auto; }',
    '    .summary-body { padding: 22px; }',
    '    .summary-overview { margin: 0; }',
    '    .summary-overview p { margin: 0 0 12px; font-size: 15px; line-height: 1.8; }',
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
    '    .image-lightbox { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; padding: 24px; background: rgba(24,33,31,.76); }',
    '    .image-lightbox[hidden] { display: none; }',
    '    .image-lightbox img { width: auto; max-width: min(100%, 1280px); max-height: calc(100vh - 48px); object-fit: contain; box-shadow: 0 20px 70px rgba(0,0,0,.28); }',
    '    .image-lightbox-close { position: fixed; top: 16px; right: 16px; display: grid; width: 36px; height: 36px; place-items: center; padding: 0; border: 1px solid rgba(243,250,246,.5); border-radius: 50%; color: #f3faf6; background: rgba(24,33,31,.5); cursor: pointer; font-size: 22px; line-height: 1; }',
    '    .image-lightbox-close:hover, .image-lightbox-close:focus-visible { background: rgba(24,33,31,.78); }',
    '    p { margin: 0 0 16px; font-size: 16px; line-height: 1.9; }',
    '    @media (max-width: 600px) { main { padding-top: 20px; } .summary-body { padding: 18px; } .summary-grid { grid-template-columns: 1fr; gap: 22px; } .article-section-heading { border-left-width: 8px; } .article-section h2 { font-size: 20px; } .slide-section { padding: 6px 0 16px; } .section-content { display: block; } figure { width: auto; margin: 0 0 24px; } .image-preview-hint { opacity: .85; } p { font-size: 14px; } }',
    '  </style>',
    '</head>',
    '<body>',
    '  <main>',
    '    <header class="article-document-header">',
    '      <p class="article-kicker">生成された記事</p>',
    `      <h1 class="article-title">${escapeHtml(document.title)}</h1>`,
    `      <p class="source">${escapeHtml(document.sourceName)} · ${formatTimestamp(document.durationMs)}</p>`,
    '    </header>',
    renderSummaryHtml(document.summary),
    renderArticleSectionsHtml(document),
    sections,
    '  </main>',
    '  <div class="image-lightbox" id="image-lightbox" hidden>',
    '    <button class="image-lightbox-close" type="button" data-close-lightbox aria-label="閉じる">×</button>',
    '    <img alt="拡大画像">',
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
    '          if (window.parent !== window) {',
    '            window.parent.postMessage({ type: "preview-image", src: imagePath }, "*")',
    '            return',
    '          }',
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

export function renderMarkdown(document: ExportDocument) {
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
              `![${slideLabel}](${slide.imagePath})`,
              '',
              slide.body.trim() || '（発話なし）',
            ].join('\n')
          })
          .join('\n\n')
        const heading = safeHeading(chapter.heading ?? '')
        if (heading) chapterNumber += 1
        return heading
          ? [`## ${String(chapterNumber).padStart(2, '0')} ${heading}`, '', slides].join('\n')
          : slides
      })
      .join('\n\n')
    const summary = renderMarkdownSummary(document.summary)
    return [
      `# ${safeHeading(document.title)}`,
      '',
      `元動画: ${document.sourceName}`,
      ...(summary ? ['', summary] : []),
      '',
      chapters,
      '',
    ].join('\n')
  }

  const sections = document.sections
    .map((section) => {
      const slideLabel = `Slide ${String(section.index + 1).padStart(2, '0')}`
      const body = section.body.trim() || '（発話なし）'

      return [
        `## ${slideLabel} · ${formatTimestamp(section.startMs)} — ${formatTimestamp(section.endMs)}`,
        '',
        `![${slideLabel}](${section.imagePath})`,
        '',
        body,
      ].join('\n')
    })
    .join('\n\n')

  const summary = renderMarkdownSummary(document.summary)

  return [
    `# ${safeHeading(document.title)}`,
    '',
    `元動画: ${document.sourceName}`,
    ...(summary ? ['', summary] : []),
    '',
    sections,
    '',
  ].join('\n')
}

export function renderTxt(document: ExportDocument) {
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
              slide.body.trim() || '（発話なし）',
            ].join('\n')
          })
          .join('\n\n')
        const heading = safeHeading(chapter.heading ?? '')
        if (heading) chapterNumber += 1
        return heading
          ? [`${String(chapterNumber).padStart(2, '0')} ${heading}`, '', slides]
              .filter(Boolean)
              .join('\n\n')
          : slides
      })
      .join('\n\n------------------------------\n\n')
    const summary = renderTxtSummary(document.summary)
    return [
      document.title,
      `元動画: ${document.sourceName}`,
      ...(summary ? ['', summary] : []),
      '',
      chapters,
      '',
    ].join('\n')
  }

  const sections = document.sections
    .map((section) => {
      const slideLabel = `Slide ${String(section.index + 1).padStart(2, '0')}`
      const body = section.body.trim() || '（発話なし）'

      return [
        `${slideLabel} | ${formatTimestamp(section.startMs)} — ${formatTimestamp(section.endMs)}`,
        '',
        body,
      ].join('\n')
    })
    .join('\n\n------------------------------\n\n')

  const summary = renderTxtSummary(document.summary)

  return [
    document.title,
    `元動画: ${document.sourceName}`,
    ...(summary ? ['', summary] : []),
    '',
    sections,
    '',
  ].join('\n')
}
