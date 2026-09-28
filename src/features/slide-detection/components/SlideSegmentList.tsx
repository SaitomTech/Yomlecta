import { ChevronDown, ListFilter, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SlideThumbnail } from '../../../components/SlideThumbnail'
import { formatTimestamp } from '../../../lib/time'
import {
  effectiveVisualKind,
  type SlideBoundary,
  type SlideData,
  type VisualSegmentKind,
} from '../../../types/project'
import { slideRangeKey, visualKindAppearance } from '../utils'

const visualKinds = ['slide', 'non-slide', 'unknown'] as const

type SlideSegmentListProps = {
  boundaries: SlideBoundary[]
  slides: SlideData[]
  followPlayback: boolean
  activeSlideIndex: number
  onSelectSlide: (index: number) => void
  onRemoveBoundary: (boundaryId: string) => void
  onKindChange: (segmentId: string, kind: VisualSegmentKind) => void
  disabled?: boolean
  preparingRanges?: Record<string, boolean>
}

export function SlideSegmentList({
  boundaries,
  slides,
  followPlayback,
  activeSlideIndex,
  onSelectSlide,
  onRemoveBoundary,
  onKindChange,
  disabled = false,
  preparingRanges = {},
}: SlideSegmentListProps) {
  const slideRefs = useRef<Array<HTMLDivElement | null>>([])
  const listRef = useRef<HTMLDivElement | null>(null)
  const filterRef = useRef<HTMLDetailsElement | null>(null)
  const [visibleKinds, setVisibleKinds] = useState<Set<VisualSegmentKind>>(
    () => new Set(visualKinds),
  )
  const visibleSlides = slides.flatMap((slide, index) =>
    visibleKinds.has(effectiveVisualKind(slide)) ? [{ slide, index }] : [],
  )
  const selectedKindLabel =
    visibleKinds.size === visualKinds.length
      ? 'すべて'
      : visualKinds
          .filter((kind) => visibleKinds.has(kind))
          .map((kind) => visualKindAppearance[kind].label)
          .join('・')

  const toggleKind = (kind: VisualSegmentKind) => {
    setVisibleKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  useEffect(() => {
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const filter = filterRef.current
      if (filter && event.target instanceof Node && !filter.contains(event.target)) {
        filter.open = false
      }
    }

    document.addEventListener('pointerdown', handleOutsidePointerDown)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown)
  }, [])

  useEffect(() => {
    if (!followPlayback || activeSlideIndex < 0) return
    const list = listRef.current
    const slide = slideRefs.current[activeSlideIndex]
    if (!list || !slide) return

    const listRect = list.getBoundingClientRect()
    const slideRect = slide.getBoundingClientRect()
    if (slideRect.top < listRect.top) {
      list.scrollTo({
        top: list.scrollTop + slideRect.top - listRect.top,
        behavior: 'smooth',
      })
    } else if (slideRect.bottom > listRect.bottom) {
      list.scrollTo({
        top: list.scrollTop + slideRect.bottom - listRect.bottom,
        behavior: 'smooth',
      })
    }
  }, [activeSlideIndex, followPlayback, visibleKinds])

  return (
    <section className="min-w-0 lg:sticky lg:top-6" aria-label="スライド区間の一覧">
      {boundaries.length === 0 && (
        <p className="mb-3 text-xs text-[#71807b]">
          境界はまだありません。タイムラインをダブルクリックして追加できます。
        </p>
      )}

      <details ref={filterRef} className="group relative mb-3">
        <summary className="flex w-full list-none cursor-pointer items-center gap-2 rounded-[9px] border border-[#c8d6cf] bg-white px-3 py-2 text-left text-xs text-[#18211f] shadow-sm transition-colors hover:border-[#9bb8a8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 [&::-webkit-details-marker]:hidden">
          <ListFilter size={14} className="shrink-0 text-[#71807b]" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[#52615b]">
            {selectedKindLabel || '選択なし'}
          </span>
          <span className="shrink-0 text-[10px] text-[#71807b]">
            {visibleSlides.length}/{slides.length}
          </span>
          <ChevronDown
            size={14}
            className="shrink-0 text-[#71807b] transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="absolute inset-x-0 top-full z-30 mt-1 rounded-[10px] border border-[#c8d6cf] bg-white p-2 shadow-[0_10px_28px_rgba(22,54,42,0.16)]">
          <div className="px-2 pb-1.5 text-[10px] font-semibold text-[#71807b]">表示する区間</div>
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs font-semibold text-[#34433d] transition-colors hover:bg-[#f4f7f4]">
            <input
              className="size-3.5 accent-[#1d6b50]"
              type="checkbox"
              checked={visibleKinds.size === visualKinds.length}
              onChange={(event) =>
                setVisibleKinds(event.currentTarget.checked ? new Set(visualKinds) : new Set())
              }
            />
            <span className="flex-1">すべて</span>
            <span className="text-[10px] font-normal text-[#71807b]">{slides.length}</span>
          </label>
          <div className="my-1 border-t border-[#e5ebe7]" />
          {visualKinds.map((kind) => {
            const appearance = visualKindAppearance[kind]
            const count = slides.filter((slide) => effectiveVisualKind(slide) === kind).length
            const isVisible = visibleKinds.has(kind)

            return (
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs transition-colors hover:bg-[#f4f7f4] ${isVisible ? 'font-semibold text-[#34433d]' : 'text-[#71807b]'}`}
                key={kind}
              >
                <input
                  className="size-3.5 accent-[#1d6b50]"
                  type="checkbox"
                  checked={isVisible}
                  onChange={() => toggleKind(kind)}
                />
                <span className={`size-2.5 rounded-sm ${appearance.dot}`} aria-hidden="true" />
                <span className="flex-1">{appearance.label}</span>
                <span className="text-[10px] font-normal text-[#71807b]">{count}</span>
              </label>
            )
          })}
        </div>
      </details>

      <div
        ref={listRef}
        className="max-h-[600px] overflow-y-auto overscroll-contain pr-1 lg:max-h-[min(720px,calc(100svh-260px))]"
      >
        <div className="space-y-3">
          {visibleSlides.map(({ slide, index }) => {
            const boundary = index > 0 ? boundaries[index - 1] : undefined
            const slideNumber = String(slide.index + 1).padStart(2, '0')
            const effectiveKind = effectiveVisualKind(slide)
            const appearance = visualKindAppearance[effectiveKind]

            return (
              <div
                ref={(element) => {
                  slideRefs.current[index] = element
                }}
                className={`overflow-hidden rounded-[12px] border-2 transition-[box-shadow,filter] ${appearance.card} ${index === activeSlideIndex ? 'ring-2 ring-[#18211f]/15 shadow-[0_8px_24px_rgba(22,54,42,0.12)]' : ''}`}
                key={`${slide.id}-${slide.image.representativeFramePath ?? 'no-image'}`}
              >
                <button
                  className="block w-full text-left transition-colors hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1d6b50]/30"
                  type="button"
                  onClick={() => onSelectSlide(index)}
                  aria-label={`区間 ${slideNumber}、${appearance.label}を動画で確認`}
                  aria-pressed={index === activeSlideIndex}
                >
                  <SlideThumbnail
                    slide={slide}
                    isPreparing={Boolean(preparingRanges[slideRangeKey(slide)])}
                  />

                  <div className="px-3 pb-3 pt-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-xs font-semibold text-[#18211f]">
                        区間 {slideNumber}
                      </span>
                      <span className="font-mono text-[10px] text-[#1d6b50]">
                        {formatTimestamp(slide.startMs)} — {formatTimestamp(slide.endMs)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.06em] text-[#9aa6a1]">
                      <span className={boundary ? 'text-[#1d6b50]' : undefined}>
                        {boundary?.source ?? 'start'}
                      </span>
                      {boundary?.source === 'auto' && (
                        <>
                          <span>·</span>
                          <span className="normal-case tracking-normal">
                            distance {boundary.distance}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </button>

                <div className="flex items-center justify-between gap-2 border-t border-[#d8e1dc] px-3 py-1.5">
                  <label className="flex items-center gap-2 text-[10px] font-semibold text-[#71807b]">
                    種別
                    <select
                      className="rounded border border-[#c8d6cf] bg-white px-2 py-1 text-[11px] text-[#18211f]"
                      value={effectiveKind}
                      disabled={disabled}
                      onChange={(event) =>
                        onKindChange(slide.id, event.currentTarget.value as VisualSegmentKind)
                      }
                    >
                      <option value="slide">スライド</option>
                      <option value="non-slide">非スライド</option>
                      <option value="unknown">要確認</option>
                    </select>
                  </label>
                  {boundary && (
                    <button
                      className="rounded p-1 text-[#9aa6a1] transition hover:bg-[#fff0ec] hover:text-[#b6533a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b6533a]/30"
                      type="button"
                      onClick={() => onRemoveBoundary(boundary.id)}
                      disabled={disabled}
                      aria-label={`${formatTimestamp(boundary.timestampMs)}の境界を削除`}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {visibleSlides.length === 0 && (
            <p className="rounded-[10px] border border-dashed border-[#d8e1dc] px-3 py-5 text-center text-xs text-[#71807b]">
              表示する区間がありません。判定を選択してください。
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
