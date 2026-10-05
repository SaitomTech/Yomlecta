import { ArrowLeft } from 'lucide-react'

type ArticleNavigationBarProps = {
  onBack: () => void
  disabled?: boolean
  label?: string
}

export function ArticleNavigationBar({
  onBack,
  disabled = false,
  label = 'プロジェクトへ戻る',
}: ArticleNavigationBarProps) {
  return (
    <div className="flex w-full items-center">
      <button
        className="inline-flex shrink-0 items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-xs font-semibold text-[#71807b] transition hover:bg-[#e2eee8] hover:text-[#1d6b50] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        onClick={onBack}
        disabled={disabled}
      >
        <ArrowLeft size={14} strokeWidth={1.8} aria-hidden="true" />
        {label}
      </button>
    </div>
  )
}
