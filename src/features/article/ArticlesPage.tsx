import { FileText, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppHeader } from '../../components/AppHeader'
import { getErrorDetail } from '../../lib/errors'
import { listArticles } from '../../lib/storage/projectStorage'
import type { ArticleListItem } from '../../types/project'
import { ArticleListRow } from './components/ArticleListRow'
import { getArticleStatus, type ArticleListStatus } from './articleList'

type StatusFilter = 'all' | ArticleListStatus

export function ArticlesPage({
  onHome,
  onProjects,
  onOpenArticle,
  onOpenWorkflow,
  onOpenProject,
}: {
  onHome: () => void
  onProjects: () => void
  onOpenArticle: (item: ArticleListItem) => void
  onOpenWorkflow: (item: ArticleListItem) => void
  onOpenProject: (item: ArticleListItem) => void
}) {
  const [items, setItems] = useState<ArticleListItem[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await listArticles())
      setError(null)
    } catch (cause) {
      setError(getErrorDetail(cause, '記事一覧を読み込めませんでした。'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Loading the external article index is the purpose of this effect.
    // eslint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh])

  const normalized = search.trim().toLocaleLowerCase()
  const filtered = useMemo(
    () =>
      items.filter((item) => {
        const matchesSearch =
          !normalized ||
          item.title.toLocaleLowerCase().includes(normalized) ||
          item.projectTitle.toLocaleLowerCase().includes(normalized)
        const matchesStatus = filter === 'all' || getArticleStatus(item) === filter
        return matchesSearch && matchesStatus
      }),
    [filter, items, normalized],
  )

  return (
    <main className="flex min-h-svh flex-col bg-[#f4f7f4] font-[Avenir_Next,Hiragino_Sans,Yu_Gothic,system-ui,sans-serif] text-[#18211f]">
      <AppHeader activeNav="articles" onHome={onHome} onProjects={onProjects} />
      <section className="mx-auto flex w-[calc(100%-48px)] max-w-[1040px] flex-1 flex-col pb-14 pt-12 md:w-[calc(100%-11.6vw)] md:pt-16">
        <div className="flex flex-wrap items-end justify-between gap-4 pb-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#71807b]">
              Articles
            </p>
            <h1 className="mt-2 text-[30px] font-bold tracking-[-0.07em] sm:text-[36px]">記事</h1>
            <p className="mt-2 text-xs text-[#71807b]">
              すべてのプロジェクトの記事をまとめて表示します。
            </p>
          </div>
          <p className="text-xs text-[#71807b]">{filtered.length}件</p>
        </div>
        {error && (
          <div
            className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[9px] border border-[#d6a18f] bg-[#fff8f5] px-4 py-3 text-xs text-[#a4573e]"
            role="alert"
          >
            <span>{error}</span>
            <button
              className="font-semibold underline"
              type="button"
              onClick={() => void refresh()}
            >
              再読み込み
            </button>
          </div>
        )}
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
          {loading ? (
            <div className="flex items-center justify-center py-24 text-xs text-[#71807b]">
              <RefreshCw className="mr-2 animate-spin" size={15} />
              読み込み中…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-5 py-24 text-center">
              <FileText className="text-[#9aada3]" size={33} strokeWidth={1.3} />
              <h2 className="mt-4 text-[17px] font-semibold">
                {items.length === 0 ? 'まだ記事がありません' : '条件に一致する記事がありません'}
              </h2>
              <p className="mt-2 text-xs leading-6 text-[#71807b]">
                {items.length === 0
                  ? 'ホームから動画を読み込むと、ここに記事が表示されます。'
                  : '検索語や状態フィルターを変更してください。'}
              </p>
              {items.length > 0 && (
                <button
                  className="mt-5 text-xs font-semibold text-[#1d6b50] underline"
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setFilter('all')
                  }}
                >
                  条件をクリア
                </button>
              )}
            </div>
          ) : (
            <div>
              {filtered.map((item) => (
                <ArticleListRow
                  key={item.articleId}
                  item={item}
                  onOpen={onOpenArticle}
                  onOpenWorkflow={onOpenWorkflow}
                  onOpenProject={onOpenProject}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
