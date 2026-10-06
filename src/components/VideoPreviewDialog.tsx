import { Play, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { formatTimestamp } from '../lib/time'
import { useVideoSourceUrl } from '../lib/media/useVideoSourceUrl'
import { useDialogA11y } from '../lib/ui/useDialogA11y'

export function VideoPreviewDialog({
  path,
  title,
  range,
  onClose,
}: {
  path: string
  title: string
  range?: { startTime: number; endTime: number }
  onClose: () => void
}) {
  const videoSource = useVideoSourceUrl(path)
  const dialogRef = useDialogA11y<HTMLDivElement>({ open: true, onClose })
  const videoRef = useRef<HTMLVideoElement>(null)
  const stopAtEnd = useRef(Boolean(range))
  const [segmentEnded, setSegmentEnded] = useState(false)
  const [hasContinuation, setHasContinuation] = useState(false)
  const [playbackError, setPlaybackError] = useState(false)
  const stopAtSegmentEnd = (video: HTMLVideoElement) => {
    if (!range || !stopAtEnd.current || video.currentTime < range.endTime) return
    video.pause()
    if (video.currentTime > range.endTime) video.currentTime = range.endTime
    setSegmentEnded(true)
  }

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#07110d]/82 p-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="元動画プレビュー"
      tabIndex={-1}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="relative w-[min(960px,calc(100vw-40px))] overflow-hidden border border-[#d8e1dc]/40 bg-[#0b1712] shadow-[0_24px_80px_rgba(0,0,0,0.38)]">
        <div className="flex items-center justify-between gap-4 border-b border-[#d8e1dc]/25 px-4 py-3 text-xs font-semibold text-[#f3faf6]">
          <span className="truncate">{title}</span>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center bg-[#18211f]/78 text-[#f3faf6] transition hover:bg-[#18211f]/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            onClick={() => onClose()}
            aria-label="動画プレビューを閉じる"
            title="閉じる"
          >
            <X size={17} strokeWidth={1.8} />
          </button>
        </div>
        {videoSource.src ? (
          <video
            ref={videoRef}
            key={videoSource.src}
            className="block max-h-[78vh] w-full bg-black object-contain"
            src={videoSource.src}
            controls
            autoPlay={!range}
            playsInline
            preload="metadata"
            onLoadedMetadata={(event) => {
              if (!range) return
              setHasContinuation(range.endTime < event.currentTarget.duration)
              event.currentTarget.currentTime = range.startTime
              void event.currentTarget.play().catch(() => {})
            }}
            onTimeUpdate={(event) => stopAtSegmentEnd(event.currentTarget)}
            onPlay={(event) => stopAtSegmentEnd(event.currentTarget)}
            onEnded={() => {
              if (range && stopAtEnd.current) setSegmentEnded(true)
            }}
            onError={() => setPlaybackError(true)}
            aria-label="元動画プレビュー"
          />
        ) : (
          <div className="grid aspect-video place-items-center bg-black px-5 text-xs text-[#d8e1dc]">
            {videoSource.error ? '動画を読み込めませんでした。' : '動画を読み込んでいます…'}
          </div>
        )}
        {playbackError && (
          <p role="alert" className="px-4 py-3 text-xs text-[#f3faf6]">
            動画を再生できませんでした。
          </p>
        )}
        {range && videoSource.src && !playbackError && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-[#f3faf6]">
            <span>
              {segmentEnded
                ? 'この部分の再生が終わりました'
                : `${formatTimestamp(range.startTime * 1000)} — ${formatTimestamp(range.endTime * 1000)}`}
            </span>
            {segmentEnded && hasContinuation && (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-[6px] px-3 py-2 font-semibold transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                onClick={() => {
                  stopAtEnd.current = false
                  setSegmentEnded(false)
                  void videoRef.current?.play().catch(() => {})
                }}
              >
                <Play size={14} aria-hidden="true" /> 続けて再生
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
