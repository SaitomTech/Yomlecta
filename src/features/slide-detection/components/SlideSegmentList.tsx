import { Trash2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { SlideThumbnail } from '../../../components/SlideThumbnail'
import { formatTimestamp } from '../../../lib/time'
import type { SlideBoundary, SlideData } from '../../../types/project'
import { slideRangeKey } from '../utils'

type SlideSegmentListProps = {
  boundaries: SlideBoundary[]
  slides: SlideData[]
  followPlayback: boolean
  activeSlideIndex: number
  onSelectSlide: (index: number) => void
  onRemoveBoundary: (boundaryId: string) => void
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
  disabled = false,
  preparingRanges = {},
}: SlideSegmentListProps) {
  const slideRefs = useRef<Array<HTMLDivElement | null>>([])
  const listRef = useRef<HTMLDivElement | null>(null)

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
  }, [activeSlideIndex, followPlayback])

  return (
    <section className="min-w-0 lg:sticky lg:top-6" aria-label="スライド区間の一覧">
      {boundaries.length === 0 && (
        <p className="mb-3 text-xs text-[#71807b]">
          境界はまだありません。タイムラインをダブルクリックして追加できます。
        </p>
      )}

      <div
        ref={listRef}
        className="max-h-[600px] overflow-y-auto overscroll-contain pr-1 lg:max-h-[min(720px,calc(100svh-260px))]"
      >
        <div className="space-y-3">
          {slides.map((slide, index) => {
            const boundary = index > 0 ? boundaries[index - 1] : undefined
            const slideNumber = String(slide.index + 1).padStart(2, '0')

            return (
              <div
                ref={(element) => {
                  slideRefs.current[index] = element
                }}
                className={`overflow-hidden rounded-[12px] border transition-colors ${index === activeSlideIndex ? 'border-[#b7cbc0] bg-[#edf4ef] shadow-[0_8px_24px_rgba(22,54,42,0.08)]' : 'border-[#d8e1dc] bg-[#fbfcfa]'}`}
                key={`${slide.id}-${slide.image.representativeFramePath ?? 'no-image'}`}
              >
                <button
                  className="block w-full text-left transition-colors hover:bg-[#f1f6f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1d6b50]/30"
                  type="button"
                  onClick={() => onSelectSlide(index)}
                  aria-label={`Slide ${slideNumber}を動画で確認`}
                  aria-pressed={index === activeSlideIndex}
                >
                  <SlideThumbnail
                    slide={slide}
                    isPreparing={Boolean(preparingRanges[slideRangeKey(slide)])}
                  />

                  <div className="px-3 pb-3 pt-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-xs font-semibold text-[#18211f]">
                        Slide {slideNumber}
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

                {boundary && (
                  <div className="flex justify-end border-t border-[#d8e1dc] px-3 py-1.5">
                    <button
                      className="rounded p-1 text-[#9aa6a1] transition hover:bg-[#fff0ec] hover:text-[#b6533a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b6533a]/30"
                      type="button"
                      onClick={() => onRemoveBoundary(boundary.id)}
                      disabled={disabled}
                      aria-label={`${formatTimestamp(boundary.timestampMs)}の境界を削除`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
