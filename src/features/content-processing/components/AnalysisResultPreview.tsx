import {
  ArrowRight,
  AudioLines,
  Check,
  FilePenLine,
  Image as ImageIcon,
  ScanText,
  Video,
  X,
} from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { SlideThumbnail } from '../../../components/SlideThumbnail'
import { SegmentVideoPlayer } from '../../../components/SegmentVideoPlayer'
import { formatTimestamp } from '../../../lib/time'
import { useVideoSourceUrl } from '../../../lib/media/useVideoSourceUrl'
import type { SlideData, SlideResultEdits } from '../../../types/project'

type AnalysisResultPreviewProps = {
  slides: SlideData[]
  onEdit: () => void
  onSaveSlideResultEdits: (slideId: string, edits: SlideResultEdits) => void | Promise<void>
  videoPath: string
  disabled?: boolean
}

type ResultPaneProps = {
  label: string
  icon: typeof ScanText
  value: string
  emptyLabel: string
  placeholder: string
  inputId: string
  editing: boolean
  disabled: boolean
  editable: boolean
  onChange: (value: string) => void
}

function ResultPane({
  label,
  icon: Icon,
  value,
  emptyLabel,
  placeholder,
  inputId,
  editing,
  disabled,
  editable,
  onChange,
}: ResultPaneProps) {
  const hasValue = Boolean(value.trim())
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || !editing) return

    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [editing, value])

  return (
    <section className="flex flex-col bg-[#fbfcfa]" aria-labelledby={`${inputId}-label`}>
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3 pb-1">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="shrink-0 text-[#1d6b50]" size={15} strokeWidth={1.8} />
          <h4
            id={`${inputId}-label`}
            className="truncate text-xs font-semibold tracking-[-0.01em] text-[#18211f]"
          >
            {label}
          </h4>
        </div>
        <span
          className={`shrink-0 font-mono text-[9px] uppercase tracking-[0.08em] ${hasValue ? 'text-[#71807b]' : 'text-[#b6533a]'}`}
        >
          {hasValue ? '入力済み' : '未入力'}
        </span>
      </div>

      {editing ? (
        <textarea
          ref={textareaRef}
          className="min-h-[220px] w-full resize-none overflow-hidden bg-[#f7faf7] px-4 pt-1 pb-4 text-sm leading-7 text-[#33413c] outline-none placeholder:text-[#9aa6a1] focus:bg-[#f1f8f3] focus:ring-2 focus:ring-inset focus:ring-[#1d6b50]/35 disabled:cursor-not-allowed disabled:bg-[#f1f3f1] disabled:text-[#9aa6a1]"
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled || !editable}
          aria-describedby={!editable ? `${inputId}-note` : undefined}
        />
      ) : (
        <div className="px-4 pt-1 pb-4">
          <p
            className={`whitespace-pre-wrap text-sm leading-7 ${hasValue ? 'text-[#33413c]' : 'text-[#9aa6a1]'}`}
          >
            {hasValue ? value : emptyLabel}
          </p>
        </div>
      )}

      {!editable && editing && (
        <p
          id={`${inputId}-note`}
          className="shrink-0 border-t border-[#d8e1dc] px-4 py-2 text-[10px] text-[#9aa6a1]"
        >
          この結果はまだありません
        </p>
      )}
    </section>
  )
}

function SegmentVideoPreview({ slide, videoSrc }: { slide: SlideData; videoSrc: string | null }) {
  return (
    <div className="mt-3">
      <SegmentVideoPlayer slide={slide} videoSrc={videoSrc} />
    </div>
  )
}

function SlidePane({ slide }: { slide: SlideData }) {
  return (
    <section
      className="flex min-h-0 flex-col bg-[#fbfcfa]"
      aria-labelledby={`slide-${slide.id}-label`}
    >
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-1">
        <ImageIcon className="text-[#1d6b50]" size={15} strokeWidth={1.8} />
        <h4 id={`slide-${slide.id}-label`} className="text-xs font-semibold text-[#18211f]">
          スライド画像
        </h4>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 pt-1 pb-5">
        <div className="w-full max-w-[600px]">
          <SlideThumbnail slide={slide} />
        </div>
      </div>
    </section>
  )
}

function VideoPane({
  slide,
  videoSrc,
  active,
  onToggle,
}: {
  slide: SlideData
  videoSrc: string | null
  active: boolean
  onToggle: () => void
}) {
  return (
    <section
      className="flex min-h-0 flex-col bg-[#fbfcfa]"
      aria-labelledby={`video-${slide.id}-label`}
    >
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-1">
        <Video className="text-[#1d6b50]" size={15} strokeWidth={1.8} />
        <h4 id={`video-${slide.id}-label`} className="text-xs font-semibold text-[#18211f]">
          区間動画
        </h4>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 pt-1 pb-5">
        <div className="w-full max-w-[600px]">
          {active ? (
            <>
              <SegmentVideoPreview slide={slide} videoSrc={videoSrc} />
              <button
                className="mt-3 text-xs font-semibold text-[#71807b] hover:text-[#1d6b50]"
                type="button"
                onClick={onToggle}
              >
                動画を閉じる
              </button>
            </>
          ) : (
            <button
              className="rounded-[9px] border border-[#b7cbc0] bg-[#f7faf7] px-4 py-3 text-xs font-semibold text-[#1d6b50] transition hover:border-[#1d6b50] hover:bg-[#e2eee8]"
              type="button"
              onClick={onToggle}
            >
              区間動画を読み込む
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

function initialEdits(slide: SlideData): SlideResultEdits {
  return {
    ocrText: slide.ocr?.rawText ?? '',
    transcriptRaw: slide.transcript?.raw ?? '',
    articleBody: slide.transcript?.articleBody ?? '',
  }
}

export function AnalysisResultPreview({
  slides,
  onEdit,
  onSaveSlideResultEdits,
  videoPath,
  disabled = false,
}: AnalysisResultPreviewProps) {
  const hasAnyResult = slides.some((slide) => slide.ocr || slide.transcript)
  const videoSource = useVideoSourceUrl(videoPath)
  const [activeVideoSlideId, setActiveVideoSlideId] = useState<string | null>(null)
  const [editingSlideId, setEditingSlideId] = useState<string | null>(null)
  const [draft, setDraft] = useState<SlideResultEdits | null>(null)
  const [savingSlideId, setSavingSlideId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const startEditing = (slide: SlideData) => {
    setEditingSlideId(slide.id)
    setDraft(initialEdits(slide))
    setSaveError(null)
  }

  const cancelEditing = () => {
    setEditingSlideId(null)
    setDraft(null)
    setSaveError(null)
  }

  const updateDraft = (key: keyof SlideResultEdits, value: string) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
    setSaveError(null)
  }

  const saveEdits = async (slideId: string) => {
    if (!draft) return

    setSavingSlideId(slideId)
    setSaveError(null)
    try {
      await onSaveSlideResultEdits(slideId, draft)
      setEditingSlideId(null)
      setDraft(null)
    } catch (error) {
      console.error(error)
      setSaveError(error instanceof Error ? error.message : '解析結果の保存に失敗しました。')
    } finally {
      setSavingSlideId(null)
    }
  }

  return (
    <section className="mt-8 pt-4" aria-labelledby="analysis-result-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="analysis-result-heading" className="text-[21px] font-bold tracking-[-0.05em]">
            2. 解析結果の確認
          </h2>
          <p className="mt-1 text-xs text-[#71807b]">
            Slideごとに結果を確認し、必要なテキストだけ修正できます。
          </p>
        </div>
      </div>

      {hasAnyResult ? (
        <div className="mt-5 space-y-5">
          {slides.map((slide) => {
            const isEditing = editingSlideId === slide.id
            const isAnotherSlideEditing = editingSlideId !== null && !isEditing
            const isSaving = savingSlideId === slide.id
            const values = isEditing && draft ? draft : initialEdits(slide)

            return (
              <article
                className="overflow-hidden border bg-[#fbfcfa]"
                key={slide.id}
                style={{ borderColor: '#d8e1dc', borderRadius: 16 }}
              >
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d8e1dc] px-4 py-3.5 md:px-5">
                  <div className="flex min-w-0 items-baseline gap-x-3 gap-y-1">
                    <h3 className="text-sm font-semibold text-[#18211f]">
                      Slide {String(slide.index + 1).padStart(2, '0')}
                    </h3>
                    <span className="font-mono text-[10px] text-[#1d6b50]">
                      {formatTimestamp(slide.startMs)} — {formatTimestamp(slide.endMs)}
                    </span>
                    {isEditing && (
                      <span className="text-[10px] font-semibold text-[#9a7a35]">編集中</span>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      {saveError && (
                        <span className="mr-1 text-[10px] text-[#b6533a]">保存失敗</span>
                      )}
                      <button
                        className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#d8e1dc] px-2.5 py-2 text-[11px] font-semibold text-[#71807b] transition hover:border-[#9aa6a1] hover:bg-[#f1f3f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-50"
                        type="button"
                        onClick={cancelEditing}
                        disabled={isSaving}
                      >
                        <X size={13} />
                        キャンセル
                      </button>
                      <button
                        className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#1d6b50] px-2.5 py-2 text-[11px] font-semibold text-[#f3faf6] transition hover:bg-[#174d3c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-50"
                        type="button"
                        onClick={() => void saveEdits(slide.id)}
                        disabled={isSaving || disabled}
                      >
                        <Check size={13} />
                        {isSaving ? '保存中…' : '保存'}
                      </button>
                    </div>
                  ) : (
                    <button
                      className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#b7cbc0] bg-[#f7faf7] px-2.5 py-2 text-[11px] font-semibold text-[#1d6b50] transition hover:border-[#1d6b50] hover:bg-[#e2eee8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-45"
                      type="button"
                      onClick={() => startEditing(slide)}
                      disabled={disabled || isAnotherSlideEditing}
                      title={
                        isAnotherSlideEditing
                          ? '現在編集中のSlideを先に保存してください'
                          : undefined
                      }
                    >
                      <FilePenLine size={13} />
                      編集
                    </button>
                  )}
                </header>

                {isEditing && (
                  <p className="px-4 py-2 text-[10px] text-[#71807b] md:px-5">
                    OCR・文字起こし結果を修正できます。変更した元データは本文を再生成すると反映されます。
                  </p>
                )}

                <div className="grid min-h-[760px] min-w-0 grid-cols-1 md:min-h-[640px] md:grid-cols-2">
                  <div className="border-b border-[#d8e1dc] md:col-start-1 md:row-start-1 md:border-b-2 md:border-b-[#d8e1dc] md:border-r-2 md:border-r-[#d8e1dc]">
                    <SlidePane slide={slide} />
                  </div>
                  <div className="border-b border-[#d8e1dc] md:col-start-2 md:row-start-1 md:border-b-2 md:border-b-[#d8e1dc]">
                    <ResultPane
                      label="OCR結果"
                      icon={ScanText}
                      value={values.ocrText}
                      emptyLabel="OCR結果はありません。"
                      placeholder="OCR結果を入力"
                      inputId={`slide-${slide.id}-ocr`}
                      editing={isEditing}
                      disabled={isSaving || disabled}
                      editable={Boolean(slide.ocr)}
                      onChange={(value) => updateDraft('ocrText', value)}
                    />
                  </div>
                  <div className="border-b border-[#d8e1dc] md:col-start-1 md:row-start-2 md:border-r-2 md:border-r-[#d8e1dc]">
                    <VideoPane
                      slide={slide}
                      videoSrc={videoSource.src}
                      active={activeVideoSlideId === slide.id}
                      onToggle={() =>
                        setActiveVideoSlideId((current) => (current === slide.id ? null : slide.id))
                      }
                    />
                  </div>
                  <div className="md:col-start-2 md:row-start-2">
                    <ResultPane
                      label="文字起こし結果"
                      icon={AudioLines}
                      value={values.transcriptRaw}
                      emptyLabel="この区間に発話はありません。"
                      placeholder="文字起こし結果を入力"
                      inputId={`slide-${slide.id}-transcript`}
                      editing={isEditing}
                      disabled={isSaving || disabled}
                      editable={Boolean(slide.transcript)}
                      onChange={(value) => updateDraft('transcriptRaw', value)}
                    />
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="mt-5 border-y border-dashed border-[#b7cbc0] px-4 py-8 text-center text-xs text-[#71807b]">
          解析を実行すると、ここにSlideごとの結果が表示されます。
        </div>
      )}

      {hasAnyResult && (
        <div className="mt-7 flex flex-wrap items-center justify-end gap-4 border-t border-[#d8e1dc] pt-5">
          <button
            className="inline-flex items-center gap-2 rounded-[9px] bg-[#1d6b50] px-4 py-3 text-xs font-semibold text-[#f3faf6] shadow-[0_7px_16px_rgba(29,107,80,0.17)] transition hover:bg-[#174d3c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
            type="button"
            onClick={onEdit}
            disabled={disabled || editingSlideId !== null}
          >
            記事の生成・編集へ
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </section>
  )
}
