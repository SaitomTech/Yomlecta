import { useEffect, useRef, useState } from 'react'
import { formatPlaybackTime } from '../article-creator/rangeDraft'
import { rangeLabelLayout } from './rangeLabelLayout'

export function SourceRangeLabels({
  startMs,
  endMs,
  durationMs,
  color,
}: {
  startMs: number
  endMs: number
  durationMs: number
  color: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const combinedRef = useRef<HTMLSpanElement>(null)
  const [sizes, setSizes] = useState({ width: 0, combinedWidth: 0 })
  const start = formatPlaybackTime(startMs)
  const end = formatPlaybackTime(endMs)
  const combined = `${start} – ${end}`

  useEffect(() => {
    const container = containerRef.current
    const combinedLabel = combinedRef.current
    if (!container || !combinedLabel) return

    const observer = new ResizeObserver(() => {
      const next = {
        width: container.getBoundingClientRect().width,
        combinedWidth: combinedLabel.getBoundingClientRect().width,
      }
      setSizes((previous) =>
        previous.width === next.width && previous.combinedWidth === next.combinedWidth
          ? previous
          : next,
      )
    })
    observer.observe(container)
    observer.observe(combinedLabel)
    return () => observer.disconnect()
  }, [])

  const layout = rangeLabelLayout({
    ...sizes,
    startRatio: startMs / durationMs,
    endRatio: endMs / durationMs,
  })

  return (
    <div
      ref={containerRef}
      className="relative mb-1 h-3 font-mono text-[9px] leading-none"
      style={{ color }}
      aria-hidden="true"
    >
      <div className="pointer-events-none invisible absolute top-0 whitespace-nowrap">
        <span ref={combinedRef} className="inline-block whitespace-pre">
          {combined}
        </span>
      </div>
      {sizes.width > 0 && (
        <span
          className="absolute top-0 max-w-full truncate whitespace-nowrap"
          style={{ left: layout.combinedLeft }}
          title={combined}
        >
          {combined}
        </span>
      )}
    </div>
  )
}
