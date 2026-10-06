import { expect, test } from 'bun:test'
import { rangeLabelLayout } from '../src/features/project/components/rangeLabelLayout'

const sizes = { width: 400, startWidth: 30, endWidth: 30, combinedWidth: 65 }

test('wide ranges center timestamps over their respective endpoints', () => {
  const layout = rangeLabelLayout({ ...sizes, startRatio: 0.2, endRatio: 0.8 })
  expect(layout.combined).toBe(false)
  expect(layout.startLeft + sizes.startWidth / 2).toBe(80)
  expect(layout.endLeft + sizes.endWidth / 2).toBe(320)
})

test('short ranges use one label centered over the selected interval', () => {
  const layout = rangeLabelLayout({ ...sizes, startRatio: 0.25, endRatio: 0.3 })
  expect(layout.combined).toBe(true)
  expect(layout.combinedLeft + sizes.combinedWidth / 2).toBeCloseTo(110)
})

test('combined labels stay inside both ends of the full timeline', () => {
  const left = rangeLabelLayout({ ...sizes, startRatio: 0.01, endRatio: 0.03 })
  const right = rangeLabelLayout({ ...sizes, startRatio: 0.97, endRatio: 0.99 })
  expect(left.combined).toBe(true)
  expect(left.combinedLeft).toBe(0)
  expect(right.combined).toBe(true)
  expect(right.combinedLeft + sizes.combinedWidth).toBe(sizes.width)
})

test('resizing a timeline can switch the same interval to a combined label', () => {
  const range = { ...sizes, startRatio: 0.2, endRatio: 0.4 }
  expect(rangeLabelLayout(range).combined).toBe(false)
  expect(rangeLabelLayout({ ...range, width: 160 }).combined).toBe(true)
})

test('label widths account for timestamps longer than two-digit minutes', () => {
  const range = { ...sizes, startRatio: 0.2, endRatio: 0.4 }
  expect(rangeLabelLayout(range).combined).toBe(false)
  expect(rangeLabelLayout({ ...range, startWidth: 75, endWidth: 75 }).combined).toBe(true)
})

test('timestamps at the full video boundaries are hidden independently', () => {
  const start = rangeLabelLayout({ ...sizes, startRatio: 0, endRatio: 0.02 })
  expect(start.showStart).toBe(false)
  expect(start.showEnd).toBe(true)
  expect(start.combined).toBe(false)

  const end = rangeLabelLayout({ ...sizes, startRatio: 0.98, endRatio: 1 })
  expect(end.showStart).toBe(true)
  expect(end.showEnd).toBe(false)
  expect(end.combined).toBe(false)

  const full = rangeLabelLayout({ ...sizes, startRatio: 0, endRatio: 1 })
  expect(full.showStart).toBe(false)
  expect(full.showEnd).toBe(false)
  expect(full.combined).toBe(false)
})
