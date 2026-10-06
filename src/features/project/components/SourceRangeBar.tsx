import type { VideoTrimRange } from '../../../types/project'
import { formatPlaybackTime, rangeColor } from '../article-creator/rangeDraft'

export function SourceRangeBar({
  ranges,
  durationMs,
  showRangeLabels = false,
}: {
  ranges: Array<{ id: string; title: string; range: VideoTrimRange; colorIndex: number }>
  durationMs: number
  showRangeLabels?: boolean
}) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null

  const segments = ranges.map(({ id, title, range, colorIndex }) => {
    const startMs = Math.min(durationMs, Math.max(0, range.startMs))
    const endMs = Math.min(durationMs, Math.max(startMs, range.endMs))
    return { id, title, startMs, endMs, color: rangeColor(colorIndex) }
  })
  const label = segments
    .map(
      ({ title, startMs, endMs }) =>
        `${title || '無題の記事'}: ${formatPlaybackTime(startMs)} から ${formatPlaybackTime(endMs)}`,
    )
    .join('、')

  return (
    <div
      className="w-full"
      role="img"
      aria-label={`動画全体 ${formatPlaybackTime(durationMs)} の記事区間${label ? `、${label}` : 'なし'}`}
    >
      {showRangeLabels && segments.length === 1 && (
        <div
          className="relative mb-1 h-3 font-mono text-[9px] leading-none"
          style={{ color: segments[0].color.text }}
          aria-hidden="true"
        >
          <span
            className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${(segments[0].startMs / durationMs) * 100}%` }}
          >
            {formatPlaybackTime(segments[0].startMs)}
          </span>
          <span
            className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${(segments[0].endMs / durationMs) * 100}%` }}
          >
            {formatPlaybackTime(segments[0].endMs)}
          </span>
        </div>
      )}
      <div className="relative h-2 overflow-hidden rounded-full bg-[#e5ebe8]" aria-hidden="true">
        {segments.map(({ id, title, startMs, endMs, color }) => (
          <span
            key={id}
            className="absolute inset-y-0 rounded-full"
            title={`${title || '無題の記事'}: ${formatPlaybackTime(startMs)} — ${formatPlaybackTime(endMs)}`}
            style={{
              left: `${(startMs / durationMs) * 100}%`,
              width: `${((endMs - startMs) / durationMs) * 100}%`,
              backgroundColor: color.bar,
              boxShadow: `inset 0 0 0 1px ${color.border}99`,
            }}
          />
        ))}
      </div>
      <div
        className="mt-1 flex justify-between font-mono text-[9px] text-[#71807b]"
        aria-hidden="true"
      >
        <span>0:00</span>
        <span>{formatPlaybackTime(durationMs)}</span>
      </div>
    </div>
  )
}
