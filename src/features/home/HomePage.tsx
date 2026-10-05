import { ArrowRight, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { getErrorDetail } from '../../lib/errors'
import { listArticles, listProjects } from '../../lib/storage/projectStorage'
import type { ArticleListItem, ProjectListEntry, ProjectVideo } from '../../types/project'
import type { SelectedVideo, YoutubeImportOptions, YoutubeImportRequest } from '../import/types'
import { VideoImportPanel } from '../project/VideoImportPanel'
import { ProjectListRow } from '../project/components/ProjectListRow'
import { ArticleListRow } from '../article/components/ArticleListRow'

type HomePageProps = {
  onOpenProjects: () => void
  onOpenArticles: () => void
  onOpenProject: (projectId: string) => Promise<void>
  onOpenArticle: (item: ArticleListItem) => void
  onOpenArticleWorkflow: (item: ArticleListItem) => void
  onAddLocalVideo: (video: SelectedVideo) => Promise<ProjectVideo>
  onAddYoutubeVideo: (
    request: YoutubeImportRequest,
    options: YoutubeImportOptions,
  ) => Promise<ProjectVideo>
}

export function HomePage({
  onOpenProjects,
  onOpenArticles,
  onOpenProject,
  onOpenArticle,
  onOpenArticleWorkflow,
  onAddLocalVideo,
  onAddYoutubeVideo,
}: HomePageProps) {
  const [entries, setEntries] = useState<ProjectListEntry[]>([])
  const [articles, setArticles] = useState<ArticleListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [projectsResult, articlesResult] = await Promise.allSettled([
      listProjects({ pageSize: 5 }),
      listArticles({ pageSize: 5 }),
    ])
    const errors: string[] = []
    if (projectsResult.status === 'fulfilled') setEntries(projectsResult.value.items)
    else
      errors.push(getErrorDetail(projectsResult.reason, 'プロジェクト一覧を読み込めませんでした。'))
    if (articlesResult.status === 'fulfilled') setArticles(articlesResult.value.items)
    else errors.push(getErrorDetail(articlesResult.reason, '記事一覧を読み込めませんでした。'))
    setError(errors.length > 0 ? errors.join(' ') : null)
    setLoading(false)
  }, [])

  useEffect(() => {
    // Loading the external project index is the purpose of this effect.
    // eslint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh])

  const projects = entries.filter(
    (entry): entry is Extract<ProjectListEntry, { kind: 'project' }> => entry.kind === 'project',
  )
  return (
    <main className="flex min-h-[calc(100svh-76px)] flex-col bg-[#f4f7f4] font-[Avenir_Next,Hiragino_Sans,Yu_Gothic,system-ui,sans-serif] text-[#18211f]">
      <section className="mx-auto flex w-[calc(100%-48px)] max-w-[1120px] flex-1 flex-col pb-14 pt-12 md:w-[calc(100%-11.6vw)] md:pt-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-stretch lg:gap-14">
          <div className="flex min-w-0 flex-col">
            <div className="max-w-[500px]">
              <h1 className="text-[30px] font-bold leading-[1.12] tracking-[-0.07em] text-[#18211f] sm:text-[38px]">
                動画を、
                <br />
                読める記事に。
              </h1>
              <p className="mt-4 max-w-[390px] text-[14px] leading-6 text-[#53615b]">
                スライドを利用した講演や講義の動画から、文字起こし記事を自動で作成します。
              </p>
            </div>
            <div className="mt-7">
              <VideoImportPanel
                onAddLocalVideo={onAddLocalVideo}
                onAddYoutubeVideo={onAddYoutubeVideo}
                primaryActionLabel="動画を読み込む"
              />
            </div>
          </div>
          <div className="relative hidden min-h-0 lg:block">
            <div className="absolute inset-0 overflow-hidden rounded-[14px] border border-[#cbd9d1] bg-[#e8f2ec]">
              <img
                className="block h-full w-full object-cover"
                src="/home-hero-illustration.png"
                alt="講義動画を記事として整理する流れ"
              />
            </div>
          </div>
        </div>

        {error && (
          <p
            className="mt-8 rounded-[9px] border border-[#d6a18f] bg-[#fff8f5] px-4 py-3 text-xs text-[#a4573e]"
            role="alert"
          >
            {error}
          </p>
        )}

        <section className="mt-14" aria-labelledby="recent-articles-title">
          <div className="flex flex-wrap items-end justify-between gap-3 pb-2">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#71807b]">
                Recent articles
              </p>
              <h2
                id="recent-articles-title"
                className="mt-1 text-[20px] font-bold tracking-[-0.05em]"
              >
                最新の記事
              </h2>
            </div>
            {articles.length > 0 && (
              <button
                className="inline-flex items-center rounded-[8px] px-2 py-2 text-xs font-semibold text-[#1d6b50] transition hover:bg-[#e2eee8]"
                type="button"
                onClick={onOpenArticles}
              >
                すべての記事を見る
              </button>
            )}
          </div>
          <div className="overflow-hidden rounded-[14px] border border-[#b7cbc0] bg-white shadow-[0_18px_52px_rgba(22,54,42,0.04)]">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-xs text-[#71807b]">
                <RefreshCw className="mr-2 animate-spin" size={15} />
                読み込み中…
              </div>
            ) : articles.length === 0 ? (
              <div className="px-5 py-10 text-center text-xs leading-6 text-[#71807b]">
                まだ記事がありません。上のエリアから動画を読み込むと、ここに表示されます。
              </div>
            ) : (
              <div>
                {articles.map((item) => (
                  <ArticleListRow
                    key={item.articleId}
                    item={item}
                    onOpen={onOpenArticle}
                    onOpenWorkflow={onOpenArticleWorkflow}
                    onOpenProject={(article) => void onOpenProject(article.projectId)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="mt-14" aria-labelledby="recent-projects-title">
          <div className="flex flex-wrap items-end justify-between gap-3 pb-2">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#71807b]">
                Recent work
              </p>
              <h2
                id="recent-projects-title"
                className="mt-1 text-[20px] font-bold tracking-[-0.05em]"
              >
                最近のプロジェクト
              </h2>
            </div>
            {projects.length > 0 && (
              <button
                className="inline-flex items-center gap-1.5 rounded-[8px] px-2 py-2 text-xs font-semibold text-[#1d6b50] transition hover:bg-[#e2eee8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30"
                type="button"
                onClick={onOpenProjects}
              >
                プロジェクト一覧を見る
                <ArrowRight size={14} />
              </button>
            )}
          </div>
          <div className="overflow-hidden rounded-[14px] border border-[#b7cbc0] bg-white shadow-[0_18px_52px_rgba(22,54,42,0.04)]">
            {loading ? (
              <div className="flex items-center justify-center py-20 text-xs text-[#71807b]">
                <RefreshCw className="mr-2 animate-spin" size={15} />
                読み込み中…
              </div>
            ) : projects.length === 0 ? (
              <div className="px-5 py-10 text-center text-xs leading-6 text-[#71807b]">
                まだプロジェクトがありません。上のエリアから動画を読み込むと、ここに表示されます。
              </div>
            ) : (
              projects.map(({ summary }) => (
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
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  )
}
