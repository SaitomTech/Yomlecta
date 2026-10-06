import { PencilLine, Trash2 } from 'lucide-react'
import type { Project } from '../../../types/project'

export function ProjectHeader({
  project,
  isEditingTitle,
  titleDraft,
  isSavingTitle,
  titleError,
  onTitleDraftChange,
  onStartTitleEditing,
  onTitleKeyDown,
  onTitleBlur,
  onTitleCompositionStart,
  onTitleCompositionEnd,
  onRequestDelete,
}: {
  project: Project
  isEditingTitle: boolean
  titleDraft: string
  isSavingTitle: boolean
  titleError: string | null
  onTitleDraftChange: (value: string) => void
  onStartTitleEditing: () => void
  onTitleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onTitleBlur: (event: React.FocusEvent<HTMLInputElement>) => void
  onTitleCompositionStart: (event: React.CompositionEvent<HTMLInputElement>) => void
  onTitleCompositionEnd: (event: React.CompositionEvent<HTMLInputElement>) => void
  onRequestDelete: () => void
}) {
  return (
    <div className="border-b border-[#d8e1dc] px-4 pb-4 pt-4 sm:px-6 sm:pb-5 sm:pt-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <span className="mb-1.5 flex w-fit items-center rounded-full border border-[#d8cfee] bg-[#f1eefb] px-2 py-1 text-[10px] font-semibold text-[#65508d]">
            プロジェクト
          </span>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {isEditingTitle ? (
                <input
                  className="h-10 w-full max-w-[520px] rounded-[8px] border border-[#1d6b50] bg-white px-3 text-[20px] font-bold tracking-[-0.05em] outline-none ring-2 ring-[#1d6b50]/10"
                  value={titleDraft}
                  onChange={(event) => onTitleDraftChange(event.target.value)}
                  onKeyDown={onTitleKeyDown}
                  onCompositionStart={onTitleCompositionStart}
                  onCompositionEnd={onTitleCompositionEnd}
                  onBlur={onTitleBlur}
                  autoFocus
                  disabled={isSavingTitle}
                  aria-label="プロジェクト名"
                />
              ) : (
                <button
                  className="group min-w-0 rounded-[8px] px-1.5 py-0.5 text-left text-[25px] font-bold tracking-[-0.05em] transition hover:bg-[#eef3ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/20"
                  type="button"
                  onClick={onStartTitleEditing}
                  aria-label="プロジェクト名を編集"
                >
                  <span className="text-current">
                    {project.title}
                    <PencilLine
                      aria-hidden="true"
                      className="pointer-events-none inline-block size-0 translate-x-[-0.25rem] overflow-hidden align-middle text-[#71807b] opacity-0 transition-[width,height,opacity,transform,margin] duration-200 group-hover:ml-1.5 group-hover:size-3.5 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:ml-1.5 group-focus-visible:size-3.5 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
                      strokeWidth={2}
                    />
                  </span>
                </button>
              )}
            </div>
            <button
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-[#d6a18f] text-[#a4573e] transition hover:bg-[#fff0e9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b6533a]/30"
              type="button"
              title="プロジェクトを削除"
              aria-label="プロジェクトを削除"
              onClick={onRequestDelete}
            >
              <Trash2 size={14} />
            </button>
          </div>
          {titleError && <p className="mt-1 text-xs text-[#b6533a]">{titleError}</p>}
        </div>
      </div>
    </div>
  )
}
