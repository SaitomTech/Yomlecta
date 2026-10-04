import { expect, test } from 'bun:test'
import { staleExportAssetFilenames, type ExportDocument } from '../src/features/export/export'
import {
  renderHtml,
  renderMarkdown,
  renderTxt,
  renderPdfHtml,
} from '../src/features/export/renderers'

function englishDocument(): ExportDocument {
  return {
    title: 'Translated article',
    sourceLanguage: 'en',
    sourceName: 'lecture.mp4',
    durationMs: 60_000,
    summary: {
      overview: 'Overview',
      mainMessage: 'Main message body',
      keyPoints: ['First point'],
      keywords: ['keyword'],
    },
    translations: [],
    sections: [
      {
        id: 'slide-1',
        index: 0,
        startMs: 0,
        endMs: 60_000,
        imagePath: './assets/slide-001.jpg',
        sourceImagePath: '/tmp/slide-001.jpg',
        ocrText: '',
        transcriptRaw: '',
        body: '',
        translations: [],
      },
    ],
  }
}

test('English-only exports localize fixed labels in every format', () => {
  const document = englishDocument()
  const markdown = renderMarkdown(document)
  const text = renderTxt(document)
  const html = renderHtml(document)

  for (const output of [markdown, text]) {
    expect(output).toContain('Source video: lecture.mp4')
    expect(output).toContain('Summary')
    expect(output).toContain('Main message')
    expect(output).toContain('Key points')
    expect(output).toContain('Keywords')
    expect(output).toContain('(No speech)')
    expect(output).not.toContain('元動画')
    expect(output).not.toContain('中心メッセージ')
  }

  expect(html).toContain('<html lang="en">')
  expect(html).toContain('Generated article')
  expect(html).toContain('AI summary')
  expect(html).toContain('Main message')
  expect(html).not.toContain('生成された記事')
})

test('stale export assets are limited to managed slide image files', () => {
  expect(
    staleExportAssetFilenames(
      ['slide-001.jpg', 'slide-002.jpg', '../outside.jpg', 'notes.md'],
      new Set(['slide-002.jpg']),
    ),
  ).toEqual(['slide-001.jpg'])
})

test('image-less article blocks render as text without a broken image', () => {
  const document = englishDocument()
  document.sections[0] = {
    ...document.sections[0],
    imagePath: '',
    sourceImagePath: '',
    body: 'Spoken explanation',
  }

  expect(renderMarkdown(document)).not.toContain('![')
  expect(renderHtml(document)).not.toContain('<img src=""')
  expect(renderHtml(document)).toContain('Spoken explanation')
})

test('PDFの画像だけの区間は架空の見出し・目次を作らず画像を保持する', () => {
  for (const language of ['ja', 'en']) {
    const document = englishDocument()
    document.sourceLanguage = language
    const html = renderPdfHtml(document)
    expect(html).not.toContain('class="toc-title"')
    expect(html).not.toContain('<h2 lang=')
    expect(html).toContain('src="./assets/slide-001.jpg"')
    expect(html).toContain('id="chapter-1"')
  }
  const document = englishDocument()
  document.sections[0]!.body = 'Actual explanation.'
  expect(renderPdfHtml(document)).toContain('<span class="toc-title">Actual explanation.</span>')
})

test('PDFの見出しなし区間を挟んでも目次・本文・しおりの参照番号は連続する', () => {
  const document = englishDocument()
  document.sections = ['', 'First topic.', '', 'Second topic.'].map((body, index) => ({
    ...document.sections[0]!,
    id: `s${index}`,
    index,
    body,
  }))
  document.articleSections = document.sections.map((slide) => ({
    id: slide.id,
    heading: '',
    slideIds: [slide.id],
  }))
  const html = renderPdfHtml(document)
  const outline = JSON.parse(
    html.match(/<script id="pdf-outline-data" type="application\/json">(.*?)<\/script>/)![1]!,
  )
  expect(outline).toEqual([
    { marker: 'YOMLECTACHAPTER0001', title: 'First topic.' },
    { marker: 'YOMLECTACHAPTER0002', title: 'Second topic.' },
  ])
  expect(html).toContain('href="#chapter-2"')
  expect(html).toContain('href="#chapter-4"')
  expect(html).not.toContain('YOMLECTACHAPTER0003')
  for (const entry of outline) {
    expect(html).toContain(`data-target="${entry.marker}"`)
    expect(html).toContain(`aria-hidden="true">${entry.marker}</span>`)
  }
})

test('セクション内の未所属画像で見出しやPDF目次を重複させない', () => {
  const document = englishDocument()
  document.sections = ['Before.', '', 'After.'].map((body, index) => ({
    ...document.sections[0]!,
    id: `s${index}`,
    index,
    body,
    imagePath: `./assets/s${index}.jpg`,
  }))
  document.articleSections = [{ id: 'topic', heading: 'One topic', slideIds: ['s0', 's2'] }]
  const html = renderHtml(document)
  const pdf = renderPdfHtml(document)
  expect(html.match(/<h2 lang="en">One topic<\/h2>/g)).toHaveLength(1)
  expect(pdf.match(/class="toc-title">One topic/g)).toHaveLength(1)
  expect(pdf.match(/<h2 lang="en">One topic<\/h2>/g)).toHaveLength(1)
  for (const output of [html, pdf]) {
    expect(output.indexOf('Before.')).toBeLessThan(output.indexOf('src="./assets/s1.jpg"'))
    expect(output.indexOf('src="./assets/s1.jpg"')).toBeLessThan(output.indexOf('After.'))
  }
})

test('PDFの本文は冒頭と続きの描画領域で全段落を保持する', () => {
  const document = englishDocument()
  document.sections[0]!.body =
    'Short introduction.\n\nA longer explanation follows.\n\nFinal paragraph.'
  const html = renderPdfHtml(document)
  expect(html).toContain(
    '<div class="prose" lang="en">\n<p>A longer explanation follows.</p>\n<p>Final paragraph.</p></div>',
  )
  expect(html).not.toContain('slide-lead')
  expect(html).toContain('vertical-align: top')
})

test('画像のない後続ブロックを画像横の本文列に続けて配置する', () => {
  const document = englishDocument()
  document.sections[0]!.body = 'Short image explanation.'
  document.sections.push({
    ...document.sections[0]!,
    id: 'continuation',
    index: 1,
    imagePath: '',
    sourceImagePath: '',
    body: 'Following speech.',
  })
  const html = renderPdfHtml(document)
  expect(html.match(/class="pdf-slide"/g)).toHaveLength(1)
  expect(html).toContain('<div class="pdf-continuation" id="slide-2">')
  const column = html.indexOf('<div class="slide-copy">')
  expect(html.indexOf('Following speech.', column)).toBeLessThan(html.indexOf('</article>', column))
})

test('PDFは画像と本文を同じ行に配置し、本文のページまたぎを許可する', () => {
  const html = renderPdfHtml(englishDocument())
  expect(html).toContain(
    '<table class="slide-layout slide-start" role="presentation"><tbody><tr><td class="slide-visual">',
  )
  expect(html).toContain('</td><td class="slide-text">')
  expect(html).toContain(
    '.slide-layout tr, .slide-layout td { page-break-inside: auto; break-inside: auto; }',
  )
  expect(html).toContain(
    '.slide-start, .slide-start tr, .slide-start td { page-break-inside: avoid; break-inside: avoid; }',
  )
  expect(html).toContain('slide-remainder')
  expect(html).not.toContain('float: left')
  expect(html).not.toContain(
    '.pdf-slide { display: block; margin: 0 0 3mm; padding: 0 0 2mm; page-break-inside: avoid;',
  )
})
