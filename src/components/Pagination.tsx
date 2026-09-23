import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { PageInfo } from '../types/project'

export function Pagination({
  page,
  pageInfo,
  disabled = false,
  onPrevious,
  onNext,
}: {
  page: number
  pageInfo: PageInfo
  disabled?: boolean
  onPrevious: () => void
  onNext: () => void
}) {
  if (pageInfo.total === 0 || (page === 1 && !pageInfo.hasNextPage)) return null

  const start = (page - 1) * pageInfo.pageSize + 1
  const end = Math.min(page * pageInfo.pageSize, pageInfo.total)
  const hasPreviousPage = page > 1

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e1e9e4] px-4 py-3 text-xs text-[#71807b] sm:px-5">
      <p aria-live="polite">
        {start}–{end}件 / {pageInfo.total}件
      </p>
      <div className="flex items-center gap-1.5">
        <button
          className="inline-flex items-center gap-1 rounded-[8px] border border-[#b7cbc0] bg-white px-2.5 py-2 font-semibold text-[#53615b] transition hover:bg-[#f4faf6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/25 disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          aria-label="前のページ"
          disabled={disabled || !hasPreviousPage}
          onClick={onPrevious}
        >
          <ChevronLeft size={14} /> 前へ
        </button>
        <span className="min-w-[76px] text-center font-semibold text-[#53615b]">
          {page}ページ目
        </span>
        <button
          className="inline-flex items-center gap-1 rounded-[8px] border border-[#b7cbc0] bg-white px-2.5 py-2 font-semibold text-[#53615b] transition hover:bg-[#f4faf6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/25 disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          aria-label="次のページ"
          disabled={disabled || !pageInfo.hasNextPage}
          onClick={onNext}
        >
          次へ <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
