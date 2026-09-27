import { describe, expect, test } from 'bun:test'
import {
  assignTranscriptToArticleBlocks,
  buildArticleBlocks,
  transcriptionRangesForArticleBlocks,
} from '../src/lib/pipeline/articleBlocks'
import type { VisualSegment } from '../src/types/project'

function segment(
  id: string,
  index: number,
  startMs: number,
  endMs: number,
  autoKind: VisualSegment['autoKind'],
  hash?: string,
): VisualSegment {
  return {
    id,
    index,
    startMs,
    endMs,
    autoKind,
    personLayout: autoKind === 'non-slide' ? 'dominant' : 'none',
    detection: { source: 'auto', ...(hash ? { hash } : {}) },
    image: { representativeFramePath: `/tmp/${id}.jpg` },
  }
}

describe('article blocks', () => {
  test('同じスライドの間の非スライド区間を1ブロックへ統合する', () => {
    const blocks = buildArticleBlocks([
      segment('a1', 0, 0, 1_000, 'slide', '0000000000000000'),
      segment('person', 1, 1_000, 2_000, 'non-slide'),
      segment('a2', 2, 2_000, 3_000, 'slide', '0000000000000000'),
    ])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.visualSegmentIds).toEqual(['a1', 'person', 'a2'])
    expect(blocks[0]?.imageSegmentId).toBe('a1')
  })

  test('異なるスライドの間の非スライド区間を直前へ割り当てる', () => {
    const blocks = buildArticleBlocks([
      segment('a', 0, 0, 1_000, 'slide', '0000000000000000'),
      segment('person', 1, 1_000, 2_000, 'non-slide'),
      segment('b', 2, 2_000, 3_000, 'slide', 'ffffffffffffffff'),
    ])

    expect(blocks.map((block) => block.visualSegmentIds)).toEqual([['a', 'person'], ['b']])
  })

  test('全編非スライドは画像なしの1ブロックになる', () => {
    const blocks = buildArticleBlocks([
      segment('one', 0, 0, 1_000, 'non-slide'),
      segment('two', 1, 1_000, 2_000, 'non-slide'),
    ])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.imageSegmentId).toBeUndefined()
  })

  test('unknownの後に同一画面のslideが来た場合は画像区間をブロックIDにする', () => {
    const blocks = buildArticleBlocks([
      segment('unknown', 0, 0, 1_000, 'unknown', '0000000000000000'),
      segment('slide', 1, 1_000, 2_000, 'slide', '0000000000000000'),
    ])

    expect(blocks[0]?.id).toBe('slide')
    expect(blocks[0]?.imageSegmentId).toBe('slide')
  })

  test('記事ブロックへ発話を時刻順で割り当てる', () => {
    const blocks = buildArticleBlocks([
      segment('a', 0, 0, 2_000, 'slide', '0000000000000000'),
      segment('b', 1, 2_000, 4_000, 'slide', 'ffffffffffffffff'),
    ])
    const assigned = assignTranscriptToArticleBlocks(
      blocks,
      [
        { id: 'two', startMs: 2_100, endMs: 2_900, text: 'second' },
        { id: 'one', startMs: 100, endMs: 900, text: 'first' },
      ],
      'test',
    )

    expect(assigned.map((block) => block.transcript?.raw)).toEqual(['first', 'second'])
  })

  test('全編を覆う時刻なし文字起こしを各記事ブロックへ分配する', () => {
    const blocks = buildArticleBlocks([
      segment('a', 0, 0, 30_000, 'slide', '0000000000000000'),
      segment('b', 1, 30_000, 60_000, 'slide', 'ffffffffffffffff'),
      segment('c', 2, 60_000, 90_000, 'slide', 'aaaaaaaaaaaaaaaa'),
    ])
    const fullText = '最初の区間です。次の区間です。最後の区間です。'
    const assigned = assignTranscriptToArticleBlocks(
      blocks,
      [{ id: 'fallback', startMs: 0, endMs: 90_000, text: fullText }],
      'test',
    )

    const blockTexts = assigned.map((block) => block.transcript?.raw ?? '')
    expect(blockTexts.every(Boolean)).toBe(true)
    expect(blockTexts.join('')).toBe(fullText)
  })

  test('通常の短い発話は境界をまたいでも最も重なる区分へ割り当てる', () => {
    const blocks = buildArticleBlocks([
      segment('a', 0, 0, 20_000, 'slide', '0000000000000000'),
      segment('b', 1, 20_000, 40_000, 'slide', 'ffffffffffffffff'),
    ])
    const assigned = assignTranscriptToArticleBlocks(
      blocks,
      [{ id: 'sentence', startMs: 18_000, endMs: 24_000, text: '境界をまたぐ短い発話' }],
      'test',
    )

    expect(assigned.map((block) => block.transcript?.raw)).toEqual(['', '境界をまたぐ短い発話'])
  })

  test('OpenAI文字起こし用の音声範囲を記事ブロック境界に揃える', () => {
    const ranges = transcriptionRangesForArticleBlocks(
      90_000,
      [
        { startMs: 0, endMs: 12_000 },
        { startMs: 12_000, endMs: 72_000 },
        { startMs: 72_000, endMs: 90_000 },
      ],
      15 * 60_000,
      60_000,
    )

    expect(ranges).toEqual([
      { startMs: 0, endMs: 72_000 },
      { startMs: 72_000, endMs: 90_000 },
    ])
  })

  test('短い記事ブロックが多くても文字起こし要求数を時間単位に制限する', () => {
    const blocks = Array.from({ length: 120 }, (_, index) => ({
      startMs: index * 5_000,
      endMs: (index + 1) * 5_000,
    }))
    const ranges = transcriptionRangesForArticleBlocks(10 * 60_000, blocks, 15 * 60_000, 60_000)

    expect(ranges).toHaveLength(10)
    expect(ranges[0]).toEqual({ startMs: 0, endMs: 60_000 })
    expect(ranges.at(-1)).toEqual({ startMs: 9 * 60_000, endMs: 10 * 60_000 })
  })

  test('記事ブロックがない場合も長い音声を上限時間で分割する', () => {
    expect(transcriptionRangesForArticleBlocks(20 * 60_000, [], 15 * 60_000)).toEqual([
      { startMs: 0, endMs: 15 * 60_000 },
      { startMs: 15 * 60_000, endMs: 20 * 60_000 },
    ])
  })
})
