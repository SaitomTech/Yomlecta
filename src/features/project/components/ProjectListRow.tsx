import { AlertTriangle, ArrowRight, FileVideo, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { ProjectSummary } from '../../../types/project'

function ProjectThumbnail({ summary }: { summary: ProjectSummary }) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const source = summary.thumbnailPath ? convertFileSrc(summary.thumbnailPath) : null

  return (
    <div className="grid aspect-video w-full shrink-0 place-items-center overflow-hidden rounded-[9px] border border-[#d8e1dc] bg-[#e8f2ec] sm:w-[170px]">
      {source && source !== failedSource ? (
        <img
          className="h-full w-full object-cover"
          src={source}
          alt=""
          onError={() => setFailedSource(source)}
        />
      ) : (
        <FileVideo className="text-[#8da79a]" size={26} strokeWidth={1.4} />
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
    <article className="flex flex-col gap-4 border-b border-[#d8e1dc] px-5 py-5 transition hover:bg-[#f4f7f4]/70 sm:flex-row sm:items-center">
      <ProjectThumbnail summary={summary} />
      <div className="min-w-0 flex-1">
        <span className="flex w-fit items-center rounded-full border border-[#d8cfee] bg-[#f1eefb] px-2 py-1 text-[10px] font-semibold text-[#65508d]">
          プロジェクト
        </span>
        <h2 className="mt-1.5 truncate text-[16px] font-semibold tracking-[-0.03em] text-[#18211f]">
          {summary.title}
        </h2>
        <p className="mt-1 truncate text-xs text-[#53615b]">
          {summary.videoCount}動画 · {summary.articleCount}記事
        </p>
        <p className="mt-2 font-mono text-[10px] text-[#71807b]">
          最終更新 {new Date(summary.updatedAt).toLocaleDateString('ja-JP')}
        </p>
      </div>
      <button
        className="inline-flex shrink-0 items-center gap-2 self-end rounded-[8px] bg-[#1d6b50] px-3.5 py-2.5 text-xs font-semibold text-[#f3faf6] transition hover:bg-[#174d3c] sm:self-auto"
        type="button"
        disabled={isDisabled}
        onClick={onOpen}
      >
        {isOpening ? <RefreshCw className="animate-spin" size={14} /> : '開く'}
        {!isOpening && <ArrowRight size={14} />}
      </button>
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
