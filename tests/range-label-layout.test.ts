import { expect, test } from 'bun:test'
import { rangeLabelLayout } from '../src/features/project/components/rangeLabelLayout'

const sizes = { width: 400, combinedWidth: 75 }

test('wide and short ranges both center a single label over the selected interval', () => {
  for (const [startRatio, endRatio] of [
    [0.2, 0.8],
    [0.25, 0.3],
  ]) {
    const layout = rangeLabelLayout({ ...sizes, startRatio, endRatio })
    expect(layout.combinedLeft + sizes.combinedWidth / 2).toBeCloseTo(
      ((startRatio + endRatio) / 2) * sizes.width,
    )
  }
})

test('labels stay inside both ends of the full timeline', () => {
  const left = rangeLabelLayout({ ...sizes, startRatio: 0, endRatio: 0.02 })
  const right = rangeLabelLayout({ ...sizes, startRatio: 0.98, endRatio: 1 })
  expect(left.combinedLeft).toBe(0)
  expect(right.combinedLeft + sizes.combinedWidth).toBe(sizes.width)
})

test('the full video range keeps its label centered', () => {
  const layout = rangeLabelLayout({ ...sizes, startRatio: 0, endRatio: 1 })
  expect(layout.combinedLeft + sizes.combinedWidth / 2).toBe(sizes.width / 2)
})

test('resizing keeps the label within the resized timeline', () => {
  const range = { ...sizes, startRatio: 0.7, endRatio: 0.9 }
  expect(rangeLabelLayout(range).combinedLeft).toBeCloseTo(282.5)
  const narrow = rangeLabelLayout({ ...range, width: 160 })
  expect(narrow.combinedLeft + sizes.combinedWidth).toBe(160)
})

test('labels wider than the timeline anchor at its left edge for truncation', () => {
  const layout = rangeLabelLayout({ ...sizes, width: 40, startRatio: 0.2, endRatio: 0.8 })
  expect(layout.combinedLeft).toBe(0)
})
