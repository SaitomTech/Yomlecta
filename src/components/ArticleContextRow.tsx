import { ArrowLeftRight, PencilLine } from 'lucide-react'
import { useState } from 'react'
import { ArticleSwitcherPanel } from '../features/article/components/ArticleSwitcherPanel'
import { useProjectTitleEditor } from '../features/project/hooks/useProjectTitleEditor'
import type { ArticleContext } from '../types/project'

type ArticleContextRowProps = {
  project: ArticleContext
  onSelect?: (articleId: string) => void | boolean | Promise<void | boolean>
  onSaveTitle: (title: string) => void | Promise<void>
  disabled?: boolean
}

export function ArticleContextRow({
  project,
  onSelect,
  onSaveTitle,
  disabled = false,
}: ArticleContextRowProps) {
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false)
  const article = project.article
  const title = article?.title.trim() || '無題の記事'
  const titleEditor = useProjectTitleEditor({
    initialTitle: title,
    onSave: async (nextTitle) => {
      await onSaveTitle(nextTitle)
    },
  })
  const canSwitchArticles = project.project.articles.length > 1

  const handleSelect = async (articleId: string) => {
    if (!onSelect) return
    const result = await onSelect(articleId)
    if (result !== false) setIsSwitcherOpen(false)
  }

  return (
    <>
      <div
        className="mx-auto mb-4 flex min-h-[52px] w-[calc(100%-48px)] max-w-[1040px] flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-[16px] border border-dashed border-[#c8cfcc] bg-[#eceeed] px-2 py-1.5 shadow-[0_10px_28px_rgba(22,54,42,0.045)] md:w-[calc(100%-11.6vw)] md:px-3"
        aria-label="現在の記事作成フロー"
      >
        <div className="min-w-0 flex-1 grid grid-cols-1 gap-y-1.5">
          <div>
            <span className="flex w-fit shrink-0 items-center rounded-full border border-[#cbd9e6] bg-[#edf2f8] px-1.5 py-0.5 text-[9px] font-semibold text-[#496580]">
              記事作成フロー
            </span>
          </div>
          <div className="min-w-0 flex-1 grid grid-cols-1 items-center">
            {titleEditor.isEditing ? (
              <input
                className="h-8 min-w-0 w-full max-w-[520px] flex-1 rounded-[8px] border border-[#1d6b50] bg-white px-2.5 text-[16px] font-bold tracking-[-0.05em] outline-none ring-2 ring-[#1d6b50]/10"
                value={titleEditor.draft}
                onChange={(event) => titleEditor.setDraft(event.target.value)}
                onKeyDown={titleEditor.handleKeyDown}
                onCompositionStart={titleEditor.handleCompositionStart}
                onCompositionEnd={titleEditor.handleCompositionEnd}
                onBlur={titleEditor.handleBlur}
                autoFocus
                disabled={titleEditor.isSaving}
                aria-label="記事タイトル"
              />
            ) : (
              <button
                className="group min-w-0 max-w-full rounded-[8px] px-0 py-0 text-left text-[16px] font-bold tracking-[-0.05em] transition hover:bg-[#eef3ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/20 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                onClick={titleEditor.startEditing}
                disabled={disabled || titleEditor.isSaving}
                aria-label="記事タイトルを編集"
              >
                <span className="text-current">
                  <span className="inline-block max-w-full truncate align-middle">{title}</span>
                  <PencilLine
                    aria-hidden="true"
                    className="pointer-events-none inline-block size-0 translate-x-[-0.25rem] overflow-hidden align-middle text-[#71807b] opacity-0 transition-[width,height,opacity,transform,margin] duration-200 group-hover:ml-1.5 group-hover:size-3.5 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:ml-1.5 group-focus-visible:size-3.5 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
                    strokeWidth={2}
                  />
                </span>
              </button>
            )}
            {titleEditor.isEditing && titleEditor.error && (
              <p className="mt-2 text-xs text-[#b6533a]" role="alert">
                {titleEditor.error}
              </p>
            )}
            <p
              className="mt-0 truncate text-xs text-[#71807b]"
              title={`プロジェクト: ${project.project.title}`}
            >
              プロジェクト: {project.project.title}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 self-center">
          {onSelect && (
            <button
              className="-mr-1 inline-flex shrink-0 items-center gap-2 rounded-[8px] border border-[#b7cbc0] bg-white px-3 py-2 text-xs font-semibold text-[#1d6b50] transition hover:border-[#1d6b50] hover:bg-[#e2eee8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={() => setIsSwitcherOpen(true)}
              disabled={disabled || titleEditor.isEditing || !canSwitchArticles}
            >
              <ArrowLeftRight size={14} aria-hidden="true" />
              記事作成フローを切り替える
            </button>
          )}
        </div>
      </div>
      {isSwitcherOpen && onSelect && (
        <ArticleSwitcherPanel
          project={project.project}
          selectedArticleId={project.article.id}
          disabled={disabled}
          onClose={() => setIsSwitcherOpen(false)}
          onSelect={handleSelect}
        />
      )}
    </>
  )
}
