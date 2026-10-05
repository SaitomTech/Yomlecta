import { ArrowRight } from 'lucide-react'
import type { ArticleListItem } from '../../../types/project'
import { formatArticleDate, getArticleActionLabel, getArticleStatusLabel } from '../articleList'

import { ArticleThumbnail } from './ArticleThumbnail'

const statusClass = {
  done: 'bg-[#e8f2ec] text-[#1d6b50]',
  working: 'bg-[#e8f0f5] text-[#315f75]',
  'not-started': 'bg-[#edf2f0] text-[#53615b]',
} as const

export function ArticleListRow({
  item,
  onOpen,
  onOpenWorkflow,
  onOpenProject,
}: {
  item: ArticleListItem
  onOpen: (item: ArticleListItem) => void
  onOpenWorkflow: (item: ArticleListItem) => void
  onOpenProject: (item: ArticleListItem) => void
}) {
  const status = item.status
  return (
    <div className="relative grid gap-3 border-t border-[#e1e9e4] px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <ArticleThumbnail thumbnailPath={item.thumbnailPath} thumbnailUrl={item.thumbnailUrl} />
        <div className="min-w-0">
          <span
            className={`mb-1.5 flex w-fit items-center rounded-full border px-2 py-1 text-[10px] font-semibold ${status === 'done' ? 'border-[#b7cbc0] bg-[#e8f2ec] text-[#1d6b50]' : 'border-[#cbd9e6] bg-[#edf2f8] text-[#496580]'}`}
          >
            {status === 'done' ? '記事' : '記事作成フロー'}
          </span>
          <button
            className="block max-w-full truncate text-left text-[14px] font-semibold tracking-[-0.02em] text-[#18211f] after:absolute after:inset-0 after:cursor-pointer after:transition hover:after:bg-[#1d6b50]/5 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-[#1d6b50]/30"
            type="button"
            onClick={() => (status === 'done' ? onOpen(item) : onOpenWorkflow(item))}
            title={item.title}
          >
            {item.title || '無題の記事'}
          </button>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#71807b]">
            <button
              className="relative z-10 truncate hover:text-[#1d6b50] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/25"
              type="button"
              onClick={() => onOpenProject(item)}
              title={`${item.projectTitle}を開く`}
            >
              {item.projectTitle}
            </button>
            <span aria-hidden="true">·</span>
            <time dateTime={item.createdAt}>{formatArticleDate(item.createdAt)}</time>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        {status !== 'done' && (
          <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${statusClass[status]}`}>
            {getArticleStatusLabel(status)}
          </span>
        )}
        <button
          className={`relative z-10 inline-flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 ${status === 'not-started' ? 'bg-[#1d6b50] text-white shadow-[0_5px_12px_rgba(29,107,80,0.12)] hover:bg-[#174d3c]' : 'border border-[#b7cbc0] bg-white text-[#1d6b50] hover:bg-[#f4faf6]'}`}
          type="button"
          onClick={() => (status === 'done' ? onOpen(item) : onOpenWorkflow(item))}
        >
          {getArticleActionLabel(status)}
          <ArrowRight size={13} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  )
}
