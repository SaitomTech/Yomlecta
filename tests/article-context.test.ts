import { expect, test } from 'bun:test'
import { articleInputFingerprint, hasCurrentArticle } from '../src/features/article/article'
import type { SlideData } from '../src/types/project'

function slide(raw: string): SlideData {
  return {
    id: 'slide',
    index: 0,
    startMs: 0,
    endMs: 1000,
    autoKind: 'slide',
    personLayout: 'none',
    detection: { source: 'auto' },
    image: {},
    transcript: { raw, model: 'test' },
  }
}

test('本文の更新判定には確定済み担当発話を使う', () => {
  const target = slide('assigned speech')
  target.transcript!.articleBody = 'body'
  target.transcript!.articleInputFingerprint = articleInputFingerprint(target, 'model')
  expect(hasCurrentArticle(target, 'model')).toBe(true)
  target.transcript!.raw += ' changed'
  expect(hasCurrentArticle(target, 'model')).toBe(false)
})

test('担当発話が空のブロックは空本文を正式な生成結果として扱う', () => {
  const target = slide('')
  target.transcript!.articleBody = ''
  target.transcript!.articleInputFingerprint = articleInputFingerprint(target, 'model')
  expect(hasCurrentArticle(target, 'model')).toBe(true)
  expect(hasCurrentArticle(target, 'other-model')).toBe(false)
})
