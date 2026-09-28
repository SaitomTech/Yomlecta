import type { SlideData, VisualSegmentKind } from '../../types/project'

export const visualKindAppearance: Record<
  VisualSegmentKind,
  { label: string; card: string; dot: string; timeline: string }
> = {
  slide: {
    label: 'スライド',
    card: 'border-[#5c9b78] bg-[#edf7ef]',
    dot: 'bg-[#39845a]',
    timeline: 'bg-[#4b9b6c]',
  },
  'non-slide': {
    label: '非スライド',
    card: 'border-[#7184b7] bg-[#f1f3fb]',
    dot: 'bg-[#657bb2]',
    timeline: 'bg-[#7184b7]',
  },
  unknown: {
    label: '要確認',
    card: 'border-[#c59733] bg-[#fff8e8]',
    dot: 'bg-[#b1811c]',
    timeline: 'bg-[#c59733]',
  },
}

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
