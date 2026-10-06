import { X } from 'lucide-react'
import { useVideoSourceUrl } from '../lib/media/useVideoSourceUrl'
import { useDialogA11y } from '../lib/ui/useDialogA11y'

export function VideoPreviewDialog({
  path,
  title,
  onClose,
}: {
  path: string
  title: string
  onClose: () => void
}) {
  const videoSource = useVideoSourceUrl(path)
  const dialogRef = useDialogA11y<HTMLDivElement>({ open: true, onClose })

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
            key={videoSource.src}
            className="block max-h-[78vh] w-full bg-black object-contain"
            src={videoSource.src}
            controls
            autoPlay
            playsInline
            preload="metadata"
            aria-label="元動画プレビュー"
          />
        ) : (
          <div className="grid aspect-video place-items-center bg-black px-5 text-xs text-[#d8e1dc]">
            {videoSource.error ? '動画を読み込めませんでした。' : '動画を読み込んでいます…'}
          </div>
        )}
      </div>
    </div>
  )
}
