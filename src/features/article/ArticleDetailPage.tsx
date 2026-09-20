import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Download,
  ExternalLink,
  Film,
  Maximize2,
  PencilLine,
  Sparkles,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { AppHeader } from '../../components/AppHeader'
import { useVideoSourceUrl } from '../../lib/media/useVideoSourceUrl'
import { formatTimestamp } from '../../lib/time'
import { useDialogA11y } from '../../lib/ui/useDialogA11y'
import type { ArticleListItem, MediaProject } from '../../types/project'
import {
  formatArticleDate,
  getArticleActionLabel,
  getArticleStatus,
  getArticleStatusLabel,
} from './articleList'

const statusClass = {
  done: 'bg-[#e8f2ec] text-[#1d6b50]',
  working: 'bg-[#e8f0f5] text-[#315f75]',
  'not-started': 'bg-[#edf2f0] text-[#53615b]',
} as const

function renderParagraphs(value: string) {
  return value
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((paragraph, index) => {
      const lines = paragraph.split('\n')
      return (
        <p key={`${paragraph.slice(0, 16)}-${index}`} className="mb-4 text-[16px] leading-[1.9] last:mb-0">
          {lines.map((line, lineIndex) => (
            <span key={`${line}-${lineIndex}`}>
              {line}
              {lineIndex < lines.length - 1 && <br />}
            </span>
          ))}
        </p>
      )
    })
}

export function ArticleDetailPage({
  project,
  item,
  onHome,
  onProjects,
  onBack,
  onEdit,
  onExport,
  onOpenProject,
}: {
  project: MediaProject
  item: ArticleListItem
  onHome: () => void
  onProjects: () => void
  onBack: () => void
  onEdit: () => void
  onExport: () => void
  onOpenProject: () => void
}) {
  const article = project.articles.find((candidate) => candidate.id === item.articleId)
  const status = getArticleStatus(item)
  const summary = article?.article?.summary
  const sections = article?.article?.sections?.sections ?? []
  const slides = article?.slides ?? []
  const videoSource = useVideoSourceUrl(project.source.path)
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
  const [isVideoOpen, setIsVideoOpen] = useState(false)
  const expandedDialogRef = useDialogA11y<HTMLDivElement>({
    open: expandedImage !== null,
    onClose: () => setExpandedImage(null),
  })
  const videoDialogRef = useDialogA11y<HTMLDivElement>({
    open: isVideoOpen,
    onClose: () => setIsVideoOpen(false),
  })

  return (
    <main className="flex min-h-svh flex-col bg-[#fbfcfa] font-[Avenir_Next,Hiragino_Sans,Yu_Gothic,system-ui,sans-serif] text-[#18211f]">
      <AppHeader activeNav="articles" onHome={onHome} onProjects={onProjects} />
      <div className="mx-auto flex min-h-[56px] w-[calc(100%-32px)] max-w-[1200px] items-center">
        <button
          className="inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-xs font-semibold text-[#71807b] transition hover:bg-[#e2eee8] hover:text-[#1d6b50]"
          type="button"
          onClick={onBack}
        >
          <ArrowLeft size={14} /> 記事一覧へ戻る
        </button>
      </div>
      <section className="mx-auto w-[calc(100%-32px)] max-w-[1200px] pb-16">
        <header className="mb-8 border-b border-[#d8e1dc] pb-6 pt-6">
          <p className="mb-1.5 text-xs font-semibold text-[#1d6b50]">生成された記事</p>
          <h1 className="text-[clamp(24px,5vw,40px)] font-bold leading-[1.2] tracking-[-0.05em]">
            {item.title || '無題の記事'}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[#71807b]">
            <button
              className="inline-flex items-center gap-1 font-semibold text-[#1d6b50] hover:underline"
              type="button"
              onClick={() => setIsVideoOpen(true)}
              aria-label="元動画を再生"
            >
              <Film size={13} aria-hidden="true" /> {project.source.name}
            </button>
            <span aria-hidden="true">·</span>
            <span>{formatTimestamp(project.source.metadata.durationMs)}</span>
            <span aria-hidden="true">·</span>
            <button className="font-semibold text-[#1d6b50] hover:underline" type="button" onClick={onOpenProject}>
              {item.projectTitle}
            </button>
            <time dateTime={item.createdAt}>（{formatArticleDate(item.createdAt)}作成）</time>
            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${statusClass[status]}`}>
              {getArticleStatusLabel(status)}
            </span>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-[9px] bg-[#1d6b50] px-4 py-3 text-xs font-semibold text-white shadow-[0_7px_16px_rgba(29,107,80,0.17)] transition hover:bg-[#174d3c]"
              type="button"
              onClick={onEdit}
            >
              <PencilLine size={14} />
              {getArticleActionLabel(status) === '記事を見る' ? '記事を編集' : getArticleActionLabel(status)}
              <ArrowRight size={14} />
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-[9px] border border-[#b7cbc0] bg-white px-4 py-3 text-xs font-semibold text-[#1d6b50] transition hover:bg-[#f4faf6]"
              type="button"
              onClick={onOpenProject}
            >
              <ExternalLink size={14} /> プロジェクト詳細へ
            </button>
            {status === 'done' && (
              <button
                className="inline-flex items-center gap-2 rounded-[9px] px-3 py-3 text-xs font-semibold text-[#53615b] transition hover:bg-[#e8f2ec] hover:text-[#1d6b50]"
                type="button"
                onClick={onExport}
              >
                <Download size={14} /> 書き出し
              </button>
            )}
          </div>
        </header>

        {!article ? (
          <div className="mt-8 rounded-[14px] border border-[#d6a18f] bg-[#fff8f5] px-4 py-4 text-sm text-[#a4573e]">
            記事の内容を読み込めませんでした。記事一覧へ戻って再度お試しください。
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[210px_minmax(0,1fr)]">
            <aside className="h-fit lg:sticky lg:top-6">
              <div className="rounded-[12px] border border-[#d8e1dc] bg-white p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#53615b]">
                  <BookOpen size={14} className="text-[#2d8062]" /> 目次
                </div>
                {sections.length > 0 ? (
                  <nav className="mt-3 space-y-1.5" aria-label="記事の目次">
                    {sections.map((section) => (
                      <a
                        key={section.id}
                        className="block rounded-[7px] px-2 py-1.5 text-xs leading-5 text-[#71807b] hover:bg-[#edf5f0] hover:text-[#1d6b50]"
                        href={`#${section.id}`}
                      >
                        {section.heading}
                      </a>
                    ))}
                  </nav>
                ) : (
                  <p className="mt-3 text-xs leading-5 text-[#9aa6a1]">章立てはまだありません。</p>
                )}
              </div>
            </aside>
            <article className="min-w-0">
            {summary && (
              <section
                className="mb-7 overflow-hidden rounded-[15px] border border-[#b7cbc0] bg-[#fbfcfa]"
                aria-labelledby="article-detail-summary"
              >
                <header className="border-b border-[#d8e1dc] bg-[#eef6f0] px-[22px] py-[18px]">
                  <h2 id="article-detail-summary" className="flex items-center gap-2 text-[20px] font-bold tracking-[-0.04em] text-[#1d6b50]">
                    <Sparkles size={16} aria-hidden="true" /> AI要約
                  </h2>
                </header>
                <div className="px-[22px] py-[22px]">
                  <div className="text-[#35443e]">{renderParagraphs(summary.overview)}</div>
                  <div className="mt-[22px] rounded-[9px] bg-[#f4f8f4] px-[18px] py-[14px]">
                    <h3 className="mb-2.5 text-[11px] font-semibold tracking-[0.03em] text-[#71807b]">中心メッセージ</h3>
                    <p className="m-0 text-[15px] leading-[1.8] text-[#35443e]">{summary.mainMessage}</p>
                  </div>
                  <div className="mt-[22px] grid gap-7 border-t border-[#d8e1dc] pt-[18px] md:grid-cols-[1.2fr_1fr]">
                    <div>
                      <h3 className="mb-2 text-[11px] font-semibold tracking-[0.03em] text-[#71807b]">主なポイント</h3>
                      <ul className="space-y-[7px] pl-[18px] text-[14px] leading-[1.7] text-[#35443e]">
                        {summary.keyPoints.map((point) => (
                          <li key={point} className="list-disc">
                            {point}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h3 className="mb-2 text-[11px] font-semibold tracking-[0.03em] text-[#71807b]">キーワード</h3>
                      <div className="flex flex-wrap gap-[7px]">
                        {summary.keywords.map((keyword) => (
                          <span key={keyword} className="rounded-full border border-[#b7cbc0] bg-[#f4f8f4] px-[9px] py-1 text-xs text-[#53615b]">
                            {keyword}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {slides.length === 0 ? (
              <div className="mt-8 rounded-[14px] border border-dashed border-[#b7cbc0] bg-[#fbfcfa] px-5 py-12 text-center">
                <p className="text-sm font-semibold">本文はまだありません</p>
                <p className="mt-2 text-xs leading-6 text-[#71807b]">
                  {status === 'not-started'
                    ? '記事の作成を開始すると、ここに本文が表示されます。'
                    : '記事を編集して本文を生成してください。'}
                </p>
                <button
                  className="mt-5 inline-flex items-center gap-2 rounded-[9px] bg-[#1d6b50] px-4 py-3 text-xs font-semibold text-white"
                  type="button"
                  onClick={onEdit}
                >
                  {getArticleActionLabel(status)} <ArrowRight size={14} />
                </button>
              </div>
            ) : (
              <div>
                {slides.map((slide, index) => {
                  const section = sections.find((candidate) => candidate.slideIds.includes(slide.id))
                  const isSectionStart = section?.slideIds[0] === slide.id
                  return (
                    <div key={slide.id} className={isSectionStart && index > 0 ? 'mt-5' : undefined}>
                      {isSectionStart && section && (
                        <div id={section.id} className="mb-[10px] flex min-h-[44px] items-center border-l-[10px] border-[#8bb6a2] bg-[#e8f2ec] px-3 py-[7px] scroll-mt-6">
                          <h2 className="text-[22px] font-bold leading-[1.35] tracking-[-0.05em]">{section.heading}</h2>
                        </div>
                      )}
                      <article className="py-2 pb-[18px]">
                        <div className="grid items-start gap-8 min-[601px]:grid-cols-2">
                          <figure className="relative m-0">
                            {slide.image.representativeFramePath && (
                              <button
                                className="group relative block w-full cursor-zoom-in border-0 bg-transparent p-0 text-left"
                                type="button"
                                onClick={() => setExpandedImage(convertFileSrc(slide.image.representativeFramePath!))}
                                aria-label="画像を拡大"
                              >
                                <img
                                  className="block w-full border border-[#d8e1dc]"
                                  src={convertFileSrc(slide.image.representativeFramePath)}
                                  alt="代表画像"
                                />
                                <span className="absolute bottom-[10px] right-[10px] inline-flex items-center gap-1 bg-[rgba(24,33,31,0.78)] px-[7px] py-1 text-[11px] leading-[1.3] text-[#f3faf6] opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                                  <Maximize2 size={12} aria-hidden="true" /> 拡大
                                </span>
                              </button>
                            )}
                            <figcaption className="absolute bottom-[10px] left-[10px] m-0 rounded-[5px] bg-[rgba(24,33,31,0.78)] px-[7px] py-1 font-mono text-[11px] leading-[1.3] text-[#f3faf6]">
                              {formatTimestamp(slide.startMs)} — {formatTimestamp(slide.endMs)}
                            </figcaption>
                          </figure>
                          <div className="content min-w-0 text-[#35443e]">
                            {renderParagraphs(slide.transcript?.articleBody ?? '')}
                          </div>
                        </div>
                      </article>
                    </div>
                  )
                })}
              </div>
            )}
            </article>
          </div>
        )}
      </section>
      {expandedImage && (
        <div
          ref={expandedDialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#07110d]/82 p-5 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="画像プレビュー"
          tabIndex={-1}
          onClick={(event) => {
            if (event.target === event.currentTarget) setExpandedImage(null)
          }}
        >
          <div className="relative max-h-full max-w-full border border-[#d8e1dc]/40 bg-[#0b1712] shadow-[0_24px_80px_rgba(0,0,0,0.38)]">
            <img
              className="block max-h-[88vh] max-w-[92vw] object-contain"
              src={expandedImage}
              alt="代表画像（拡大）"
            />
            <button
              type="button"
              className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center bg-[#18211f]/78 text-[#f3faf6] transition hover:bg-[#18211f]/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              onClick={() => setExpandedImage(null)}
              aria-label="拡大画像を閉じる"
              title="閉じる"
            >
              <X size={17} strokeWidth={1.8} />
            </button>
          </div>
        </div>
      )}
      {isVideoOpen && (
        <div
          ref={videoDialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#07110d]/82 p-5 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="元動画プレビュー"
          tabIndex={-1}
          onClick={(event) => {
            if (event.target === event.currentTarget) setIsVideoOpen(false)
          }}
        >
          <div className="relative w-[min(960px,calc(100vw-40px))] overflow-hidden border border-[#d8e1dc]/40 bg-[#0b1712] shadow-[0_24px_80px_rgba(0,0,0,0.38)]">
            <div className="flex items-center justify-between gap-4 border-b border-[#d8e1dc]/25 px-4 py-3 text-xs font-semibold text-[#f3faf6]">
              <span className="truncate">{project.source.name}</span>
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center bg-[#18211f]/78 text-[#f3faf6] transition hover:bg-[#18211f]/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                onClick={() => setIsVideoOpen(false)}
                aria-label="動画プレビューを閉じる"
                title="閉じる"
              >
                <X size={17} strokeWidth={1.8} />
              </button>
            </div>
            {videoSource.src ? (
              <video
                key={videoSource.src}
                className="block max-h-[78vh] w-full bg-black object-contain"
                src={videoSource.src}
                controls
                autoPlay
                playsInline
                preload="metadata"
                aria-label="元動画プレビュー"
              />
            ) : (
              <div className="grid aspect-video place-items-center bg-black px-5 text-xs text-[#d8e1dc]">
                {videoSource.error ? '動画を読み込めませんでした。' : '動画を読み込んでいます…'}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
