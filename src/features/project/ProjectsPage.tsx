import { FileVideo, Plus, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { EmptyListState } from '../../components/EmptyListState'
import { ListPageBody } from '../../components/ListPageBody'
import { Pagination } from '../../components/Pagination'
import { getErrorDetail } from '../../lib/errors'
import { listProjects } from '../../lib/storage/projectStorage'
import { useCursorPagination } from '../../hooks/useCursorPagination'
import { CreateProjectDialog } from './components/CreateProjectDialog'
import { InvalidProjectListRow, ProjectListRow } from './components/ProjectListRow'

const PAGE_SIZE = 20

export function ProjectsPage({
  onCreateProject,
  onOpenProject,
}: {
  onCreateProject: (title: string) => Promise<void>
  onOpenProject: (projectId: string) => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => window.clearTimeout(timeout)
  }, [search])

  const loadPage = useCallback(
    (options: { pageSize: number; pageToken?: string }) =>
      listProjects({ ...options, query: debouncedSearch || undefined }),
    [debouncedSearch],
  )
  const listing = useCursorPagination({
    pageSize: PAGE_SIZE,
    filterKey: debouncedSearch,
    loadPage,
    errorMessage: 'プロジェクト一覧を読み込めませんでした。',
  })
  const entries = listing.items

  const openProject = useCallback(
    (projectId: string) => {
      if (busy) return
      setActionError(null)
      setBusy(`open:${projectId}`)
      void onOpenProject(projectId)
        .catch((openError) =>
          setActionError(getErrorDetail(openError, 'プロジェクトを開けませんでした。')),
        )
        .finally(() => setBusy(null))
    },
    [busy, onOpenProject],
  )

  const create = async () => {
    if (!title.trim()) return
    setActionError(null)
    setBusy('create')
    try {
      await onCreateProject(title.trim())
      setCreateOpen(false)
      setTitle('')
      listing.resetAndReload()
    } catch (createError) {
      setActionError(getErrorDetail(createError, 'プロジェクトを作成できませんでした。'))
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
          <p className="text-xs text-[#71807b]">{listing.pageInfo.total}件</p>
        </div>
        {actionError && (
          <p
            className="mt-5 rounded-[9px] border border-[#d6a18f] bg-[#fff8f5] px-4 py-3 text-xs text-[#a4573e]"
            role="alert"
          >
            {actionError}
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
              onChange={(event) => {
                setSearch(event.target.value)
              }}
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
          <ListPageBody
            isEmpty={entries.length === 0}
            loading={listing.loading}
            error={Boolean(listing.error)}
            loadingContent={
              <div className="flex items-center justify-center py-24 text-xs text-[#71807b]">
                <RefreshCw className="mr-2 animate-spin" size={15} />
                読み込み中…
              </div>
            }
            errorContent={
              <EmptyListState
                icon={FileVideo}
                title="一覧を読み込めませんでした"
                description="もう一度読み込んでください。"
                role="alert"
                action={
                  <button
                    className="mt-5 text-xs font-semibold text-[#1d6b50] underline"
                    type="button"
                    onClick={listing.reload}
                  >
                    再読み込み
                  </button>
                }
                className="py-20"
              />
            }
            emptyContent={
              <EmptyListState
                icon={FileVideo}
                title={debouncedSearch ? '検索結果がありません' : 'まだプロジェクトがありません'}
                description={
                  debouncedSearch
                    ? '別のキーワードで検索してください。'
                    : 'トップから動画を読み込むか、新規プロジェクトを作成してください。'
                }
                className="py-20"
              />
            }
          >
            <div
              className={listing.loading ? 'opacity-60 transition-opacity' : undefined}
              aria-busy={listing.loading}
            >
              {entries.map((entry) =>
                entry.kind === 'invalid' ? (
                  <InvalidProjectListRow key={entry.id} error={entry.error} />
                ) : (
                  <ProjectListRow
                    key={entry.summary.id}
                    summary={entry.summary}
                    isOpening={busy === `open:${entry.summary.id}`}
                    isDisabled={busy?.startsWith('open:') === true}
                    onOpen={() => openProject(entry.summary.id)}
                  />
                ),
              )}
              <Pagination
                page={listing.page}
                pageInfo={listing.pageInfo}
                disabled={
                  listing.loading || !listing.isPageCurrent || search.trim() !== debouncedSearch
                }
                onPrevious={listing.goPrevious}
                onNext={listing.goNext}
              />
            </div>
          </ListPageBody>
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
