import type { VideoTrimRange } from '../../types/project'

const MINIMUM_RANGE_MS = 500

function clampVideoRange(range: VideoTrimRange, durationMs: number): VideoTrimRange {
  const safeDurationMs =
    Number.isFinite(durationMs) && durationMs > 0 ? durationMs : MINIMUM_RANGE_MS
  const minimumDurationMs = Math.min(MINIMUM_RANGE_MS, safeDurationMs)
  const startMs = Math.min(
    Math.max(0, Math.round(range.startMs)),
    safeDurationMs - minimumDurationMs,
  )
  const endMs = Math.min(
    safeDurationMs,
    Math.max(startMs + minimumDurationMs, Math.round(range.endMs)),
  )
  return { startMs, endMs }
}

/** Range helpers used only before an Article input video is created. */
export function normalizeTrimRange(range: VideoTrimRange, durationMs: number): VideoTrimRange {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error('動画の長さを確認できませんでした。')
  }
  const clamped = clampVideoRange(range, durationMs)
  // The range editor displays whole seconds. Treat the final displayed second
  // as the full video so the default range remains a direct copy.
  return clamped.startMs === 0 && clamped.endMs >= durationMs - 1000
    ? { startMs: 0, endMs: durationMs }
    : clamped
}
