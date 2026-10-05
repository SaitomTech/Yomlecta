import { AlertTriangle, ArrowRight, FileVideo, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { ProjectSummary } from '../../../types/project'

function ProjectThumbnail({ summary }: { summary: ProjectSummary }) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const source = summary.thumbnailPath ? convertFileSrc(summary.thumbnailPath) : null

  return (
    <div className="grid aspect-video w-20 shrink-0 place-items-center overflow-hidden rounded-[7px] border border-[#d8e1dc] bg-[#e8f2ec] sm:w-24">
      {source && source !== failedSource ? (
        <img
          className="h-full w-full object-cover"
          src={source}
          alt=""
          onError={() => setFailedSource(source)}
        />
      ) : (
        <FileVideo className="text-[#8da79a]" size={20} strokeWidth={1.6} />
      )}
    </div>
  )
}

export function ProjectListRow({
  summary,
  onOpen,
  isOpening,
  isDisabled,
}: {
  summary: ProjectSummary
  onOpen: () => void
  isOpening: boolean
  isDisabled: boolean
}) {
  return (
    <article className="relative grid gap-3 border-t border-[#e1e9e4] px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <ProjectThumbnail summary={summary} />
        <div className="min-w-0">
          <span className="mb-1.5 block w-fit rounded-full border border-[#d8cfee] bg-[#f1eefb] px-2 py-1 text-[10px] font-semibold text-[#65508d]">
            プロジェクト
          </span>
          <h2
            className="truncate text-[14px] font-semibold tracking-[-0.02em] text-[#18211f]"
            title={summary.title}
          >
            {summary.title}
          </h2>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#71807b]">
            <span>
              {summary.videoCount}動画 · {summary.articleCount}記事
            </span>
            <span aria-hidden="true">·</span>
            <time dateTime={summary.updatedAt}>
              最終更新 {new Date(summary.updatedAt).toLocaleDateString('ja-JP')}
            </time>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-3">
        <button
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[8px] bg-[#1d6b50] px-3 py-2 text-xs font-semibold text-[#f3faf6] transition after:absolute after:inset-0 after:cursor-pointer after:transition enabled:hover:after:bg-[#1d6b50]/5 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-[#1d6b50]/30 disabled:after:cursor-default"
          type="button"
          aria-label={`${summary.title}を開く`}
          disabled={isDisabled}
          onClick={onOpen}
        >
          {isOpening ? <RefreshCw className="animate-spin" size={14} /> : '開く'}
          {!isOpening && <ArrowRight size={13} strokeWidth={1.8} />}
        </button>
      </div>
    </article>
  )
}

export function InvalidProjectListRow({ error }: { error: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-[#d8e1dc] px-5 py-5 text-xs text-[#a4573e]">
      <AlertTriangle className="shrink-0" size={18} />
      <div className="min-w-0">
        <p className="font-semibold">プロジェクトを読み込めません</p>
        <p className="mt-1 truncate text-[#71807b]" title={error}>
          {error}
        </p>
      </div>
    </div>
  )
}
