import { expect, test } from 'bun:test'
import { articleInputFingerprint, hasCurrentArticle } from '../src/features/article/article'
import type { ArticleBlockView } from '../src/types/project'

function slide(raw: string): ArticleBlockView {
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
  const source = slide('assigned speech')
  const target = {
    ...source,
    transcript: {
      ...source.transcript!,
      articleBody: 'body',
      articleInputFingerprint: articleInputFingerprint(source, 'model'),
    },
  }
  expect(hasCurrentArticle(target, 'model')).toBe(true)
  const changed = {
    ...target,
    transcript: { ...target.transcript, raw: target.transcript.raw + ' changed' },
  }
  expect(hasCurrentArticle(changed, 'model')).toBe(false)
})

test('担当発話が空のブロックは空本文を正式な生成結果として扱う', () => {
  const source = slide('')
  const target = {
    ...source,
    transcript: {
      ...source.transcript!,
      articleBody: '',
      articleInputFingerprint: articleInputFingerprint(source, 'model'),
    },
  }
  expect(hasCurrentArticle(target, 'model')).toBe(true)
  expect(hasCurrentArticle(target, 'other-model')).toBe(false)
})
