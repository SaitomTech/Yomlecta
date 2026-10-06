import { articleMetadata } from '../../../lib/project/articleSelectors'
import { ChevronRight, FolderOpen, Link, Upload, X } from 'lucide-react'
import { useDialogA11y } from '../../../lib/ui/useDialogA11y'
import { formatTimestamp } from '../../../lib/time'
import type { Project, ProjectVideo } from '../../../types/project'
import type { VideoImportSource } from '../VideoImportPanel'
import { VideoThumbnail } from './VideoThumbnail'
export function SelectArticleVideoDialog({
  project,
  onClose,
  onSelect,
  onOpenVideos,
}: {
  project: Project
  onClose: () => void
  onSelect: (video: ProjectVideo) => void
  onOpenVideos: (source: VideoImportSource) => void
}) {
  const dialogRef = useDialogA11y({ open: true, onClose })
  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-0 grid h-full w-full max-w-none place-items-center border-0 bg-[#18211f]/35 px-5 py-6 backdrop-blur-[2px]"
      open
      aria-modal="true"
      aria-labelledby="select-article-video-title"
    >
      <section className="max-h-[88vh] w-full max-w-[680px] overflow-auto rounded-[16px] border border-[#b7cbc0] bg-white p-6 shadow-[0_24px_70px_rgba(24,33,31,0.2)] sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#71807b]">
              Article setup
            </p>
            <h2
              id="select-article-video-title"
              className="mt-1 text-[22px] font-bold tracking-[-0.04em]"
            >
              動画を選択
            </h2>
            <p className="mt-1 text-xs text-[#71807b]">
              記事作成フローの元動画を選択します。範囲の指定は次のモーダルで行います。
            </p>
          </div>
          <button
            className="rounded-md p-1.5 text-[#71807b] hover:bg-[#e8f2ec]"
            type="button"
            onClick={onClose}
            aria-label="元動画の選択を閉じる"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-6">
          <p className="text-sm font-semibold">新しい動画を追加して記事作成フローを開始</p>
          <p className="mt-1 text-[11px] text-[#71807b]">
            動画を追加すると、追加後に範囲をまとめて指定できます。
          </p>
        </div>
        <div className="mt-3 rounded-[10px] border border-dashed border-[#b7cbc0] bg-white px-4 py-6 text-center">
          <Upload className="mx-auto text-[#8da79a]" size={25} strokeWidth={1.5} />
          <p className="mt-2 text-sm font-semibold">動画を選んで記事を作成</p>
          <p className="mt-1 text-[11px] text-[#71807b]">または、追加方法を選択</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              className="inline-flex items-center justify-center gap-1.5 rounded-[8px] border border-[#b7cbc0] bg-white px-2 py-2.5 text-[11px] font-semibold text-[#1d6b50] hover:bg-[#f4faf6]"
              type="button"
              onClick={() => onOpenVideos('finder')}
            >
              <FolderOpen size={14} /> Finderから選ぶ
            </button>
            <button
              className="inline-flex items-center justify-center gap-1.5 rounded-[8px] border border-[#b7cbc0] bg-white px-2 py-2.5 text-[11px] font-semibold text-[#1d6b50] hover:bg-[#f4faf6]"
              type="button"
              onClick={() => onOpenVideos('youtube')}
            >
              <Link size={14} /> YouTube URL
            </button>
          </div>
        </div>
        {project.videos.length > 0 && (
          <>
            <div className="mt-6 flex items-center gap-3 text-[11px] font-semibold text-[#71807b]">
              <span className="h-px flex-1 bg-[#d8e1dc]" />
              <span>または</span>
              <span className="h-px flex-1 bg-[#d8e1dc]" />
            </div>
            <div className="mt-6">
              <p className="text-sm font-semibold">プロジェクトに追加済みの動画を使う</p>
              <div className="mt-3 space-y-1">
                {project.videos.map((video) => {
                  const articleCount = project.articles
                    .map(articleMetadata)
                    .filter((article) => article.sourceVideoId === video.id).length
                  const isYoutube = video.media.origin?.kind === 'youtube'
                  return (
                    <button
                      className="flex w-full items-center gap-3 border-b border-[#d8e1dc] bg-transparent px-0 py-3 text-left transition hover:bg-[#f4f7f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/25"
                      key={video.id}
                      type="button"
                      onClick={() => onSelect(video)}
                    >
                      <VideoThumbnail video={video} />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-semibold">{video.title}</span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${isYoutube ? 'bg-[#fff0e9] text-[#a4573e]' : 'bg-[#e8f2ec] text-[#1d6b50]'}`}
                          >
                            {isYoutube ? 'YouTube' : 'ローカル'}
                          </span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-[#71807b]">
                          <span>{formatTimestamp(video.media.metadata.durationMs)}</span>
                          <span className="text-[#b7cbc0]">·</span>
                          <span>{articleCount}件の記事</span>
                        </span>
                      </span>
                      <ChevronRight className="shrink-0 text-[#8da79a]" size={16} />
                    </button>
                  )
                })}
              </div>
            </div>
          </>
        )}
        <div className="mt-6 flex justify-end border-t border-[#d8e1dc] pt-4">
          <button
            className="rounded-[8px] px-3 py-2.5 text-xs font-semibold text-[#71807b] hover:bg-[#eef3ef]"
            type="button"
            onClick={onClose}
          >
            閉じる
          </button>
        </div>
      </section>
    </dialog>
  )
}
