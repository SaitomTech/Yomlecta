import { X } from 'lucide-react'
import { useState } from 'react'
import { useDialogA11y } from '../../../lib/ui/useDialogA11y'
import { formatTimestamp } from '../../../lib/time'
import type {
  ArticleMetadata,
  CropRegion,
  PerspectiveCrop,
  ProjectVideo,
  VideoTrimRange,
} from '../../../types/project'
import { CropSettingsPanel } from './CropSettingsPanel'
import { RangeEditor } from './RangeEditor'
import { RangeList } from './RangeList'
import { useArticleRangeEditor } from './useArticleRangeEditor'

type ArticleMetadataRange = { title: string; range: VideoTrimRange }

export function CreateArticleDialog({
  projectId,
  video,
  onClose,
  onSubmit,
}: {
  projectId: string
  video: ProjectVideo
  onClose: () => void
  onSubmit: (
    ranges: ArticleMetadataRange[],
    crop: CropRegion,
    perspectiveCrop?: PerspectiveCrop,
  ) => Promise<ArticleMetadata[] | void>
}) {
  const [isCropPreviewOpen, setIsCropPreviewOpen] = useState(true)
  const editor = useArticleRangeEditor({
    projectId,
    video,
    onClose,
    onSubmit: async (ranges, crop, perspectiveCrop) => {
      await onSubmit(ranges, crop, perspectiveCrop)
    },
  })
  const dialogRef = useDialogA11y({ open: true, onClose, closeDisabled: editor.busy })

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-0 grid h-full w-full max-w-none place-items-center border-0 bg-[#18211f]/35 px-5 py-6 backdrop-blur-[2px]"
      open
      aria-modal="true"
      aria-labelledby="create-article-dialog-title"
    >
      <section className="max-h-[96vh] w-full max-w-[1180px] overflow-auto rounded-[16px] border border-[#b7cbc0] bg-white p-6 shadow-[0_24px_70px_rgba(24,33,31,0.2)] sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#71807b]">
              Article setup
            </p>
            <h2
              id="create-article-dialog-title"
              className="mt-1 text-[22px] font-bold tracking-[-0.04em]"
            >
              文字起こし記事作成フローを追加
            </h2>
            <p className="mt-1 text-xs text-[#71807b]">
              元動画のスライド領域を指定し、必要に応じてトリミングや分割を行います。区間ごとに記事作成フローを立ち上げます。
            </p>
          </div>
          <button
            className="rounded-md p-1.5 text-[#71807b] hover:bg-[#e8f2ec] disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            onClick={onClose}
            disabled={editor.busy}
            aria-label="記事作成の開始を閉じる"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mx-auto mt-5 w-full max-w-[1120px] overflow-hidden rounded-[12px] border border-[#b7cbc0] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d8e1dc] px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-[#18211f]" title={video.media.path}>
                {video.media.name}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-[#71807b]">
                {video.media.metadata.width} × {video.media.metadata.height} ·{' '}
                {formatTimestamp(video.media.metadata.durationMs)}
              </p>
            </div>
          </div>

          <div
            className={`grid min-h-0 gap-4 lg:gap-0 ${isCropPreviewOpen ? 'lg:grid-cols-[minmax(0,1fr)_300px]' : 'lg:grid-cols-1'}`}
          >
            <RangeEditor
              video={video}
              editor={editor}
              onOpenCropPreview={!isCropPreviewOpen ? () => setIsCropPreviewOpen(true) : undefined}
            />
            {isCropPreviewOpen && (
              <CropSettingsPanel
                projectId={projectId}
                video={video}
                editor={editor}
                onClose={() => setIsCropPreviewOpen(false)}
              />
            )}
          </div>
        </div>

        <RangeList video={video} editor={editor} />
        {editor.error && (
          <p className="mt-3 rounded-[8px] border border-[#d6a18f] bg-[#fff8f5] px-3 py-2 text-xs text-[#a4573e]">
            {editor.error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2 border-t border-[#d8e1dc] pt-5">
          <button
            className="rounded-[8px] px-3 py-2.5 text-xs font-semibold text-[#71807b] hover:bg-[#eef3ef] disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            onClick={onClose}
            disabled={editor.busy}
          >
            キャンセル
          </button>
          <button
            className="rounded-[8px] bg-[#1d6b50] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
            type="button"
            disabled={editor.busy || editor.rows.length === 0}
            onClick={() => void editor.submit()}
          >
            {editor.busy ? '処理中…' : '各区間ごとに記事作成フローを追加'}
          </button>
        </div>
      </section>
    </dialog>
  )
}
