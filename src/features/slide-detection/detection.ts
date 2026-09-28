import {
  extractFullFrame,
  extractRepresentativeFrame,
  sampleCropFrames,
  type FrameHash,
} from '../../lib/media/ffmpeg'
import { hammingDistance } from '../../lib/media/dhash'
import { join } from '@tauri-apps/api/path'
import {
  getSlideRunAssetPath,
  prepareVisualClassificationDirectory,
  pruneSlideAssetRuns,
  removeSlideRunAssets,
  removeVisualClassificationDirectory,
} from '../../lib/storage/projectAssets'
import { detectPeopleInImages, type PeopleDetection } from '../../lib/vision/personDetection'
import { detectTextInImages, type TextDetection } from '../../lib/vision/textDetection'
import {
  effectiveVisualKind,
  requireActiveArticleId,
  type MediaProject,
  type SlideBoundary,
  type SlideData,
  type VisualClassificationMetadata,
} from '../../types/project'
import { getActiveArticleSourceContext } from '../../lib/project/articleSource'
import type {
  PendingSlideDetectionOutput,
  SlideDetectionOutput,
  SlideDetectionStage,
} from './types'
import {
  classifyVisualSegment,
  VISUAL_CLASSIFIER_VERSION,
  visualSampleTimestamps,
} from './classification'

export const MINIMUM_BOUNDARY_GAP_MS = 1500
export const MINIMUM_STABLE_SUBSEGMENT_MS = 5000

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

function detectSlideBoundaries({
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

export function detectVisualBoundaries({
  frames,
  threshold,
}: {
  frames: FrameHash[]
  threshold: number
}) {
  return detectSlideBoundaries({
    frames,
    threshold,
  })
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
      autoKind: 'unknown',
      personLayout: 'none',
      detection: {
        source: boundary?.source ?? 'auto',
        distance: boundary?.distance,
      },
      image: {},
    }
  })
}

/**
 * The first-pass boundary detector can miss gradual transitions. Split an auto interval around
 * long, locally stable holds so they can be classified independently from nearby live footage.
 */
export function refineSegmentsAtStableRuns(
  segments: SlideData[],
  sampledFrames: FrameHash[],
  threshold: number,
) {
  const settleThreshold = Math.max(2, Math.floor(threshold / 2))
  const refined: SlideData[] = []

  for (const segment of segments) {
    const frames = sampledFrames.filter(
      (frame) => frame.timestampMs >= segment.startMs && frame.timestampMs < segment.endMs,
    )
    if (frames.length < 2) {
      refined.push({ ...segment, index: refined.length })
      continue
    }

    const stableRuns: Array<{ startMs: number; endMs: number }> = []
    let runStartIndex = -1
    for (let index = 0; index < frames.length - 1; index += 1) {
      const stable = frameDistance(frames[index], frames[index + 1]) <= settleThreshold
      if (stable && runStartIndex < 0) runStartIndex = index
      const isRunEnd = runStartIndex >= 0 && (!stable || index === frames.length - 2)
      if (!isRunEnd) continue

      const lastStablePairIndex = stable ? index : index - 1
      const startMs = frames[runStartIndex].timestampMs
      const endMs = frames[lastStablePairIndex + 1].timestampMs
      if (endMs - startMs >= MINIMUM_STABLE_SUBSEGMENT_MS) stableRuns.push({ startMs, endMs })
      runStartIndex = -1
    }

    if (stableRuns.length === 0) {
      refined.push({ ...segment, index: refined.length })
      continue
    }

    const cutPoints = [segment.startMs]
    for (const run of stableRuns) {
      for (const timestampMs of [run.startMs, run.endMs]) {
        const distanceFromPrevious = timestampMs - cutPoints.at(-1)!
        const distanceToEnd = segment.endMs - timestampMs
        if (
          distanceFromPrevious >= MINIMUM_BOUNDARY_GAP_MS &&
          distanceToEnd >= MINIMUM_BOUNDARY_GAP_MS
        ) {
          cutPoints.push(timestampMs)
        }
      }
    }
    cutPoints.push(segment.endMs)

    if (cutPoints.length === 2) {
      refined.push({ ...segment, index: refined.length })
      continue
    }

    for (let partIndex = 0; partIndex < cutPoints.length - 1; partIndex += 1) {
      const startMs = cutPoints[partIndex]
      const endMs = cutPoints[partIndex + 1]
      const boundaryFrameIndex = frames.findIndex((frame) => frame.timestampMs >= startMs)
      const boundaryDistance =
        boundaryFrameIndex > 0
          ? frameDistance(frames[boundaryFrameIndex - 1], frames[boundaryFrameIndex])
          : segment.detection.distance
      refined.push({
        ...segment,
        id: `${segment.id}-stable-${partIndex + 1}`,
        index: refined.length,
        startMs,
        endMs,
        detection:
          partIndex === 0
            ? segment.detection
            : {
                source: 'auto',
                ...(boundaryDistance === undefined ? {} : { distance: boundaryDistance }),
              },
      })
    }
  }

  return refined
}

function boundariesForSegments(segments: SlideData[]): SlideBoundary[] {
  return segments.slice(1).map((segment) => ({
    id: `boundary-${segment.startMs}`,
    timestampMs: segment.startMs,
    distance: segment.detection.distance ?? 0,
    source: segment.detection.source,
  }))
}

function weightedAverage(first: number, firstWeight: number, second: number, secondWeight: number) {
  const total = firstWeight + secondWeight
  return total === 0 ? 0 : (first * firstWeight + second * secondWeight) / total
}

function mergeClassificationMetadata(
  first: VisualClassificationMetadata,
  second: VisualClassificationMetadata,
): VisualClassificationMetadata {
  const firstSamples = first.evidence.samplesAnalyzed
  const secondSamples = second.evidence.samplesAnalyzed
  const average = (firstValue: number, secondValue: number) =>
    weightedAverage(firstValue, firstSamples, secondValue, secondSamples)
  return {
    confidence: Math.min(first.confidence, second.confidence),
    classifierVersion: VISUAL_CLASSIFIER_VERSION,
    visionEngineVersion: first.visionEngineVersion ?? second.visionEngineVersion,
    evidence: {
      samplesAnalyzed: firstSamples + secondSamples,
      cropLongestStableRunRatio: average(
        first.evidence.cropLongestStableRunRatio ?? first.evidence.cropStableRatio ?? 0,
        second.evidence.cropLongestStableRunRatio ?? second.evidence.cropStableRatio ?? 0,
      ),
      cropLongestStableRunMs: Math.max(
        first.evidence.cropLongestStableRunMs ?? 0,
        second.evidence.cropLongestStableRunMs ?? 0,
      ),
      cropMotionMedian: average(first.evidence.cropMotionMedian, second.evidence.cropMotionMedian),
      textRegionCount:
        (first.evidence.textRegionCount ?? 0) + (second.evidence.textRegionCount ?? 0),
      textRegionAreaRatio: average(
        first.evidence.textRegionAreaRatio ?? 0,
        second.evidence.textRegionAreaRatio ?? 0,
      ),
      facePresenceRatio: average(
        first.evidence.facePresenceRatio,
        second.evidence.facePresenceRatio,
      ),
      humanPresenceRatio: average(
        first.evidence.humanPresenceRatio,
        second.evidence.humanPresenceRatio,
      ),
      largestFaceAreaRatio: Math.max(
        first.evidence.largestFaceAreaRatio,
        second.evidence.largestFaceAreaRatio,
      ),
      largestHumanAreaRatio: Math.max(
        first.evidence.largestHumanAreaRatio,
        second.evidence.largestHumanAreaRatio,
      ),
      personOutsideCropRatio: Math.max(
        first.evidence.personOutsideCropRatio,
        second.evidence.personOutsideCropRatio,
      ),
      personCenterMotionMedian: average(
        first.evidence.personCenterMotionMedian,
        second.evidence.personCenterMotionMedian,
      ),
      personAreaChangeMedian: average(
        first.evidence.personAreaChangeMedian,
        second.evidence.personAreaChangeMedian,
      ),
      personBoxIouMedian: average(
        first.evidence.personBoxIouMedian,
        second.evidence.personBoxIouMedian,
      ),
      faceLandmarkMotionMax: Math.max(
        first.evidence.faceLandmarkMotionMax ?? 0,
        second.evidence.faceLandmarkMotionMax ?? 0,
      ),
    },
  }
}

export function mergeAdjacentNonSlideSegments(segments: SlideData[]) {
  const merged: SlideData[] = []
  for (const source of segments) {
    const segment = { ...source }
    const previous = merged.at(-1)
    const canMerge =
      previous !== undefined &&
      previous.endMs === segment.startMs &&
      previous.autoKind === 'non-slide' &&
      segment.autoKind === 'non-slide'

    if (canMerge && previous.classification !== undefined && segment.classification !== undefined) {
      merged[merged.length - 1] = {
        ...previous,
        endMs: segment.endMs,
        classification: mergeClassificationMetadata(
          previous.classification,
          segment.classification,
        ),
      }
      continue
    }
    merged.push(segment)
  }
  return merged.map((segment, index) => ({ ...segment, index }))
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
  if (effectiveVisualKind(slide) === 'non-slide') {
    return extractFullFrame({
      path: context.source.path,
      timestampMs: context.range.startMs + representativeTimestamp(slide.startMs, slide.endMs),
      outputPath,
      signal,
    })
  }
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

async function classifySegments(
  project: MediaProject,
  segments: SlideData[],
  sampledFrames: FrameHash[],
  threshold: number,
) {
  const refinedSegments = refineSegmentsAtStableRuns(segments, sampledFrames, threshold)
  const articleId = requireActiveArticleId(project)
  const context = getActiveArticleSourceContext(project)
  const runId = crypto.randomUUID()
  const directory = await prepareVisualClassificationDirectory(project.id, articleId, runId)
  const pathsBySegment = new Map<string, string[]>()
  const cropPathBySegment = new Map<string, string>()
  try {
    for (const segment of refinedSegments) {
      const paths: string[] = []
      const timestamps = visualSampleTimestamps(segment.startMs, segment.endMs)
      for (let index = 0; index < timestamps.length; index += 1) {
        const outputPath = await join(directory, `${segment.index}-${index}.jpg`)
        try {
          await extractFullFrame({
            path: context.source.path,
            timestampMs: context.range.startMs + timestamps[index],
            outputPath,
          })
          paths.push(outputPath)
        } catch (error) {
          console.warn(`区間${segment.index + 1}の人物検出画像を抽出できませんでした`, error)
        }
      }
      pathsBySegment.set(segment.id, paths)
      const cropOutputPath = await join(directory, `${segment.index}-crop.jpg`)
      try {
        await extractRepresentativeFrame({
          path: context.source.path,
          crop: context.crop,
          perspectiveCrop: context.perspectiveCrop,
          metadata: context.source.metadata,
          timestampMs:
            context.range.startMs + representativeTimestamp(segment.startMs, segment.endMs),
          outputPath: cropOutputPath,
        })
        cropPathBySegment.set(segment.id, cropOutputPath)
      } catch (error) {
        console.warn(`区間${segment.index + 1}の文字領域検出画像を抽出できませんでした`, error)
      }
    }

    const allPaths = [...pathsBySegment.values()].flat()
    let detections: PeopleDetection[] = []
    let failedImagePaths = new Set<string>()
    try {
      const result = await detectPeopleInImages({ imagePaths: allPaths })
      detections = result.detections
      failedImagePaths = new Set(result.failedImagePaths)
    } catch (error) {
      failedImagePaths = new Set(allPaths)
      console.warn('人物検出を実行できなかったため区間を不明として継続します', error)
    }
    const byPath = new Map(detections.map((detection) => [detection.imagePath, detection]))
    let textDetections: TextDetection[] = []
    try {
      textDetections = await detectTextInImages({ imagePaths: [...cropPathBySegment.values()] })
    } catch (error) {
      console.warn('文字領域検出を実行できなかったため文字の証拠なしで継続します', error)
    }
    const textByPath = new Map(textDetections.map((detection) => [detection.imagePath, detection]))
    const settleThreshold = Math.max(2, Math.floor(threshold / 2))
    const classifiedSegments = refinedSegments.map((segment) => {
      const midpoint = (segment.startMs + segment.endMs) / 2
      const representative = sampledFrames
        .filter(
          (frame) => frame.timestampMs >= segment.startMs && frame.timestampMs < segment.endMs,
        )
        .toSorted(
          (first, second) =>
            Math.abs(first.timestampMs - midpoint) - Math.abs(second.timestampMs - midpoint),
        )[0]
      const segmentPaths = pathsBySegment.get(segment.id) ?? []
      const segmentDetections = segmentPaths.flatMap((path) => {
        const detection = byPath.get(path)
        return detection ? [detection] : []
      })
      if (
        segmentPaths.length === 0 ||
        segmentPaths.some((path) => failedImagePaths.has(path)) ||
        segmentDetections.length !== segmentPaths.length
      ) {
        return {
          ...segment,
          autoKind: 'unknown' as const,
          personLayout: 'none' as const,
          detection: {
            ...segment.detection,
            ...(representative ? { hash: representative.hash } : {}),
          },
        }
      }
      const classified = classifyVisualSegment({
        segment,
        sampledFrames,
        people: segmentDetections,
        text: textByPath.get(cropPathBySegment.get(segment.id) ?? ''),
        crop: context.crop,
        metadata: context.source.metadata,
        settleThreshold,
      })
      return {
        ...segment,
        ...classified,
        detection: {
          ...segment.detection,
          ...(representative ? { hash: representative.hash } : {}),
        },
      }
    })
    return mergeAdjacentNonSlideSegments(classifiedSegments)
  } finally {
    await removeVisualClassificationDirectory(project.id, articleId, runId)
  }
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
  segments?: SlideData[]
}

export async function createManualSlideDetectionOutput({
  project,
  boundaries,
  threshold,
  sampleIntervalMs,
  segments,
}: CreateManualSlideDetectionOutputInput): Promise<PendingSlideDetectionOutput> {
  const context = getActiveArticleSourceContext(project)
  const durationMs = context.range.endMs - context.range.startMs
  const sortedBoundaries = boundaries.toSorted(
    (first, second) => first.timestampMs - second.timestampMs,
  )
  const pending = await addRepresentativeFrames(
    project,
    (
      segments ??
      buildSlideData(sortedBoundaries, durationMs, `segment-${requireActiveArticleId(project)}`)
    ).map((segment) => ({ ...segment, image: {} })),
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
      visualClassifier: project.slideDetection?.visualClassifier,
    },
    slides: pending.slides,
    assetRunId: pending.assetRunId,
  }
}

type RunSlideDetectionInput = {
  project: MediaProject
  onProgress?: (progress: number) => void
  onStage?: (stage: SlideDetectionStage) => void
}

export async function runSlideDetection({
  project,
  onProgress,
  onStage,
}: RunSlideDetectionInput): Promise<PendingSlideDetectionOutput> {
  const context = getActiveArticleSourceContext(project)
  const durationMs = context.range.endMs - context.range.startMs
  const { sampleIntervalMs, threshold } = project.settings.slideDetection
  onStage?.('sampling')
  const frames = await sampleCropFrames({
    path: context.source.path,
    crop: context.crop,
    perspectiveCrop: context.perspectiveCrop,
    metadata: context.source.metadata,
    sampleIntervalMs,
    startMs: context.range.startMs,
    endMs: context.range.endMs,
  })
  onStage?.('comparing')
  const boundaries = detectVisualBoundaries({ frames, threshold })
  onStage?.('classifying')
  const classifiedSegments = await classifySegments(
    project,
    buildSlideData(boundaries, durationMs, `segment-${requireActiveArticleId(project)}`),
    frames,
    threshold,
  )
  const classifiedBoundaries = boundariesForSegments(classifiedSegments)
  onStage?.('extracting')
  const pending = await addRepresentativeFrames(project, classifiedSegments, onProgress)

  return {
    result: {
      sampleIntervalMs,
      threshold,
      framesAnalyzed: frames.length,
      boundaries: classifiedBoundaries,
      detectedAt: new Date().toISOString(),
      visualClassifier: {
        version: VISUAL_CLASSIFIER_VERSION,
        personDetection: 'face-and-human',
        samplePolicy: 'adaptive-2-3-5',
        frameWidth: 640,
      },
    },
    slides: pending.slides,
    assetRunId: pending.assetRunId,
  }
}
