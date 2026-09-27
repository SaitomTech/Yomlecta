import { Save, X } from 'lucide-react'
import { SlideThumbnail } from '../../../components/SlideThumbnail'
import { SegmentVideoPlayer } from '../../../components/SegmentVideoPlayer'
import type { ArticleOutputLanguage, SlideData } from '../../../types/project'
import { articleLanguageLabel, resolveArticleLanguageVisibility } from '../articleLanguage'

type ArticleSectionEditorProps = {
  slide: SlideData
  videoSrc: string | null
  videoOpen: boolean
  body: string
  sourceLanguage: string
  outputLanguage: ArticleOutputLanguage
  translationBody?: string
  translationLanguage?: string
  editing: boolean
  editDisabled?: boolean
  saving?: boolean
  canSave?: boolean
  error?: string | null
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
  onBodyChange: (body: string) => void
  onVideoToggle: (open: boolean) => void
}

function SegmentVideoPreview({ slide, videoSrc }: { slide: SlideData; videoSrc: string | null }) {
  return <SegmentVideoPlayer slide={slide} videoSrc={videoSrc} className="w-full max-w-[420px]" />
}

function SourceLanguageLabel({ language }: { language: string }) {
  return (
    <p className="mb-1 px-3 text-[10px] font-semibold text-[#71807b]">
      {articleLanguageLabel(language)}
    </p>
  )
}

function SourceBodyEditor({
  slideId,
  body,
  saving,
  canSave,
  error,
  showLanguageLabel,
  sourceLanguage,
  onCancel,
  onSave,
  onBodyChange,
}: {
  slideId: string
  body: string
  saving: boolean
  canSave: boolean
  error: string | null
  showLanguageLabel: boolean
  sourceLanguage: string
  onCancel: () => void
  onSave: () => void
  onBodyChange: (body: string) => void
}) {
  return (
    <div>
      {showLanguageLabel && <SourceLanguageLabel language={sourceLanguage} />}
      <textarea
        className="min-h-44 w-full resize-y rounded-[8px] border border-[#b7cbc0] bg-white px-3 py-3 text-sm leading-7 text-[#33413c] outline-none transition placeholder:text-[#9aa6a1] focus:border-[#1d6b50] focus:ring-2 focus:ring-[#1d6b50]/15 disabled:cursor-not-allowed disabled:bg-[#f0f5f1]"
        id={`article-body-${slideId}`}
        value={body}
        disabled={saving}
        onChange={(event) => onBodyChange(event.target.value)}
        placeholder="このSlideの記事本文を入力"
        aria-label="記事本文"
      />
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#d8e1dc] px-2.5 py-2 text-[11px] font-semibold text-[#71807b] transition hover:border-[#9aa6a1] hover:bg-[#f1f3f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onClick={onCancel}
          disabled={saving}
        >
          <X size={13} />
          キャンセル
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#1d6b50] px-2.5 py-2 text-[11px] font-semibold text-[#f3faf6] transition hover:bg-[#174d3c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onClick={onSave}
          disabled={!canSave || saving}
        >
          <Save size={13} />
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-[#b6533a]">{error}</p>}
    </div>
  )
}

function SourceBodyDisplay({
  slide,
  body,
  language,
  showLanguageLabel,
  editDisabled,
  onEdit,
}: {
  slide: SlideData
  body: string
  language: string
  showLanguageLabel: boolean
  editDisabled: boolean
  onEdit: () => void
}) {
  return (
    <div>
      {showLanguageLabel && <SourceLanguageLabel language={language} />}
      <button
        className={`block min-w-0 rounded-[8px] px-3 py-2 text-left transition hover:bg-[#edf4ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/25 disabled:cursor-not-allowed disabled:opacity-60 ${body.trim() ? 'text-[#33413c]' : 'text-[#9aa6a1]'}`}
        type="button"
        onClick={onEdit}
        disabled={editDisabled}
        aria-label={`記事本文を編集（Slide ${String(slide.index + 1).padStart(2, '0')}）`}
      >
        <p className="whitespace-pre-wrap text-[15px] leading-8">
          {body.trim() || '本文はまだ生成されていません。'}
        </p>
      </button>
    </div>
  )
}

function TranslatedBody({
  body,
  language,
  showLanguageLabel,
  divider,
}: {
  body: string
  language: string
  showLanguageLabel: boolean
  divider: boolean
}) {
  return (
    <div className={divider ? 'mt-4 border-t border-[#e0e8e3] pt-3' : 'px-3 py-2'}>
      {showLanguageLabel && (
        <p className="mb-1 text-[10px] font-semibold text-[#71807b]">
          {articleLanguageLabel(language)}
        </p>
      )}
      <p className="whitespace-pre-wrap text-[15px] leading-8 text-[#33413c]">
        {body || '訳文がありません。'}
      </p>
    </div>
  )
}

function OriginalData({
  slide,
  videoSrc,
  videoOpen,
  onVideoToggle,
}: {
  slide: SlideData
  videoSrc: string | null
  videoOpen: boolean
  onVideoToggle: (open: boolean) => void
}) {
  const rawTranscript = slide.transcript?.raw.trim() || 'この区間に発話はありません。'
  const ocrText = slide.ocr?.rawText.trim() || 'OCR結果はありません。'
  return (
    <details
      className="mt-5 border-t border-[#e0e8e3] pt-3"
      open={videoOpen}
      onToggle={(event) => onVideoToggle(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-xs font-semibold text-[#71807b] outline-none marker:text-[#1d6b50] focus-visible:text-[#1d6b50]">
        元データを確認
      </summary>
      <div className="mt-4 grid gap-4 text-xs leading-6 text-[#53615b] md:grid-cols-2">
        <div className="md:col-span-2">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#71807b]">
            区間動画
          </p>
          {videoOpen && <SegmentVideoPreview slide={slide} videoSrc={videoSrc} />}
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#71807b]">
            文字起こし結果
          </p>
          <p className="mt-1 whitespace-pre-wrap">{rawTranscript}</p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#71807b]">
            OCR結果
          </p>
          <p className="mt-1 whitespace-pre-wrap">{ocrText}</p>
        </div>
      </div>
    </details>
  )
}

export function ArticleSectionEditor({
  slide,
  videoSrc,
  videoOpen,
  body,
  sourceLanguage,
  outputLanguage,
  translationBody,
  translationLanguage,
  editing,
  editDisabled = false,
  saving = false,
  canSave = false,
  error = null,
  onEdit,
  onCancel,
  onSave,
  onBodyChange,
  onVideoToggle,
}: ArticleSectionEditorProps) {
  const visibility = resolveArticleLanguageVisibility({
    outputLanguage,
    sourceLanguage,
    targetLanguage: translationLanguage,
    hasTranslation: translationBody !== undefined,
  })

  return (
    <article className="overflow-hidden rounded-[12px] border border-[#d8e1dc] bg-[#fbfcfa]">
      <div className="p-4 md:p-5">
        <div
          className={`grid gap-5 ${slide.image.representativeFramePath ? 'md:grid-cols-[minmax(220px,0.9fr)_minmax(0,1.4fr)]' : ''}`}
        >
          {slide.image.representativeFramePath && <SlideThumbnail slide={slide} />}
          <div className="min-w-0">
            {visibility.showSource && editing && (
              <SourceBodyEditor
                slideId={slide.id}
                body={body}
                saving={saving}
                canSave={canSave}
                error={error}
                showLanguageLabel={visibility.showSourceLanguageLabel}
                sourceLanguage={sourceLanguage}
                onCancel={onCancel}
                onSave={onSave}
                onBodyChange={onBodyChange}
              />
            )}
            {visibility.showSource && !editing && (
              <SourceBodyDisplay
                slide={slide}
                body={body}
                language={sourceLanguage}
                showLanguageLabel={visibility.showSourceLanguageLabel}
                editDisabled={editDisabled}
                onEdit={onEdit}
              />
            )}
            {visibility.showTranslation && translationLanguage && translationBody !== undefined && (
              <TranslatedBody
                body={translationBody}
                language={translationLanguage}
                showLanguageLabel={visibility.showTargetLanguageLabel}
                divider={visibility.showTranslationDivider}
              />
            )}
            {!visibility.showSource && !visibility.showTranslation && (
              <p className="px-3 py-2 text-xs text-[#9aa6a1]">
                選択した言語の本文がありません。先に翻訳を生成してください。
              </p>
            )}
          </div>
        </div>
        <OriginalData
          slide={slide}
          videoSrc={videoSrc}
          videoOpen={videoOpen}
          onVideoToggle={onVideoToggle}
        />
      </div>
    </article>
  )
}
