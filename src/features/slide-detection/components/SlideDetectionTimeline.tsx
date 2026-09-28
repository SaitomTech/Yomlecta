import { useCallback, useRef, useState, type MouseEvent } from 'react'
import { effectiveVisualKind, type SlideBoundary, type SlideData } from '../../../types/project'
import { MINIMUM_BOUNDARY_GAP_MS } from '../detection'
import { formatTimestamp } from '../../../lib/time'
import { slideDuration, timelinePosition, visualKindAppearance } from '../utils'

type SlideDetectionTimelineProps = {
  boundaries: SlideBoundary[]
  durationMs: number
  slides: SlideData[]
  currentTimeMs: number
  activeSlideIndex: number
  onChange: (boundaries: SlideBoundary[]) => void
  onSeek: (timestampMs: number) => void
  disabled?: boolean
}

export function SlideDetectionTimeline({
  boundaries,
  durationMs,
  slides,
  currentTimeMs,
  activeSlideIndex,
  onChange,
  onSeek,
  disabled = false,
}: SlideDetectionTimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null)
  const [draggingBoundaryId, setDraggingBoundaryId] = useState<string | null>(null)
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false)

  const updateBoundaries = useCallback(
    (nextBoundaries: SlideBoundary[]) => {
      onChange(nextBoundaries.toSorted((first, second) => first.timestampMs - second.timestampMs))
    },
    [onChange],
  )

  const timestampAtClientX = useCallback(
    (clientX: number) => {
      const bounds = timelineRef.current?.getBoundingClientRect()
      if (!bounds || bounds.width === 0 || durationMs <= 0) return null
      const ratio = Math.min(Math.max((clientX - bounds.left) / bounds.width, 0), 1)
      return Math.round((ratio * durationMs) / 100) * 100
    },
    [durationMs],
  )

  const moveBoundary = useCallback(
    (boundaryId: string, clientX: number) => {
      if (disabled) return
      const timestampMs = timestampAtClientX(clientX)
      const index = boundaries.findIndex((boundary) => boundary.id === boundaryId)
      if (timestampMs === null || index < 0) return

      const minimum = (boundaries[index - 1]?.timestampMs ?? 0) + MINIMUM_BOUNDARY_GAP_MS
      const maximum = (boundaries[index + 1]?.timestampMs ?? durationMs) - MINIMUM_BOUNDARY_GAP_MS
      if (minimum > maximum) return

      updateBoundaries(
        boundaries.map((boundary) =>
          boundary.id === boundaryId
            ? {
                ...boundary,
                timestampMs: Math.min(Math.max(timestampMs, minimum), maximum),
                source: 'manual' as const,
              }
            : boundary,
        ),
      )
    },
    [boundaries, disabled, durationMs, timestampAtClientX, updateBoundaries],
  )

  const handleTimelineDoubleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (disabled) return
      const timestampMs = timestampAtClientX(event.clientX)
      if (
        timestampMs === null ||
        timestampMs < MINIMUM_BOUNDARY_GAP_MS ||
        timestampMs > durationMs - MINIMUM_BOUNDARY_GAP_MS
      )
        return
      if (
        boundaries.some(
          (boundary) => Math.abs(boundary.timestampMs - timestampMs) < MINIMUM_BOUNDARY_GAP_MS,
        )
      )
        return

      updateBoundaries([
        ...boundaries,
        {
          id: `manual-${timestampMs}-${Date.now()}`,
          timestampMs,
          distance: 0,
          source: 'manual',
        },
      ])
    },
    [boundaries, disabled, durationMs, timestampAtClientX, updateBoundaries],
  )

  return (
    <div className="relative h-16 w-full cursor-crosshair touch-none select-none">
      <div
        ref={timelineRef}
        className="absolute inset-0"
        onDoubleClick={handleTimelineDoubleClick}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const timestampMs = timestampAtClientX(event.clientX)
          if (timestampMs !== null) onSeek(timestampMs)
        }}
        role="group"
        aria-label="スライド区間のタイムライン。クリックで動画を移動、ダブルクリックで境界を追加"
      >
        <div className="pointer-events-none absolute inset-x-0 top-7 h-2 overflow-hidden rounded-full bg-[#e2eee8]">
          {slides.map((slide, index) => (
            <div
              className={`absolute inset-y-0 transition-[filter,box-shadow] ${visualKindAppearance[effectiveVisualKind(slide)].timeline} ${index === activeSlideIndex ? 'brightness-90 shadow-[inset_0_0_0_1px_rgba(23,77,60,0.6)]' : ''}`}
              key={slide.id}
              style={{
                left: `${timelinePosition(slide.startMs, durationMs)}%`,
                width: `${Math.max(0.4, timelinePosition(slideDuration(slide), durationMs))}%`,
              }}
              title={`${formatTimestamp(slide.startMs)} — ${formatTimestamp(slide.endMs)}`}
            />
          ))}
        </div>

        <button
          className={`absolute top-2 z-20 h-10 w-5 -translate-x-1/2 cursor-ew-resize bg-transparent ${isDraggingPlayhead ? 'opacity-70' : ''}`}
          style={{ left: `${timelinePosition(currentTimeMs, durationMs)}%` }}
          type="button"
          title={`${formatTimestamp(currentTimeMs)}へ移動`}
          aria-label={`${formatTimestamp(currentTimeMs)}の再生位置を移動`}
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)
            setIsDraggingPlayhead(true)
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            const timestampMs = timestampAtClientX(event.clientX)
            if (timestampMs !== null) onSeek(timestampMs)
          }}
          onPointerUp={() => setIsDraggingPlayhead(false)}
          onPointerCancel={() => setIsDraggingPlayhead(false)}
        >
          <span className="absolute left-1/2 top-0 h-8 w-0.5 -translate-x-1/2 bg-[#b6533a]" />
          <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-full bg-[#b6533a]" />
        </button>

        {boundaries.map((boundary) => (
          <button
            className={`absolute top-1 z-10 h-12 w-4 -translate-x-1/2 cursor-ew-resize bg-transparent ${draggingBoundaryId === boundary.id ? 'opacity-70' : ''}`}
            key={boundary.id}
            style={{ left: `${timelinePosition(boundary.timestampMs, durationMs)}%` }}
            type="button"
            disabled={disabled}
            title={`${formatTimestamp(boundary.timestampMs)} · distance ${boundary.distance}`}
            aria-label={`${formatTimestamp(boundary.timestampMs)}の境界を移動`}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              event.currentTarget.setPointerCapture(event.pointerId)
              setDraggingBoundaryId(boundary.id)
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                moveBoundary(boundary.id, event.clientX)
            }}
            onPointerUp={() => setDraggingBoundaryId(null)}
            onPointerCancel={() => setDraggingBoundaryId(null)}
            onDoubleClick={(event) => {
              event.stopPropagation()
              onSeek(boundary.timestampMs)
            }}
          >
            <span className="absolute left-1/2 top-0 h-10 w-px -translate-x-1/2 bg-[#174d3c]" />
            <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-full bg-[#174d3c]" />
          </button>
        ))}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between font-mono text-[9px] text-[#9aa6a1]">
          <span>00:00</span>
          <span>{formatTimestamp(durationMs)}</span>
        </div>
      </div>
    </div>
  )
}
