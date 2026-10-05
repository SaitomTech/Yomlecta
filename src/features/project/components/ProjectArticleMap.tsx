import { ChevronDown, ChevronRight, CircleDot, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatPlaybackTime } from '../article-creator/rangeDraft'
import { formatTimestamp } from '../../../lib/time'
import { formatSize } from '../../import/utils'
import type { Article, MediaProject, ProjectVideo } from '../../../types/project'
import { VideoThumbnail } from './VideoThumbnail'

import { ArticleThumbnail, getArticleThumbnail } from '../../article/components/ArticleThumbnail'

function articleStatus(article: Article) {
  if (article.workflow.lastVisitedStep === 'export' || article.workflow.maxReachedStep === 'export')
    return { label: '作成完了', tone: 'done' as const }
  if (article.workflow.lastVisitedStep === 'crop')
    return { label: '未着手', tone: 'notStarted' as const }
  return { label: '作業中', tone: 'working' as const }
}

function articleActionLabel(article: Article) {
  if (article.workflow.lastVisitedStep === 'export' || article.workflow.maxReachedStep === 'export')
    return '記事を見る'
  if (article.workflow.lastVisitedStep === 'crop') return '作成を開始'
  return '作成を再開'
}

function toneClass(tone: ReturnType<typeof articleStatus>['tone']) {
  if (tone === 'done') return 'bg-[#e8f2ec] text-[#1d6b50]'
  if (tone === 'notStarted') return 'bg-[#edf2f0] text-[#53615b]'
  return 'bg-[#e8f0f5] text-[#315f75]'
}

function ArticleTimelineRow({
  article,
  highlighted,
  isFirst,
  isLast,
  onOpen,
  onEdit,
  onDelete,
}: {
  article: Article
  highlighted: boolean
  isFirst: boolean
  isLast: boolean
  onOpen: (articleId: string) => void
  onEdit: (articleId: string) => void
  onDelete: (articleId: string) => void
}) {
  const status = articleStatus(article)
  const duration = Math.max(0, article.sourceRange.endMs - article.sourceRange.startMs)

  return (
    <div
      className={`relative grid grid-cols-[128px_minmax(0,1fr)_auto] border-t border-[#e1e9e4] transition-colors duration-700 sm:grid-cols-[144px_minmax(0,1fr)_auto] ${highlighted ? 'bg-[#fff8e7]' : 'bg-white/75'}`}
    >
      <div className="relative flex min-h-[76px] flex-col justify-center border-r border-[#e1e9e4] pl-8 pr-2 text-[10px] text-[#71807b] sm:pl-10 sm:pr-3">
        <div
          aria-hidden="true"
          className={`absolute bottom-0 left-[25px] top-0 border-l border-[#a8c9b9] ${isFirst ? 'top-1/2' : ''} ${isLast ? 'bottom-1/2' : ''}`}
        />
        <CircleDot
          aria-hidden="true"
          className="absolute left-[19px] top-1/2 -translate-y-1/2 text-[#2d8062]"
          size={13}
          strokeWidth={1.8}
        />
        <span className="whitespace-nowrap font-mono font-medium text-[#50625a]">
          {formatPlaybackTime(article.sourceRange.startMs)} —{' '}
          {formatPlaybackTime(article.sourceRange.endMs)}
        </span>
        <span className="mt-1 text-[10px] text-[#94a19b]">{formatTimestamp(duration)}</span>
      </div>

      <div className="flex min-w-0 flex-col items-start justify-center gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-start sm:px-5">
        <ArticleThumbnail {...getArticleThumbnail(article)} />
        <div className="min-w-0">
          <span className="mb-1.5 flex w-fit items-center rounded-full border border-[#cbd9e6] bg-[#edf2f8] px-2 py-1 text-[10px] font-semibold text-[#496580]">
            記事作成フロー
          </span>
          <h4 className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.02em] text-[#18211f]">
            <button
              className="block max-w-full truncate text-left after:absolute after:inset-0 after:cursor-pointer after:transition hover:after:bg-[#496580]/5 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-[#496580]/30"
              type="button"
              onClick={() => (status.tone === 'done' ? onEdit(article.id) : onOpen(article.id))}
              title={article.title}
            >
              {article.title || '無題の記事'}
            </button>
          </h4>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2 px-3 py-3.5 sm:px-4">
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${toneClass(status.tone)}`}
        >
          {status.label}
        </span>
        <div className="relative z-10 flex flex-wrap items-center justify-end gap-1.5">
          {status.tone === 'done' && (
            <button
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#b7cbc0] bg-white px-3 py-2 text-xs font-semibold text-[#1d6b50] transition hover:bg-[#f4faf6]"
              type="button"
              onClick={() => onEdit(article.id)}
            >
              記事を編集
              <ChevronRight size={13} strokeWidth={1.8} />
            </button>
          )}
          <button
            className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-xs font-semibold transition ${status.tone !== 'working' ? 'bg-[#1d6b50] text-white shadow-[0_5px_12px_rgba(29,107,80,0.12)] hover:bg-[#174d3c]' : 'border border-[#b7cbc0] bg-white text-[#1d6b50] hover:bg-[#f4faf6]'}`}
            type="button"
            onClick={() => onOpen(article.id)}
          >
            {articleActionLabel(article)}
            <ChevronRight size={13} strokeWidth={1.8} />
          </button>
          <button
            className="rounded-[8px] p-2 text-[#9aa6a1] transition hover:bg-[#f8ebe7] hover:text-[#b6533a]"
            type="button"
            onClick={() => onDelete(article.id)}
            aria-label={`${article.title}を削除`}
            title="記事を削除"
          >
            <Trash2 size={15} strokeWidth={1.7} />
          </button>
        </div>
      </div>
    </div>
  )
}

function VideoGroup({
  video,
  articles,
  highlightedArticleIds,
  onStart,
  onOpen,
  onEdit,
  onDelete,
  onDeleteVideo,
}: {
  video: ProjectVideo
  articles: Article[]
  highlightedArticleIds: Set<string>
  onStart: (video: ProjectVideo) => void
  onOpen: (articleId: string) => void
  onEdit: (articleId: string) => void
  onDelete: (articleId: string) => void
  onDeleteVideo: (videoId: string) => void
}) {
  const [expanded, setExpanded] = useState(true)

  return (
    <section className="overflow-hidden rounded-[12px] border border-[#cbdcd2] bg-white">
      <div className="grid min-h-[94px] grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 bg-[#f5faf7] px-4 py-3.5 sm:grid-cols-[36px_minmax(0,1fr)_auto] sm:gap-4 sm:px-5">
        <button
          className="flex h-full min-h-[76px] w-full items-center justify-center rounded-[8px] text-[#53615b] transition hover:bg-[#f1f6f3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/25"
          type="button"
          aria-label={expanded ? `${video.title}を折りたたむ` : `${video.title}を展開`}
          aria-expanded={expanded}
          aria-controls={`video-articles-${video.id}`}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <ChevronDown size={17} strokeWidth={1.8} />
          ) : (
            <ChevronRight size={17} strokeWidth={1.8} />
          )}
        </button>

        <div className="min-w-0">
          <button
            className="flex min-w-0 w-full items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/25 sm:gap-4"
            type="button"
            onClick={() => setExpanded((value) => !value)}
          >
            <VideoThumbnail video={video} />
            <span className="min-w-0 flex-1">
              <span className="mb-1.5 flex w-fit items-center rounded-full border border-[#f1cbc8] bg-[#fff1f0] px-2 py-1 text-[10px] font-semibold text-[#a34f4b]">
                動画
              </span>
              <span className="block min-w-0 truncate text-sm font-semibold tracking-[-0.02em] text-[#18211f]">
                {video.title}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-[#71807b]">
                <span>{formatTimestamp(video.media.metadata.durationMs)}</span>
                <span className="text-[#b7cbc0]">·</span>
                <span>
                  {video.media.metadata.width} × {video.media.metadata.height}
                </span>
                <span className="text-[#b7cbc0]">·</span>
                <span>{formatSize(video.media.sizeBytes)}</span>
                {video.media.origin?.kind === 'youtube' && (
                  <>
                    <span className="text-[#b7cbc0]">·</span>
                    <a
                      className="text-[#71807b] underline decoration-[#b7cbc0] underline-offset-2 hover:text-[#1d6b50] hover:decoration-[#1d6b50]"
                      href={video.media.origin.canonicalUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      YouTubeで開く
                    </a>
                  </>
                )}
              </span>
            </span>
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#b7cbc0] bg-white px-3 py-2 text-xs font-semibold text-[#1d6b50] transition hover:bg-[#f4faf6]"
            type="button"
            onClick={() => onStart(video)}
          >
            <Plus size={14} strokeWidth={1.9} />
            記事作成フローを追加
          </button>
          <button
            className="rounded-[8px] p-2 text-[#9aa6a1] transition hover:bg-[#f8ebe7] hover:text-[#b6533a]"
            type="button"
            title="動画を削除"
            aria-label={`${video.title}を削除`}
            onClick={() => onDeleteVideo(video.id)}
          >
            <Trash2 size={15} strokeWidth={1.7} />
          </button>
        </div>
      </div>

      {expanded && (
        <div id={`video-articles-${video.id}`}>
          {articles.length > 0 ? (
            articles.map((article, articleIndex) => (
              <ArticleTimelineRow
                key={article.id}
                article={article}
                highlighted={highlightedArticleIds.has(article.id)}
                isFirst={articleIndex === 0}
                isLast={articleIndex === articles.length - 1}
                onOpen={onOpen}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))
          ) : (
            <div className="border-t border-dashed border-[#d8e1dc] px-6 py-5 text-xs text-[#71807b] sm:pl-[118px]">
              まだ記事がありません。この動画から文字起こし記事を作成できます。
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export function ProjectArticleMap({
  project,
  onStartArticleCreator,
  onOpenArticle,
  onEditArticle,
  onDeleteArticle,
  onDeleteVideo,
}: {
  project: MediaProject
  onStartArticleCreator: (video?: ProjectVideo) => void
  onOpenArticle: (articleId: string) => void
  onEditArticle: (articleId: string) => void
  onDeleteArticle: (articleId: string) => void
  onDeleteVideo: (videoId: string) => void
}) {
  const compareArticleRanges = (left: Article, right: Article) =>
    left.sourceRange.startMs - right.sourceRange.startMs ||
    left.sourceRange.endMs - right.sourceRange.endMs ||
    left.createdAt.localeCompare(right.createdAt)

  const grouped = project.videos.map((video) => ({
    video,
    articles: project.articles
      .filter((article) => article.sourceVideoId === video.id)
      .sort(compareArticleRanges),
  }))
  const ungrouped = project.articles
    .filter(
      (article) =>
        !article.sourceVideoId ||
        !project.videos.some((video) => video.id === article.sourceVideoId),
    )
    .sort(compareArticleRanges)
  const knownArticleIds = useRef<Set<string> | null>(null)
  const [highlightedArticleIds, setHighlightedArticleIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const currentIds = new Set(project.articles.map((article) => article.id))
    const previousIds = knownArticleIds.current
    knownArticleIds.current = currentIds
    if (!previousIds) return

    const addedIds = [...currentIds].filter((articleId) => !previousIds.has(articleId))
    if (addedIds.length === 0) return

    setHighlightedArticleIds(new Set(addedIds))
    const timeoutId = window.setTimeout(() => setHighlightedArticleIds(new Set()), 1800)
    return () => window.clearTimeout(timeoutId)
  }, [project.articles])

  if (project.videos.length === 0) return null

  return (
    <section className="mt-5 space-y-3.5" aria-label="動画と記事の一覧">
      {grouped.map(({ video, articles }) => (
        <VideoGroup
          key={video.id}
          video={video}
          articles={articles}
          highlightedArticleIds={highlightedArticleIds}
          onStart={onStartArticleCreator}
          onOpen={onOpenArticle}
          onEdit={onEditArticle}
          onDelete={onDeleteArticle}
          onDeleteVideo={onDeleteVideo}
        />
      ))}

      {ungrouped.length > 0 && (
        <section className="rounded-[12px] border border-dashed border-[#d6a18f] bg-[#fffaf7] p-4">
          <p className="text-xs font-semibold text-[#9d422d]">元動画を確認できない記事</p>
          <p className="mt-1 text-[10px] text-[#a4573e]">既存プロジェクトの互換データです。</p>
          <div className="mt-2 overflow-hidden rounded-[8px] border border-[#f1d6cc] bg-white">
            {ungrouped.map((article, articleIndex) => (
              <ArticleTimelineRow
                key={article.id}
                article={article}
                highlighted={highlightedArticleIds.has(article.id)}
                isFirst={articleIndex === 0}
                isLast={articleIndex === ungrouped.length - 1}
                onOpen={onOpenArticle}
                onEdit={onEditArticle}
                onDelete={onDeleteArticle}
              />
            ))}
          </div>
        </section>
      )}
    </section>
  )
}
