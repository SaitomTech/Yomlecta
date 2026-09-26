import {
  extractRepresentativeFrame,
  sampleVideoFrames,
  type FrameHash,
} from '../../lib/media/ffmpeg'
import { hammingDistance } from '../../lib/media/dhash'
import {
  getSlideRunAssetPath,
  pruneSlideAssetRuns,
  removeSlideRunAssets,
} from '../../lib/storage/projectAssets'
import {
  requireActiveArticleId,
  type MediaProject,
  type SlideBoundary,
  type SlideData,
} from '../../types/project'
import { getActiveArticleSourceContext } from '../../lib/project/articleSource'
import type {
  PendingSlideDetectionOutput,
  SlideDetectionOutput,
  SlideDetectionStage,
} from './types'

export const MINIMUM_BOUNDARY_GAP_MS = 1500

function frameDistance(first: FrameHash, second: FrameHash) {
  const hashDistance = hammingDistance(first.hash, second.hash)
  const lumaDistance =
    first.averageLuma === undefined || second.averageLuma === undefined
      ? 0
      : Math.round(Math.abs(first.averageLuma - second.averageLuma) / 8)
  return hashDistance + lumaDistance
}

type DetectBoundariesInput = {
  frames: FrameHash[]
  threshold: number
  minimumGapMs?: number
}

export function detectSlideBoundaries({
  frames,
  threshold,
  minimumGapMs = MINIMUM_BOUNDARY_GAP_MS,
}: DetectBoundariesInput): SlideBoundary[] {
  const boundaries: SlideBoundary[] = []
  const settleThreshold = Math.max(2, Math.floor(threshold / 2))
  let previousBoundaryMs = -minimumGapMs

  for (let index = 1; index < frames.length - 1; index += 1) {
    const previous = frames[index - 1]
    const current = frames[index]
    const next = frames[index + 1]
    const distance = frameDistance(previous, current)
    const settled = frameDistance(current, next) <= settleThreshold

    if (distance < threshold || !settled || current.timestampMs - previousBoundaryMs < minimumGapMs)
      continue

    boundaries.push({
      id: `boundary-${current.timestampMs}`,
      timestampMs: current.timestampMs,
      distance,
      source: 'auto',
    })
    previousBoundaryMs = current.timestampMs
  }

  return boundaries
}

export function buildSlideData(
  boundaries: SlideBoundary[],
  durationMs: number,
  slideIdPrefix: string,
): SlideData[] {
  const starts = [0, ...boundaries.map((boundary) => boundary.timestampMs)]
  return starts.map((startMs, index) => {
    const endMs = index < starts.length - 1 ? starts[index + 1] : durationMs
    const boundary = index > 0 ? boundaries[index - 1] : undefined
    return {
      id: `${slideIdPrefix}-${index + 1}`,
      index,
      startMs,
      endMs: Math.max(startMs, endMs),
      detection: {
        source: boundary?.source ?? 'auto',
        distance: boundary?.distance,
      },
      image: {},
    }
  })
}

function representativeTimestamp(startMs: number, endMs: number) {
  const segmentDurationMs = Math.max(0, endMs - startMs)
  if (segmentDurationMs <= 400) return startMs
  return startMs + Math.min(Math.round(segmentDurationMs / 2), segmentDurationMs - 200)
}

export async function extractRepresentativeFrameForSlide(
  project: MediaProject,
  slide: SlideData,
  outputPath: string,
  signal?: AbortSignal,
) {
  const context = getActiveArticleSourceContext(project)
  return extractRepresentativeFrame({
    path: context.source.path,
    crop: context.crop,
    perspectiveCrop: context.perspectiveCrop,
    metadata: context.source.metadata,
    timestampMs: context.range.startMs + representativeTimestamp(slide.startMs, slide.endMs),
    outputPath,
    signal,
  })
}

async function addRepresentativeFrames(
  project: MediaProject,
  slides: SlideData[],
  onProgress?: (progress: number) => void,
  failOnError = false,
) {
  const articleId = requireActiveArticleId(project)
  const assetRunId = crypto.randomUUID()
  const completed: SlideData[] = []
  try {
    // Keep ffmpeg sidecars sequential so long videos do not spawn dozens of encoders at once.
    for (let index = 0; index < slides.length; index += 1) {
      const slide = slides[index]
      try {
        const outputPath = await getSlideRunAssetPath(project.id, articleId, assetRunId, index)
        await extractRepresentativeFrameForSlide(project, slide, outputPath)
        completed.push({ ...slide, image: { representativeFramePath: outputPath } })
      } catch (error) {
        console.error(`Slide ${index + 1}の代表フレームを作成できませんでした`, error)
        if (failOnError) {
          const detail = error instanceof Error ? error.message : String(error)
          throw new Error(`Slide ${index + 1}の代表画像を作成できませんでした: ${detail}`)
        }
        completed.push(slide)
      } finally {
        onProgress?.((index + 1) / Math.max(slides.length, 1))
      }
    }
  } catch (error) {
    await removeSlideRunAssets(project.id, articleId, assetRunId).catch((cleanupError) => {
      console.warn('失敗した代表画像候補を削除できませんでした。', cleanupError)
    })
    throw error
  }

  return { slides: completed, assetRunId }
}

export async function commitSlideDetectionOutput(
  project: MediaProject,
  pending: PendingSlideDetectionOutput,
  persist: (output: SlideDetectionOutput) => void | Promise<void>,
) {
  const articleId = requireActiveArticleId(project)
  try {
    const output = { result: pending.result, slides: pending.slides }
    await persist(output)
    await pruneSlideAssetRuns(project.id, articleId, pending.assetRunId).catch((cleanupError) => {
      console.warn('以前の代表画像を削除できませんでした。', cleanupError)
    })
    return output
  } catch (error) {
    try {
      await removeSlideRunAssets(project.id, articleId, pending.assetRunId)
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'スライド区間の保存失敗後に代表画像を片付けられませんでした。',
      )
    }
    throw error
  }
}

type CreateManualSlideDetectionOutputInput = {
  project: MediaProject
  boundaries: SlideBoundary[]
  threshold: number
  sampleIntervalMs: number
}

export async function createManualSlideDetectionOutput({
  project,
  boundaries,
  threshold,
  sampleIntervalMs,
}: CreateManualSlideDetectionOutputInput): Promise<PendingSlideDetectionOutput> {
  const context = getActiveArticleSourceContext(project)
  const durationMs = context.range.endMs - context.range.startMs
  const sortedBoundaries = boundaries.toSorted(
    (first, second) => first.timestampMs - second.timestampMs,
  )
  const pending = await addRepresentativeFrames(
    project,
    buildSlideData(sortedBoundaries, durationMs, `slide-${requireActiveArticleId(project)}`),
    undefined,
    true,
  )

  return {
    result: {
      sampleIntervalMs,
      threshold,
      framesAnalyzed: project.slideDetection?.framesAnalyzed ?? 0,
      boundaries: sortedBoundaries,
      detectedAt: project.slideDetection?.detectedAt ?? new Date().toISOString(),
    },
    slides: pending.slides,
    assetRunId: pending.assetRunId,
  }
}

type RunSlideDetectionInput = {
  project: MediaProject
  threshold?: number
  sampleIntervalMs?: number
  onProgress?: (progress: number) => void
  onStage?: (stage: SlideDetectionStage) => void
}

export async function runSlideDetection({
  project,
  threshold: thresholdOverride,
  sampleIntervalMs: sampleIntervalOverride,
  onProgress,
  onStage,
}: RunSlideDetectionInput): Promise<PendingSlideDetectionOutput> {
  const context = getActiveArticleSourceContext(project)
  const durationMs = context.range.endMs - context.range.startMs
  const { sampleIntervalMs: configuredSampleIntervalMs, threshold: configuredThreshold } =
    project.settings.slideDetection
  const sampleIntervalMs = sampleIntervalOverride ?? configuredSampleIntervalMs
  const threshold = thresholdOverride ?? configuredThreshold
  onStage?.('sampling')
  const frames = await sampleVideoFrames({
    path: context.source.path,
    crop: context.crop,
    perspectiveCrop: context.perspectiveCrop,
    metadata: context.source.metadata,
    sampleIntervalMs,
    startMs: context.range.startMs,
    endMs: context.range.endMs,
  })
  onStage?.('comparing')
  const boundaries = detectSlideBoundaries({ frames, threshold })
  onStage?.('extracting')
  const pending = await addRepresentativeFrames(
    project,
    buildSlideData(boundaries, durationMs, `slide-${requireActiveArticleId(project)}`),
    onProgress,
  )

  return {
    result: {
      sampleIntervalMs,
      threshold,
      framesAnalyzed: frames.length,
      boundaries,
      detectedAt: new Date().toISOString(),
    },
    slides: pending.slides,
    assetRunId: pending.assetRunId,
  }
}
