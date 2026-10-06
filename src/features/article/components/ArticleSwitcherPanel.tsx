import { articleMetadata } from '../../../lib/project/articleSelectors'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Film,
  LoaderCircle,
  Search,
  X,
} from 'lucide-react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useMemo, useState } from 'react'
import { useDialogA11y } from '../../../lib/ui/useDialogA11y'
import { formatTimestamp } from '../../../lib/time'
import { formatPlaybackTime } from '../../project/article-creator/rangeDraft'
import type { ArticleMetadata, Project, ProjectVideo } from '../../../types/project'
import { VideoThumbnail } from '../../project/components/VideoThumbnail'

type ArticleSwitcherPanelProps = {
  project: Project
  onClose: () => void
  onSelect: (articleId: string) => void | Promise<void>
  selectedArticleId?: string
  disabled?: boolean
}

function ArticleThumbnail({ article }: { article: ArticleMetadata }) {
  const imagePath = [article.thumbnailPath].find((path): path is string => Boolean(path))

  return (
    <div className="grid h-12 w-[76px] shrink-0 place-items-center overflow-hidden rounded-[7px] border border-[#d8e1dc] bg-[#e8f2ec]">
      {imagePath ? (
        <img
          className="h-full w-full object-cover"
          src={convertFileSrc(imagePath)}
          alt=""
          loading="lazy"
        />
      ) : (
        <Film className="text-[#8da79a]" size={18} strokeWidth={1.4} />
      )}
    </div>
  )
}

function articleStatus(article: ArticleMetadata) {
  if (
    article.workflow.lastVisitedStep === 'export' ||
    article.workflow.maxReachedStep === 'export'
  ) {
    return {
      label: '作成完了',
      className: 'bg-[#e8f2ec] text-[#1d6b50]',
      icon: CheckCircle2,
    }
  }
  if (article.workflow.lastVisitedStep === 'crop') {
    return {
      label: '未着手',
      className: 'bg-[#edf2f0] text-[#53615b]',
      icon: Clock3,
    }
  }
  return {
    label: '作業中',
    className: 'bg-[#e8f0f5] text-[#315f75]',
    icon: LoaderCircle,
  }
}

function sortArticles(left: ArticleMetadata, right: ArticleMetadata) {
  return (
    left.sourceRange.startMs - right.sourceRange.startMs ||
    left.sourceRange.endMs - right.sourceRange.endMs ||
    left.createdAt.localeCompare(right.createdAt)
  )
}

function matchesArticle(article: ArticleMetadata, normalizedQuery: string) {
  if (!normalizedQuery) return true
  return article.title.toLocaleLowerCase().includes(normalizedQuery)
}

function ArticleRow({
  article,
  selected,
  onSelect,
  disabled,
}: {
  article: ArticleMetadata
  selected: boolean
  onSelect: (articleId: string) => void
  disabled: boolean
}) {
  const status = articleStatus(article)
  const StatusIcon = status.icon
  const duration = Math.max(0, article.sourceRange.endMs - article.sourceRange.startMs)

  return (
    <button
      className={`flex w-full items-center gap-3 border-b border-[#e1e9e4] bg-white px-4 py-3 text-left transition last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-55 sm:px-5 ${selected ? '' : 'hover:bg-[#f4f8fb]'}`}
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      onClick={() => onSelect(article.id)}
    >
      <ArticleThumbnail article={article} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex w-fit shrink-0 items-center rounded-full border border-[#cbd9e6] bg-[#edf2f8] px-1.5 py-0.5 text-[9px] font-semibold text-[#496580]">
            記事
          </span>
          <span className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.02em] text-[#18211f]">
            {article.title}
          </span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[#71807b]">
          <span className="font-mono">
            {formatPlaybackTime(article.sourceRange.startMs)} –{' '}
            {formatPlaybackTime(article.sourceRange.endMs)}
          </span>
          <span aria-hidden="true">·</span>
          <span>{formatTimestamp(duration)}</span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold ${status.className}`}
          >
            <StatusIcon size={10} strokeWidth={2} />
            {status.label}
          </span>
        </span>
      </span>
      {selected ? (
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#dcece3] text-[#1d6b50]">
          <Check size={14} strokeWidth={2.2} aria-hidden="true" />
        </span>
      ) : (
        <ChevronRight className="shrink-0 text-[#9aada3]" size={16} strokeWidth={1.7} />
      )}
    </button>
  )
}

function VideoArticleGroup({
  video,
  articles,
  selectedArticleId,
  collapsed,
  onToggle,
  onSelect,
  disabled,
}: {
  video: ProjectVideo
  articles: ArticleMetadata[]
  selectedArticleId?: string
  collapsed: boolean
  onToggle: () => void
  onSelect: (articleId: string) => void
  disabled: boolean
}) {
  return (
    <section className="overflow-hidden rounded-[11px] border border-[#cbdcd2] bg-white">
      <div className="grid min-h-[92px] grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 bg-[#f5faf7] px-4 py-3 sm:grid-cols-[36px_minmax(0,1fr)_auto] sm:gap-4 sm:px-5">
        <button
          className="flex h-full min-h-[68px] w-full items-center justify-center rounded-[8px] text-[#53615b] transition hover:bg-[#eef7f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/25"
          type="button"
          aria-label={collapsed ? `${video.title}を展開` : `${video.title}を折りたたむ`}
          aria-expanded={!collapsed}
          aria-controls={`switcher-video-${video.id}`}
          onClick={onToggle}
        >
          {collapsed ? (
            <ChevronRight size={17} strokeWidth={1.8} />
          ) : (
            <ChevronDown size={17} strokeWidth={1.8} />
          )}
        </button>
        <button
          className="flex min-w-0 w-full items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/25 sm:gap-4"
          type="button"
          aria-label={`${video.title}の記事を${collapsed ? '展開' : '折りたたむ'}`}
          aria-expanded={!collapsed}
          aria-controls={`switcher-video-${video.id}`}
          onClick={onToggle}
        >
          <VideoThumbnail video={video} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex w-fit shrink-0 items-center rounded-full border border-[#f1cbc8] bg-[#fff1f0] px-1.5 py-0.5 text-[9px] font-semibold text-[#a34f4b]">
                動画
              </span>
              <span className="min-w-0 truncate text-sm font-semibold tracking-[-0.02em] text-[#18211f]">
                {video.title}
              </span>
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-[#71807b]">
              <span>{formatTimestamp(video.media.metadata.durationMs)}</span>
            </span>
          </span>
        </button>
        <span className="shrink-0 text-right text-[10px] font-semibold text-[#71807b]">
          {articles.length}件
        </span>
      </div>

      {!collapsed && (
        <div
          id={`switcher-video-${video.id}`}
          className="border-t border-[#d8e1dc]"
          role="group"
          aria-label={`${video.title}の記事`}
        >
          {articles.map((article) => (
            <ArticleRow
              key={article.id}
              article={article}
              selected={article.id === selectedArticleId}
              onSelect={onSelect}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export function ArticleSwitcherPanel({
  project,
  onClose,
  onSelect,
  selectedArticleId,
  disabled = false,
}: ArticleSwitcherPanelProps) {
  const [query, setQuery] = useState('')
  const [collapsedVideoIds, setCollapsedVideoIds] = useState<Set<string>>(new Set())
  const dialogRef = useDialogA11y({ open: true, onClose, closeDisabled: disabled })

  const groups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const knownVideoIds = new Set(project.videos.map((video) => video.id))
    const matchesVideo = (video: ProjectVideo) =>
      !normalizedQuery || video.title.toLocaleLowerCase().includes(normalizedQuery)

    const knownGroups = project.videos
      .map((video) => {
        const videoMatches = matchesVideo(video)
        const articles = project.articles
          .map(articleMetadata)
          .filter(
            (article) =>
              article.sourceVideoId === video.id &&
              (videoMatches || matchesArticle(article, normalizedQuery)),
          )
          .sort(sortArticles)
        return { video, articles }
      })
      .filter(({ articles }) => articles.length > 0)

    const ungrouped = project.articles
      .map(articleMetadata)
      .filter(
        (article) =>
          (!article.sourceVideoId || !knownVideoIds.has(article.sourceVideoId)) &&
          matchesArticle(article, normalizedQuery),
      )
      .sort(sortArticles)

    return { knownGroups, ungrouped }
  }, [project.articles, project.videos, query])

  const toggleVideo = (videoId: string) => {
    setCollapsedVideoIds((current) => {
      const next = new Set(current)
      if (next.has(videoId)) next.delete(videoId)
      else next.add(videoId)
      return next
    })
  }

  const handleArticleSelect = (articleId: string) => {
    if (articleId === selectedArticleId) onClose()
    else void onSelect(articleId)
  }

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-0 grid h-full w-full max-w-none place-items-center border-0 bg-[#18211f]/35 p-5 backdrop:bg-transparent"
      open
      aria-modal="true"
      aria-labelledby="article-switcher-title"
    >
      <section className="flex max-h-[calc(100vh-40px)] w-full max-w-[720px] flex-col overflow-hidden rounded-[16px] border border-[#b7cbc0] bg-white shadow-[0_24px_70px_rgba(24,33,31,0.2)]">
        <header className="flex items-start justify-between gap-3 border-b border-[#d8e1dc] px-5 py-5 sm:px-6">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#71807b]">
              ARTICLE SWITCHER
            </p>
            <h2
              id="article-switcher-title"
              className="mt-1 text-[19px] font-bold tracking-[-0.04em]"
            >
              記事を切り替える
            </h2>
            <p className="mt-1 text-xs text-[#71807b]">
              記事を選ぶと、その記事の作業フローへ移動します。
            </p>
          </div>
          <button
            className="rounded-md p-1.5 text-[#71807b] transition hover:bg-[#e8f2ec] hover:text-[#53615b] disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            onClick={onClose}
            disabled={disabled}
            aria-label="記事の切り替えを閉じる"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex items-center gap-3 border-b border-[#d8e1dc] px-5 py-3 sm:px-6">
          <label className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9aada3]"
              size={15}
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <input
              className="h-9 w-full rounded-[8px] border border-[#cbdcd2] bg-white pl-9 pr-3 text-xs text-[#18211f] outline-none placeholder:text-[#9aada3] focus:border-[#1d6b50] focus:ring-2 focus:ring-[#1d6b50]/10"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="記事を検索"
              aria-label="記事を検索"
            />
          </label>
          <span className="shrink-0 rounded-full bg-[#edf4ef] px-2.5 py-1.5 text-[10px] font-semibold text-[#1d6b50]">
            すべて {project.articles.map(articleMetadata).length}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {groups.knownGroups.length === 0 && groups.ungrouped.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <Search className="text-[#9aada3]" size={28} strokeWidth={1.4} />
              <p className="mt-3 text-sm font-semibold">記事が見つかりません</p>
              <p className="mt-1 text-xs text-[#71807b]">検索条件を変えてお試しください。</p>
            </div>
          ) : (
            <div className="space-y-3" role="listbox" aria-label="プロジェクト内の記事">
              {groups.knownGroups.map(({ video, articles }) => (
                <VideoArticleGroup
                  key={video.id}
                  video={video}
                  articles={articles}
                  selectedArticleId={selectedArticleId}
                  collapsed={collapsedVideoIds.has(video.id)}
                  onToggle={() => toggleVideo(video.id)}
                  onSelect={handleArticleSelect}
                  disabled={disabled}
                />
              ))}

              {groups.ungrouped.length > 0 && (
                <section className="overflow-hidden rounded-[11px] border border-dashed border-[#d6a18f] bg-[#fffaf7]">
                  <div className="flex items-center gap-2 px-4 py-3 sm:px-5">
                    <span className="flex w-fit shrink-0 items-center rounded-full border border-[#ead3c9] bg-[#fff1eb] px-1.5 py-0.5 text-[9px] font-semibold text-[#9d422d]">
                      その他
                    </span>
                    <span className="text-xs font-semibold text-[#9d422d]">
                      元動画を確認できない記事
                    </span>
                  </div>
                  <div className="overflow-hidden border-t border-dashed border-[#f1d6cc] bg-white">
                    {groups.ungrouped.map((article) => (
                      <ArticleRow
                        key={article.id}
                        article={article}
                        selected={article.id === selectedArticleId}
                        onSelect={handleArticleSelect}
                        disabled={disabled}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[#d8e1dc] px-5 py-3.5 sm:px-6">
          <p className="text-[11px] leading-5 text-[#71807b]">
            記事の内容は記事ごとに保存されます。
          </p>
          <button
            className="shrink-0 rounded-[8px] px-3 py-2 text-xs font-semibold text-[#71807b] transition hover:bg-[#e8f2ec] hover:text-[#1d6b50] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30"
            type="button"
            onClick={onClose}
            disabled={disabled}
          >
            閉じる
          </button>
        </footer>
      </section>
    </dialog>
  )
}
