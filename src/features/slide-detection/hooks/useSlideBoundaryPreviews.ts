import { useCallback, useEffect, useRef, useState } from 'react'
import type { MediaProject, SlideData } from '../../../types/project'
import { extractRepresentativeFrameForSlide } from '../detection'
import {
  getSlidePreviewAssetPath,
  removeSlidePreviewAssets,
} from '../../../lib/storage/projectAssets'
import { removeAbsolutePath } from '../../../lib/tauri/filesystem'
import { requireActiveArticleId } from '../../../types/project'
import { slideRangeKey } from '../utils'

const PREVIEW_EXTRACTION_DELAY_MS = 180
const MAX_CONCURRENT_PREVIEWS = 2

async function runPreviewQueue(
  slides: SlideData[],
  prepare: (slide: SlideData) => Promise<void>,
  signal: AbortSignal,
) {
  let nextIndex = 0
  const worker = async () => {
    while (!signal.aborted && nextIndex < slides.length) {
      const slide = slides[nextIndex]
      nextIndex += 1
      await prepare(slide)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_PREVIEWS, slides.length) }, worker),
  )
}

export function useSlideBoundaryPreviews(
  project: MediaProject,
  slides: SlideData[],
  enabled: boolean,
) {
  const articleId = requireActiveArticleId(project)
  const [previewId, setPreviewId] = useState(() => crypto.randomUUID())
  const previewIdRef = useRef(previewId)
  const previewPathsRef = useRef(new Map<string, string>())
  const activeControllerRef = useRef<AbortController | null>(null)
  const [pathsByRange, setPathsByRange] = useState<Record<string, string>>({})
  const [preparingRanges, setPreparingRanges] = useState<Record<string, boolean>>({})

  const discardPreviews = useCallback(async () => {
    const discardedPreviewId = previewIdRef.current
    const nextPreviewId = crypto.randomUUID()
    previewIdRef.current = nextPreviewId
    activeControllerRef.current?.abort()
    activeControllerRef.current = null
    previewPathsRef.current.clear()
    setPathsByRange({})
    setPreparingRanges({})
    setPreviewId(nextPreviewId)
    await removeSlidePreviewAssets(project.id, articleId, discardedPreviewId)
  }, [articleId, project.id])

  useEffect(() => {
    if (!enabled) return

    const controller = new AbortController()
    activeControllerRef.current = controller
    let disposed = false
    const slidesNeedingPreview = slides.filter((slide) => !slide.image.representativeFramePath)
    const desiredRanges = new Set(slidesNeedingPreview.map(slideRangeKey))

    for (const [rangeKey, path] of previewPathsRef.current) {
      if (desiredRanges.has(rangeKey)) continue
      previewPathsRef.current.delete(rangeKey)
      void removeAbsolutePath(path).catch((cleanupError) => {
        console.warn('不要になった一時画像を削除できませんでした。', cleanupError)
      })
    }

    const pendingSlides = slidesNeedingPreview.filter(
      (slide) => !previewPathsRef.current.has(slideRangeKey(slide)),
    )
    const nextPathsByRange = Object.fromEntries(previewPathsRef.current)
    const nextPreparingRanges = Object.fromEntries(
      pendingSlides.map((slide) => [slideRangeKey(slide), true]),
    )
    queueMicrotask(() => {
      if (disposed || controller.signal.aborted) return
      setPathsByRange(nextPathsByRange)
      setPreparingRanges(nextPreparingRanges)
    })

    const preparePreview = async (slide: SlideData) => {
      const rangeKey = slideRangeKey(slide)
      let outputPath: string | undefined
      try {
        await new Promise((resolve) => setTimeout(resolve, PREVIEW_EXTRACTION_DELAY_MS))
        if (controller.signal.aborted) return

        outputPath = await getSlidePreviewAssetPath(
          project.id,
          articleId,
          previewId,
          `${rangeKey}-${crypto.randomUUID()}`,
        )
        if (controller.signal.aborted) return
        await extractRepresentativeFrameForSlide(project, slide, outputPath, controller.signal)
        if (controller.signal.aborted) return

        previewPathsRef.current.set(rangeKey, outputPath)
        setPathsByRange(Object.fromEntries(previewPathsRef.current))
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(`Slide ${slide.index + 1}のプレビュー画像を作成できませんでした`, error)
        }
      } finally {
        if (outputPath && previewPathsRef.current.get(rangeKey) !== outputPath) {
          if (previewIdRef.current === previewId) {
            await removeAbsolutePath(outputPath).catch((cleanupError) => {
              console.warn('未使用の一時画像を削除できませんでした。', cleanupError)
            })
          } else {
            await removeSlidePreviewAssets(project.id, articleId, previewId).catch(
              (cleanupError) => {
                console.warn('古い一時画像を削除できませんでした。', cleanupError)
              },
            )
          }
        }
        if (!disposed && !controller.signal.aborted) {
          setPreparingRanges((current) => ({ ...current, [rangeKey]: false }))
        }
      }
    }

    void runPreviewQueue(pendingSlides, preparePreview, controller.signal)
    return () => {
      disposed = true
      controller.abort()
      if (activeControllerRef.current === controller) activeControllerRef.current = null
    }
  }, [articleId, enabled, previewId, project, slides])

  useEffect(() => {
    return () => {
      activeControllerRef.current?.abort()
      void removeSlidePreviewAssets(project.id, articleId, previewIdRef.current).catch(
        (cleanupError) => {
          console.warn('画面を閉じた後の一時画像を削除できませんでした。', cleanupError)
        },
      )
    }
  }, [articleId, project.id])

  return { pathsByRange, preparingRanges, discardPreviews }
}
