import type { SlideData } from '../../types/project'

/** Slide times are article-relative; media playback uses source video times. */
export function getSegmentPlaybackRange(
  slide: Pick<SlideData, 'startMs' | 'endMs'>,
  sourceOffsetMs: number,
) {
  const startTime = Math.max(0, (sourceOffsetMs + slide.startMs) / 1000)
  const endTime = Math.max(startTime, (sourceOffsetMs + slide.endMs) / 1000)
  return { startTime, endTime }
}
