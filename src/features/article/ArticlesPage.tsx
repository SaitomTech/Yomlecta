import { FileText, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { EmptyListState } from '../../components/EmptyListState'
import { ListPageBody } from '../../components/ListPageBody'
import { Pagination } from '../../components/Pagination'
import { useCursorPagination } from '../../hooks/useCursorPagination'
import { listArticles } from '../../lib/storage/projectStorage'
import type { ArticleListItem, ArticleListStatus } from '../../types/project'
import { ArticleListRow } from './components/ArticleListRow'

type StatusFilter = 'all' | ArticleListStatus

const PAGE_SIZE = 20

export function ArticlesPage({
  onOpenArticle,
  onOpenWorkflow,
  onOpenProject,
}: {
  onOpenArticle: (item: ArticleListItem) => void
  onOpenWorkflow: (item: ArticleListItem) => void
  onOpenProject: (item: ArticleListItem) => void
}) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => window.clearTimeout(timeout)
  }, [search])

  const loadPage = useCallback(
    (options: { pageSize: number; pageToken?: string }) =>
      listArticles({
        ...options,
        query: debouncedSearch || undefined,
        status: filter === 'all' ? undefined : filter,
      }),
    [debouncedSearch, filter],
  )
  const listing = useCursorPagination({
    pageSize: PAGE_SIZE,
    filterKey: JSON.stringify([debouncedSearch, filter]),
    loadPage,
    errorMessage: '記事一覧を読み込めませんでした。',
  })
  const { items, page, pageInfo, loading, error } = listing

  const clearFilters = () => {
    setSearch('')
    setFilter('all')
  }

  return (
    <main className="flex min-h-[calc(100svh-76px)] flex-col bg-[#f4f7f4] font-[Avenir_Next,Hiragino_Sans,Yu_Gothic,system-ui,sans-serif] text-[#18211f]">
      <section className="mx-auto flex w-[calc(100%-48px)] max-w-[1040px] flex-1 flex-col pb-14 pt-12 md:w-[calc(100%-11.6vw)] md:pt-16">
        <div className="flex flex-wrap items-end justify-between gap-4 pb-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#71807b]">
              Articles
            </p>
            <h1 className="mt-2 text-[30px] font-bold tracking-[-0.07em] sm:text-[36px]">記事</h1>
            <p className="mt-2 text-xs text-[#71807b]">
              すべてのプロジェクトの記事と記事作成フローをまとめて表示します。
            </p>
          </div>
          <p className="text-xs text-[#71807b]">{pageInfo.total}件</p>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <label className="relative block min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9aa6a1]"
              size={15}
            />
            <input
              className="h-10 w-full rounded-[9px] border border-[#b7cbc0] bg-white pl-9 pr-3 text-xs outline-none placeholder:text-[#9aa6a1] focus:border-[#1d6b50]"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="記事名やプロジェクト名を検索"
            />
          </label>
          <div className="flex items-center gap-2 text-xs text-[#71807b]">
            <SlidersHorizontal size={14} />
            <label htmlFor="article-status-filter" className="sr-only">
              記事の状態
            </label>
            <select
              id="article-status-filter"
              className="h-10 rounded-[9px] border border-[#b7cbc0] bg-white px-3 text-xs font-semibold text-[#53615b] outline-none focus:border-[#1d6b50]"
              value={filter}
              onChange={(event) => setFilter(event.target.value as StatusFilter)}
            >
              <option value="all">すべて</option>
              <option value="not-started">未着手</option>
              <option value="working">作業中</option>
              <option value="done">作成完了</option>
            </select>
          </div>
        </div>
        <div className="mt-3 overflow-hidden rounded-[16px] border border-[#b7cbc0] bg-white shadow-[0_18px_52px_rgba(22,54,42,0.05)]">
          <ListPageBody
            isEmpty={items.length === 0}
            loading={loading}
            error={Boolean(error)}
            loadingContent={
              <div className="flex items-center justify-center py-24 text-xs text-[#71807b]">
                <RefreshCw className="mr-2 animate-spin" size={15} />
                読み込み中…
              </div>
            }
            errorContent={
              <EmptyListState
                icon={FileText}
                title="一覧を読み込めませんでした"
                description="記事一覧を再読み込みしてください。"
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
                icon={FileText}
                title={
                  pageInfo.total === 0 && !debouncedSearch && filter === 'all'
                    ? 'まだ記事がありません'
                    : '条件に一致する記事がありません'
                }
                description={
                  pageInfo.total === 0 && !debouncedSearch && filter === 'all'
                    ? 'ホームから動画を読み込むと、ここに記事が表示されます。'
                    : '検索語や状態フィルターを変更してください。'
                }
                action={
                  (debouncedSearch || filter !== 'all') && (
                    <button
                      className="mt-5 text-xs font-semibold text-[#1d6b50] underline"
                      type="button"
                      onClick={clearFilters}
                    >
                      条件をクリア
                    </button>
                  )
                }
                className="py-24"
              />
            }
          >
            <div
              className={loading ? 'opacity-60 transition-opacity' : undefined}
              aria-busy={loading}
            >
              {items.map((item) => (
                <ArticleListRow
                  key={item.articleId}
                  item={item}
                  onOpen={onOpenArticle}
                  onOpenWorkflow={onOpenWorkflow}
                  onOpenProject={onOpenProject}
                />
              ))}
              <Pagination
                page={page}
                pageInfo={pageInfo}
                disabled={loading || !listing.isPageCurrent || search.trim() !== debouncedSearch}
                onPrevious={listing.goPrevious}
                onNext={listing.goNext}
              />
            </div>
          </ListPageBody>
        </div>
      </section>
    </main>
  )
}
