import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { getSegmentPlaybackRange } from '../lib/media/segmentPlayback'
import { formatTimestamp } from '../lib/time'
import type { SlideData } from '../types/project'

type SegmentVideoPlayerProps = {
  slide: SlideData
  videoSrc: string | null
  sourceOffsetMs?: number
  className?: string
}

export function SegmentVideoPlayer({
  slide,
  videoSrc,
  sourceOffsetMs = 0,
  className = 'w-full',
}: SegmentVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const { startTime, endTime } = getSegmentPlaybackRange(slide, sourceOffsetMs)
  const segmentDuration = Math.max(0.1, endTime - startTime)

  useEffect(
    () => () => {
      const video = videoRef.current
      if (!video) return
      video.pause()
      video.removeAttribute('src')
      video.load()
    },
    [],
  )

  const resetToSegmentStart = () => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = startTime
    setPosition(0)
  }

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return

    if (isPlaying) {
      video.pause()
      return
    }

    if (video.currentTime < startTime || video.currentTime >= endTime) resetToSegmentStart()
    void video.play().catch(() => setIsPlaying(false))
  }

  const seekTo = (nextPosition: number) => {
    const video = videoRef.current
    if (!video) return
    const clampedPosition = Math.min(segmentDuration, Math.max(0, nextPosition))
    video.currentTime = startTime + clampedPosition
    setPosition(clampedPosition)
  }

  if (!videoSrc) {
    return (
      <div
        className={`${className} grid aspect-video place-items-center rounded-[8px] border border-[#d8e1dc] bg-[#0b1712] text-[10px] text-[#b7cbc0]`}
      >
        動画を読み込んでいます…
      </div>
    )
  }

  return (
    <div className={className}>
      <video
        ref={videoRef}
        className="block aspect-video w-full rounded-[8px] border border-[#d8e1dc] bg-[#0b1712] object-contain"
        src={videoSrc}
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          event.currentTarget.currentTime = startTime
          setPosition(0)
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(event) => {
          const video = event.currentTarget
          if (video.currentTime < startTime) {
            resetToSegmentStart()
            return
          }
          if (video.currentTime >= endTime) {
            video.pause()
            resetToSegmentStart()
            return
          }
          setPosition(video.currentTime - startTime)
        }}
        onEnded={resetToSegmentStart}
        aria-label={`Slide ${String(slide.index + 1).padStart(2, '0')}の区間動画`}
      />
      <div className="mt-2 flex items-center gap-2 rounded-[8px] border border-[#d8e1dc] bg-[#f4f7f4] px-2.5 py-2">
        <button
          className="grid size-7 shrink-0 place-items-center rounded-full bg-[#1d6b50] text-[#f3faf6] transition hover:bg-[#174d3c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onClick={togglePlayback}
          aria-label={isPlaying ? '一時停止' : '再生'}
        >
          {isPlaying ? (
            <Pause size={13} fill="currentColor" />
          ) : (
            <Play size={13} fill="currentColor" />
          )}
        </button>
        <span className="shrink-0 whitespace-nowrap font-mono text-[10px] tabular-nums text-[#53615b]">
          {formatTimestamp(slide.startMs + position * 1000)} / {formatTimestamp(slide.endMs)}
        </span>
        <div className="min-w-0 flex-1">
          <input
            className="block h-1.5 w-full cursor-pointer accent-[#1d6b50]"
            type="range"
            min="0"
            max={segmentDuration}
            step="0.01"
            value={Math.min(segmentDuration, position)}
            onChange={(event) => seekTo(Number(event.target.value))}
            aria-label={`Slide ${String(slide.index + 1).padStart(2, '0')}の再生位置`}
          />
        </div>
      </div>
    </div>
  )
}
