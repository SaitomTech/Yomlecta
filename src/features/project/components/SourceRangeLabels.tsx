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
  const startRef = useRef<HTMLSpanElement>(null)
  const endRef = useRef<HTMLSpanElement>(null)
  const combinedRef = useRef<HTMLSpanElement>(null)
  const [sizes, setSizes] = useState({ width: 0, startWidth: 0, endWidth: 0, combinedWidth: 0 })
  const start = formatPlaybackTime(startMs)
  const end = formatPlaybackTime(endMs)
  const combined = `${start} – ${end}`

  useEffect(() => {
    const container = containerRef.current
    const startLabel = startRef.current
    const endLabel = endRef.current
    const combinedLabel = combinedRef.current
    if (!container || !startLabel || !endLabel || !combinedLabel) return

    const observer = new ResizeObserver(() => {
      const next = {
        width: container.getBoundingClientRect().width,
        startWidth: startLabel.getBoundingClientRect().width,
        endWidth: endLabel.getBoundingClientRect().width,
        combinedWidth: combinedLabel.getBoundingClientRect().width,
      }
      setSizes((previous) =>
        previous.width === next.width &&
        previous.startWidth === next.startWidth &&
        previous.endWidth === next.endWidth &&
        previous.combinedWidth === next.combinedWidth
          ? previous
          : next,
      )
    })
    for (const element of [container, startLabel, endLabel, combinedLabel])
      observer.observe(element)
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
        <span ref={startRef} className="inline-block">
          {start}
        </span>
        <span ref={endRef} className="inline-block">
          {end}
        </span>
        <span ref={combinedRef} className="inline-block">
          {combined}
        </span>
      </div>
      {sizes.width > 0 &&
        (layout.combined ? (
          <span
            className="absolute top-0 max-w-full truncate"
            style={{ left: layout.combinedLeft }}
            title={combined}
          >
            {combined}
          </span>
        ) : (
          <>
            {layout.showStart && (
              <span className="absolute top-0 whitespace-nowrap" style={{ left: layout.startLeft }}>
                {start}
              </span>
            )}
            {layout.showEnd && (
              <span className="absolute top-0 whitespace-nowrap" style={{ left: layout.endLeft }}>
                {end}
              </span>
            )}
          </>
        ))}
    </div>
  )
}
