import { expect, test } from 'bun:test'
import { staleExportAssetFilenames, type ExportDocument } from '../src/features/export/export'
import { renderHtml, renderMarkdown, renderTxt } from '../src/features/export/renderers'

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
