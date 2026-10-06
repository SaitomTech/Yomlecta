import { ArrowLeft, ArrowRight, BookOpen, Film, Maximize2, PencilLine, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigationDisabled } from '../../app/navigationDisabled'
import { useExport } from '../export/hooks/useExport'
import { ArticleExportControls } from '../export/ArticleExportControls'
import { convertFileSrc } from '@tauri-apps/api/core'
import { VideoPreviewDialog } from '../../components/VideoPreviewDialog'
import { articleBlockViews } from '../../lib/pipeline/articleBlocks'
import { formatTimestamp } from '../../lib/time'
import { useDialogA11y } from '../../lib/ui/useDialogA11y'
import type {
  ArticleListItem,
  ArticleOutputLanguage,
  ArticleSection,
  ArticleTranslation,
  MediaProject,
} from '../../types/project'
import { formatArticleDate, getArticleActionLabel, getArticleStatus } from './articleList'
import {
  getArticleOutputLanguage,
  getArticleSourceLanguage,
  getCurrentTranslationForOutputLanguage,
} from './outputLanguage'
import { articleLanguageLabel, resolveArticleLanguageVisibility } from './articleLanguage'
import { ArticleSummaryResult } from './components/ArticleSummaryResult'

function renderParagraphs(value: string) {
  return value
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((paragraph, index) => {
      const lines = paragraph.split('\n')
      return (
        <p
          key={`${paragraph.slice(0, 16)}-${index}`}
          className="mb-4 text-[16px] leading-[1.9] last:mb-0"
        >
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

function LanguageLabel({ language }: { language: string }) {
  return (
    <p className="mb-1 text-[10px] font-semibold text-[#71807b]">
      {articleLanguageLabel(language)}
    </p>
  )
}

function translatedSection(translation: ArticleTranslation | undefined, sectionId: string) {
  return translation?.sections?.find((candidate) => candidate.id === sectionId)
}

function ArticleSectionHeading({
  section,
  translatedHeading,
  translation,
  outputLanguage,
  sourceLanguage,
}: {
  section: ArticleSection
  translatedHeading?: ArticleSection
  translation?: ArticleTranslation
  outputLanguage: ArticleOutputLanguage
  sourceLanguage: string
}) {
  const visibility = resolveArticleLanguageVisibility({
    outputLanguage,
    sourceLanguage,
    targetLanguage: translation?.targetLanguage,
    hasTranslation: Boolean(translatedHeading),
  })
  return (
    <div className="min-w-0">
      {visibility.showSource && (
        <>
          {visibility.showSourceLanguageLabel && <LanguageLabel language={sourceLanguage} />}
          <h2 className="text-[22px] font-bold leading-[1.35] tracking-[-0.05em]">
            {section.heading}
          </h2>
        </>
      )}
      {visibility.showTranslation && translatedHeading && translation && (
        <div className={visibility.showSource ? 'mt-1' : ''}>
          {visibility.showTargetLanguageLabel && (
            <LanguageLabel language={translation.targetLanguage} />
          )}
          {visibility.showSource ? (
            <p className="text-[15px] font-semibold leading-[1.35] text-[#53615b]">
              {translatedHeading.heading}
            </p>
          ) : (
            <h2 className="text-[22px] font-bold leading-[1.35] tracking-[-0.05em]">
              {translatedHeading.heading}
            </h2>
          )}
        </div>
      )}
    </div>
  )
}

function ArticleSlideBody({
  sourceBody,
  translatedBody,
  translation,
  outputLanguage,
  sourceLanguage,
}: {
  sourceBody: string
  translatedBody?: string
  translation?: ArticleTranslation
  outputLanguage: ArticleOutputLanguage
  sourceLanguage: string
}) {
  const visibility = resolveArticleLanguageVisibility({
    outputLanguage,
    sourceLanguage,
    targetLanguage: translation?.targetLanguage,
    hasTranslation: translatedBody !== undefined,
  })
  return (
    <>
      {visibility.showSource && (
        <div>
          {visibility.showSourceLanguageLabel && <LanguageLabel language={sourceLanguage} />}
          {renderParagraphs(sourceBody)}
        </div>
      )}
      {visibility.showTranslation && translatedBody !== undefined && translation && (
        <div
          className={
            visibility.showTranslationDivider
              ? 'mt-3 border-t border-dashed border-[#c7d4cc] pt-3'
              : ''
          }
        >
          {visibility.showTargetLanguageLabel && (
            <LanguageLabel language={translation.targetLanguage} />
          )}
          {renderParagraphs(translatedBody)}
        </div>
      )}
    </>
  )
}

export function ArticleDetailPage({
  project,
  item,
  onBack,
  onEdit,
  onGenerated,
  onOpenProject,
}: {
  project: MediaProject
  item: ArticleListItem
  onBack: () => void
  onEdit: () => void
  onGenerated: () => void | Promise<void>
  onOpenProject: () => void
}) {
  const article = project.articles.find((candidate) => candidate.id === item.articleId)
  const status = getArticleStatus(item)
  const summary = project.article?.summary
  const sections = article?.article?.sections?.sections ?? []
  const slides = article ? articleBlockViews(article.slides, article.articleBlocks) : []
  const sourceOffsetMs = article?.sourceRange.startMs ?? 0
  const outputLanguage = getArticleOutputLanguage(project)
  const translation = getCurrentTranslationForOutputLanguage(project, outputLanguage)
  const sourceLanguage = getArticleSourceLanguage(project, translation)
  const titleVisibility = resolveArticleLanguageVisibility({
    outputLanguage,
    sourceLanguage,
    targetLanguage: translation?.targetLanguage,
    hasTranslation: Boolean(translation),
  })
  const sourceTitle = article?.title.trim() || item.title || '無題の記事'
  const exporter = useExport(project, onGenerated, Boolean(article && slides.length > 0))
  const isExportBusy = exporter.isBusy
  useNavigationDisabled(isExportBusy)
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
  const [isVideoOpen, setIsVideoOpen] = useState(false)
  const expandedDialogRef = useDialogA11y<HTMLDivElement>({
    open: expandedImage !== null,
    onClose: () => setExpandedImage(null),
  })

  return (
    <main className="flex min-h-[calc(100svh-76px)] flex-col bg-[#fbfcfa] font-[Avenir_Next,Hiragino_Sans,Yu_Gothic,system-ui,sans-serif] text-[#18211f]">
      <div className="mx-auto flex min-h-[56px] w-[calc(100%-32px)] max-w-[1200px] items-center">
        <button
          className="inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-xs font-semibold text-[#71807b] transition hover:bg-[#e2eee8] hover:text-[#1d6b50]"
          type="button"
          onClick={onBack}
          disabled={isExportBusy}
        >
          <ArrowLeft size={14} /> 記事一覧へ戻る
        </button>
      </div>
      <section className="mx-auto w-[calc(100%-32px)] max-w-[1200px] pb-16">
        <header className="mb-8 border-b border-[#d8e1dc] pb-6 pt-6">
          <div className="mb-3 flex items-start justify-between gap-4">
            <p className="text-xs font-semibold text-[#1d6b50]">生成された記事</p>
            <button
              className="inline-flex shrink-0 items-center gap-2 rounded-[9px] bg-[#1d6b50] px-4 py-3 text-xs font-semibold text-white shadow-[0_7px_16px_rgba(29,107,80,0.17)] transition hover:bg-[#174d3c]"
              type="button"
              onClick={onEdit}
              disabled={isExportBusy}
            >
              <PencilLine size={14} />
              {getArticleActionLabel(status) === '記事を見る'
                ? '記事を編集'
                : getArticleActionLabel(status)}
              <ArrowRight size={14} />
            </button>
          </div>
          {titleVisibility.showSource && (
            <>
              {outputLanguage === 'both' && <LanguageLabel language={sourceLanguage} />}
              <h1 className="text-[clamp(24px,5vw,40px)] font-bold leading-[1.2] tracking-[-0.05em]">
                {sourceTitle}
              </h1>
            </>
          )}
          {titleVisibility.showTranslation && translation && (
            <div className={titleVisibility.showSource ? 'mt-3' : ''}>
              {outputLanguage === 'both' && <LanguageLabel language={translation.targetLanguage} />}
              {titleVisibility.showSource ? (
                <p className="text-[clamp(19px,3.5vw,28px)] font-semibold leading-[1.35] text-[#53615b]">
                  {translation.title}
                </p>
              ) : (
                <h1 className="text-[clamp(24px,5vw,40px)] font-bold leading-[1.2] tracking-[-0.05em]">
                  {translation.title}
                </h1>
              )}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[#71807b]">
            <span>
              プロジェクト:{' '}
              <button
                className="font-semibold text-[#1d6b50] hover:underline"
                type="button"
                onClick={onOpenProject}
                disabled={isExportBusy}
              >
                {item.projectTitle}
              </button>
            </span>
            <span aria-hidden="true">·</span>
            <button
              className="inline-flex items-center gap-1 font-semibold text-[#1d6b50] hover:underline"
              type="button"
              onClick={() => setIsVideoOpen(true)}
              aria-label="元動画を再生"
            >
              <Film size={13} aria-hidden="true" /> {project.source.name.replace(/\.[^.]+$/, '')}
            </button>
            <time dateTime={item.createdAt}>（{formatArticleDate(item.createdAt)}作成）</time>
          </div>
          {article && slides.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <ArticleExportControls exporter={exporter} />
            </div>
          )}
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
                  <nav
                    className="mt-3 max-h-[50svh] space-y-1.5 overflow-y-auto overscroll-contain pr-1 lg:max-h-[calc(100svh-112px)]"
                    aria-label="記事の目次"
                  >
                    {sections.map((section) => (
                      <a
                        key={section.id}
                        className="block rounded-[7px] px-2 py-1.5 text-xs leading-5 text-[#71807b] hover:bg-[#edf5f0] hover:text-[#1d6b50]"
                        href={`#${section.id}`}
                      >
                        {outputLanguage === 'both' && <LanguageLabel language={sourceLanguage} />}
                        {(outputLanguage === 'both' ||
                          outputLanguage === sourceLanguage ||
                          !translatedSection(translation, section.id)) &&
                          section.heading}
                        {translation &&
                          translatedSection(translation, section.id) &&
                          (outputLanguage === 'both' ||
                            outputLanguage === translation.targetLanguage) && (
                            <div
                              className={
                                outputLanguage === 'both'
                                  ? 'mt-1 block border-t border-[#d8e1dc] pt-1 text-[15px] font-semibold text-[#53615b]'
                                  : ''
                              }
                            >
                              {outputLanguage === 'both' && (
                                <span className="mb-0.5 block border-0 p-0 text-[10px] font-semibold text-[#71807b]">
                                  {articleLanguageLabel(translation.targetLanguage)}
                                </span>
                              )}
                              {translatedSection(translation, section.id)?.heading}
                            </div>
                          )}
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
                <ArticleSummaryResult
                  summary={summary}
                  translation={translation}
                  outputLanguage={outputLanguage}
                  readOnly
                />
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
                    disabled={isExportBusy}
                  >
                    {getArticleActionLabel(status)} <ArrowRight size={14} />
                  </button>
                </div>
              ) : (
                <div className={summary ? 'mt-8' : undefined}>
                  {slides.map((slide, index) => {
                    const section = sections.find((candidate) =>
                      candidate.slideIds.includes(slide.id),
                    )
                    const translatedHeading = section
                      ? translatedSection(translation, section.id)
                      : undefined
                    const isSectionStart = section?.slideIds[0] === slide.id
                    return (
                      <div
                        key={slide.id}
                        className={isSectionStart && index > 0 ? 'mt-5' : undefined}
                      >
                        {isSectionStart && section && (
                          <div
                            id={section.id}
                            className="mb-[10px] flex min-h-[44px] items-center border-l-[10px] border-[#8bb6a2] bg-[#e8f2ec] px-3 py-[7px] scroll-mt-6"
                          >
                            <ArticleSectionHeading
                              section={section}
                              translatedHeading={translatedHeading}
                              translation={translation}
                              outputLanguage={outputLanguage}
                              sourceLanguage={sourceLanguage}
                            />
                          </div>
                        )}
                        <article className="py-2 pb-[18px]">
                          <div
                            className={`grid items-start gap-8 ${slide.image.representativeFramePath ? 'min-[601px]:grid-cols-2' : ''}`}
                          >
                            {slide.image.representativeFramePath && (
                              <figure className="relative m-0">
                                <button
                                  className="group relative block w-full cursor-zoom-in border-0 bg-transparent p-0 text-left"
                                  type="button"
                                  onClick={() =>
                                    setExpandedImage(
                                      convertFileSrc(slide.image.representativeFramePath!),
                                    )
                                  }
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
                                <figcaption className="absolute bottom-[10px] left-[10px] m-0 rounded-[5px] bg-[rgba(24,33,31,0.78)] px-[7px] py-1 font-mono text-[11px] leading-[1.3] text-[#f3faf6]">
                                  {formatTimestamp(sourceOffsetMs + slide.startMs)} —{' '}
                                  {formatTimestamp(sourceOffsetMs + slide.endMs)}
                                </figcaption>
                              </figure>
                            )}
                            <div className="content min-w-0 text-[#35443e]">
                              {!slide.image.representativeFramePath && (
                                <p className="mb-3 font-mono text-[11px] text-[#71807b]">
                                  {formatTimestamp(sourceOffsetMs + slide.startMs)} —{' '}
                                  {formatTimestamp(sourceOffsetMs + slide.endMs)}
                                </p>
                              )}
                              <ArticleSlideBody
                                sourceBody={slide.transcript?.articleBody ?? ''}
                                translatedBody={translation?.bodies[slide.id]}
                                translation={translation}
                                outputLanguage={outputLanguage}
                                sourceLanguage={sourceLanguage}
                              />
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
        <VideoPreviewDialog
          path={project.source.path}
          title={project.source.name}
          onClose={() => setIsVideoOpen(false)}
        />
      )}
    </main>
  )
}
