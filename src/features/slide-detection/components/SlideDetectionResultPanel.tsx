import { Link2, Link2Off } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import type { SlideBoundary, SlideData, VisualSegmentKind } from '../../../types/project'
import { SlideDetectionTimeline } from './SlideDetectionTimeline'
import { SlideDetectionVideo } from './SlideDetectionVideo'
import { SlideSegmentList } from './SlideSegmentList'

type SlideDetectionResultPanelProps = {
  path: string
  boundaries: SlideBoundary[]
  slides: SlideData[]
  onChange: (boundaries: SlideBoundary[]) => void
  onKindChange: (segmentId: string, kind: VisualSegmentKind) => void
  durationMs?: number
  timeOffsetMs?: number
  disabled?: boolean
  preparingRanges?: Record<string, boolean>
}

export function SlideDetectionResultPanel({
  path,
  boundaries,
  slides,
  onChange,
  onKindChange,
  durationMs: rangeDurationMs,
  timeOffsetMs = 0,
  disabled = false,
  preparingRanges,
}: SlideDetectionResultPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [durationMs, setDurationMs] = useState(() => rangeDurationMs ?? slides.at(-1)?.endMs ?? 0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [followPlayback, setFollowPlayback] = useState(true)
  const activeSlideIndex = useMemo(
    () =>
      slides.findIndex(
        (slide, index) =>
          currentTimeMs >= slide.startMs &&
          (currentTimeMs < slide.endMs || index === slides.length - 1),
      ),
    [currentTimeMs, slides],
  )
  const activeSlide = activeSlideIndex >= 0 ? slides[activeSlideIndex] : undefined

  const handleLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const loadedDurationMs = event.currentTarget.duration * 1000
    if (timeOffsetMs > 0) event.currentTarget.currentTime = timeOffsetMs / 1000
    if (rangeDurationMs === undefined && Number.isFinite(loadedDurationMs) && loadedDurationMs > 0)
      setDurationMs(loadedDurationMs)
  }

  const handleTimeUpdate = (event: SyntheticEvent<HTMLVideoElement>) => {
    const localTimeMs = event.currentTarget.currentTime * 1000 - timeOffsetMs
    if (localTimeMs >= durationMs && (timeOffsetMs > 0 || rangeDurationMs !== undefined)) {
      event.currentTarget.pause()
      event.currentTarget.currentTime = (timeOffsetMs + durationMs) / 1000
    }
    setCurrentTimeMs(Math.min(durationMs, Math.max(0, localTimeMs)))
  }

  const handleTogglePlayback = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      if (rangeDurationMs !== undefined) {
        const currentLocal = video.currentTime * 1000 - timeOffsetMs
        if (currentLocal < 0 || currentLocal >= durationMs) video.currentTime = timeOffsetMs / 1000
      }
      void video.play().catch((error) => console.error(error))
    } else video.pause()
  }, [durationMs, rangeDurationMs, timeOffsetMs])

  const handleSeek = useCallback(
    (timestampMs: number) => {
      const video = videoRef.current
      if (!video) return
      video.currentTime = (timeOffsetMs + timestampMs) / 1000
      setCurrentTimeMs(timestampMs)
    },
    [timeOffsetMs],
  )

  const handleSelectSlide = useCallback(
    (index: number) => {
      const slide = slides[index]
      if (slide) handleSeek(slide.startMs)
    },
    [handleSeek, slides],
  )

  const handleRemoveBoundary = useCallback(
    (boundaryId: string) => {
      onChange(boundaries.filter((boundary) => boundary.id !== boundaryId))
    },
    [boundaries, onChange],
  )

  return (
    <section className="mt-10 pt-8" aria-labelledby="slide-segments-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="slide-segments-heading" className="text-[21px] font-bold tracking-[-0.05em]">
          スライド区間の確認・調整
        </h2>
        <button
          className={`inline-flex items-center gap-1.5 rounded-[9px] border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 ${followPlayback ? 'border-[#b7cbc0] bg-[#e2eee8] text-[#1d6b50] hover:border-[#1d6b50]' : 'border-[#d8e1dc] bg-[#fbfcfa] text-[#71807b] hover:border-[#b7cbc0] hover:text-[#1d6b50]'}`}
          type="button"
          aria-pressed={followPlayback}
          aria-label={
            followPlayback ? '動画再生位置への追従をオフにする' : '動画再生位置への追従をオンにする'
          }
          onClick={() => setFollowPlayback((current) => !current)}
        >
          {followPlayback ? <Link2 size={14} /> : <Link2Off size={14} />}
          {followPlayback ? '追従中' : '追従オフ'}
        </button>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.85fr)] lg:items-start">
        <SlideDetectionVideo
          path={path}
          videoRef={videoRef}
          activeSlide={activeSlide}
          isPlaying={isPlaying}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onTimeUpdate={handleTimeUpdate}
          onToggle={handleTogglePlayback}
        >
          <SlideDetectionTimeline
            boundaries={boundaries}
            durationMs={durationMs}
            slides={slides}
            currentTimeMs={currentTimeMs}
            activeSlideIndex={activeSlideIndex}
            onChange={onChange}
            onSeek={handleSeek}
            disabled={disabled}
          />
        </SlideDetectionVideo>

        <SlideSegmentList
          boundaries={boundaries}
          slides={slides}
          followPlayback={followPlayback}
          activeSlideIndex={activeSlideIndex}
          onSelectSlide={handleSelectSlide}
          onRemoveBoundary={handleRemoveBoundary}
          onKindChange={onKindChange}
          disabled={disabled}
          preparingRanges={preparingRanges}
        />
      </div>
    </section>
  )
}
