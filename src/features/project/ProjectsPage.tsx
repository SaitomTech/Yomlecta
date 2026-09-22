import { FileVideo, Plus, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { getErrorDetail } from '../../lib/errors'
import { listProjects } from '../../lib/storage/projectStorage'
import type { ProjectListEntry } from '../../types/project'
import { CreateProjectDialog } from './components/CreateProjectDialog'
import { ProjectListRow } from './components/ProjectListRow'

export function ProjectsPage({
  onCreateProject,
  onOpenProject,
}: {
  onCreateProject: (title: string) => Promise<void>
  onOpenProject: (projectId: string) => Promise<void>
}) {
  const [entries, setEntries] = useState<ProjectListEntry[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')

  const refresh = useCallback(async () => {
    try {
      setEntries(await listProjects())
      setError(null)
    } catch (loadError) {
      setError(getErrorDetail(loadError, 'プロジェクト一覧を読み込めませんでした。'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Loading the external project index is the purpose of this effect.
    // eslint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh])

  const projects = entries.filter(
    (entry): entry is Extract<ProjectListEntry, { kind: 'project' }> => entry.kind === 'project',
  )
  const normalized = search.trim().toLocaleLowerCase()
  const filtered = projects.filter(
    ({ summary }) => !normalized || summary.title.toLocaleLowerCase().includes(normalized),
  )

  const create = async () => {
    if (!title.trim()) return
    setBusy('create')
    try {
      await onCreateProject(title.trim())
      setCreateOpen(false)
      setTitle('')
    } catch (createError) {
      setError(getErrorDetail(createError, 'プロジェクトを作成できませんでした。'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="flex min-h-[calc(100svh-76px)] flex-col bg-[#f4f7f4] font-[Avenir_Next,Hiragino_Sans,Yu_Gothic,system-ui,sans-serif] text-[#18211f]">
      <section className="mx-auto flex w-[calc(100%-48px)] max-w-[1040px] flex-1 flex-col pb-14 pt-12 md:w-[calc(100%-11.6vw)] md:pt-16">
        <div className="flex flex-wrap items-end justify-between gap-4 pb-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#71807b]">
              Projects
            </p>
            <h1 className="mt-2 text-[30px] font-bold tracking-[-0.07em] sm:text-[36px]">
              プロジェクト
            </h1>
            <p className="mt-2 text-xs text-[#71807b]">
              動画から記事を作成し、関連する記事や進捗をプロジェクトごとにまとめて管理します。
            </p>
          </div>
        </div>
        {error && (
          <p
            className="mt-5 rounded-[9px] border border-[#d6a18f] bg-[#fff8f5] px-4 py-3 text-xs text-[#a4573e]"
            role="alert"
          >
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <label className="relative block min-w-[220px] w-full max-w-[460px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9aa6a1]"
              size={15}
            />
            <input
              className="h-10 w-full rounded-[9px] border border-[#b7cbc0] bg-white pl-9 pr-3 text-xs outline-none placeholder:text-[#9aa6a1] focus:border-[#1d6b50]"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="プロジェクトを検索"
            />
          </label>
          <button
            className="inline-flex items-center gap-2 rounded-[9px] bg-[#1d6b50] px-4 py-3 text-xs font-semibold text-[#f3faf6] shadow-[0_7px_16px_rgba(29,107,80,0.17)] transition hover:bg-[#174d3c]"
            type="button"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={15} /> 新規プロジェクト
          </button>
        </div>
        <div className="mt-3 overflow-hidden rounded-[16px] border border-[#b7cbc0] bg-white shadow-[0_18px_52px_rgba(22,54,42,0.05)]">
          {loading ? (
            <div className="flex items-center justify-center py-24 text-xs text-[#71807b]">
              <RefreshCw className="mr-2 animate-spin" size={15} />
              読み込み中…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-5 py-20 text-center">
              <FileVideo className="text-[#9aada3]" size={33} strokeWidth={1.3} />
              <h2 className="mt-4 text-[17px] font-semibold">
                {normalized ? '検索結果がありません' : 'まだプロジェクトがありません'}
              </h2>
              <p className="mt-2 text-xs leading-6 text-[#71807b]">
                {normalized
                  ? '別のキーワードで検索してください。'
                  : 'トップから動画を読み込むか、新規プロジェクトを作成してください。'}
              </p>
              {!normalized && (
                <button
                  className="mt-6 inline-flex items-center gap-2 rounded-[9px] border border-[#b7cbc0] bg-white px-4 py-3 text-xs font-semibold text-[#1d6b50] transition hover:bg-[#e2eee8]"
                  type="button"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus size={14} /> プロジェクトを作成
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-hidden">
              {filtered.map(({ summary }) => (
                <ProjectListRow
                  key={summary.id}
                  summary={summary}
                  isOpening={busy === `open:${summary.id}`}
                  isDisabled={busy?.startsWith('open:') === true}
                  onOpen={() => {
                    if (busy) return
                    setBusy(`open:${summary.id}`)
                    void onOpenProject(summary.id)
                      .catch((openError) =>
                        setError(getErrorDetail(openError, 'プロジェクトを開けませんでした。')),
                      )
                      .finally(() => setBusy(null))
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </section>
      <CreateProjectDialog
        open={createOpen}
        title={title}
        busy={busy === 'create'}
        onTitleChange={setTitle}
        onClose={() => setCreateOpen(false)}
        onSubmit={() => void create()}
      />
    </main>
  )
}
