import type { SlideData } from '../../types/project'

export function timelinePosition(timestampMs: number, durationMs: number) {
  if (durationMs <= 0) return 0
  return Math.min(Math.max(timestampMs / durationMs, 0), 1) * 100
}

export function slideDuration(slide: SlideData) {
  return Math.max(0, slide.endMs - slide.startMs)
}

export function slideRangeKey(slide: Pick<SlideData, 'startMs' | 'endMs'>) {
  return `${Math.round(slide.startMs)}-${Math.round(slide.endMs)}`
}
