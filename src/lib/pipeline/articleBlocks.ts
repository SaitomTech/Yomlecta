import type {
  ArticleBlock,
  TranscriptSegment,
  VisualSegment,
  VisualSegmentKind,
} from '../../types/project'
import { effectiveVisualKind } from '../../types/project'
import { hammingDistance } from '../media/dhash'

function isAnchorKind(kind: VisualSegmentKind) {
  return kind === 'slide' || kind === 'unknown'
}

function sameSlide(first: VisualSegment | undefined, second: VisualSegment) {
  const firstHash = first?.detection.hash
  const secondHash = second.detection.hash
  if (!firstHash || !secondHash || firstHash.length !== secondHash.length) return false
  return hammingDistance(firstHash, secondHash) <= 4
}

function preferredImageSegment(segments: VisualSegment[]) {
  return (
    segments.find((segment) => effectiveVisualKind(segment) === 'slide') ??
    segments.find((segment) => effectiveVisualKind(segment) === 'unknown')
  )
}

/** Article blocks use their display host segment as their stable UI and persistence identity. */
export function articleBlockHostSegmentId(
  block: Pick<ArticleBlock, 'imageSegmentId' | 'visualSegmentIds'>,
) {
  return block.imageSegmentId ?? block.visualSegmentIds[0]
}

export function buildArticleBlocks(
  visualSegments: VisualSegment[],
  previousBlocks: ArticleBlock[] = [],
): ArticleBlock[] {
  const ordered = visualSegments.toSorted(
    (first, second) => first.startMs - second.startMs || first.index - second.index,
  )
  if (ordered.length === 0) return []

  const previousById = new Map(previousBlocks.map((block) => [block.id, block]))
  const groups: VisualSegment[][] = []
  let pendingLeading: VisualSegment[] = []

  for (const segment of ordered) {
    if (!isAnchorKind(effectiveVisualKind(segment))) {
      const current = groups.at(-1)
      if (current) current.push(segment)
      else pendingLeading.push(segment)
      continue
    }

    const current = groups.at(-1)
    const currentImage = current ? preferredImageSegment(current) : undefined
    if (current && sameSlide(currentImage, segment)) {
      current.push(segment)
      continue
    }

    groups.push([...pendingLeading, segment])
    pendingLeading = []
  }

  if (groups.length === 0) {
    groups.push(ordered)
  }

  return groups.map((segments, index) => {
    const imageSegment = preferredImageSegment(segments)
    // The block id is the display host segment id by domain invariant.
    const id = imageSegment?.id ?? segments[0].id
    const previous = previousById.get(id)
    return {
      id,
      index,
      visualSegmentIds: segments.map((segment) => segment.id),
      ...(imageSegment ? { imageSegmentId: imageSegment.id } : {}),
      startMs: Math.min(...segments.map((segment) => segment.startMs)),
      endMs: Math.max(...segments.map((segment) => segment.endMs)),
      ...(previous?.transcript ? { transcript: previous.transcript } : {}),
    }
  })
}

export function transcriptionRangesForArticleBlocks(
  durationMs: number,
  blocks: Array<Pick<ArticleBlock, 'startMs' | 'endMs'>>,
  maximumRangeMs: number,
  targetRangeMs = maximumRangeMs,
) {
  const duration = Math.max(1, durationMs)
  const maximum = Math.max(1, maximumRangeMs)
  const target = Math.max(1, Math.min(maximum, targetRangeMs))
  const ranges: Array<{ startMs: number; endMs: number }> = []

  const boundaryPoints = [0, duration, ...blocks.flatMap((block) => [block.startMs, block.endMs])]
    .map((point) => Math.max(0, Math.min(duration, point)))
    .toSorted((first, second) => first - second)
    .filter((point, index, points) => index === 0 || point !== points[index - 1])

  let rangeStart = 0
  while (rangeStart < duration) {
    const targetEnd = Math.min(duration, rangeStart + target)
    const maximumEnd = Math.min(duration, rangeStart + maximum)
    const candidates = boundaryPoints.filter((point) => point > rangeStart && point <= maximumEnd)
    const rangeEnd =
      candidates.find((point) => point >= targetEnd) ?? candidates.at(-1) ?? maximumEnd
    ranges.push({ startMs: rangeStart, endMs: rangeEnd })
    rangeStart = rangeEnd
  }
  return ranges
}

function overlapDuration(segment: TranscriptSegment, block: ArticleBlock) {
  return Math.max(
    0,
    Math.min(segment.endMs, block.endMs) - Math.max(segment.startMs, block.startMs),
  )
}

const LONG_UNTIMED_TRANSCRIPT_MS = 30_000

function isNaturalTextBoundary(characters: string[], index: number) {
  const previous = characters[index - 1] ?? ''
  const next = characters[index] ?? ''
  return /[\s、。,.!?！？;；:：]/u.test(previous) || /\s/u.test(next)
}

function nearestTextBoundary(
  characters: string[],
  ideal: number,
  minimum: number,
  maximum: number,
) {
  const radiusLimit = Math.max(12, Math.round(characters.length * 0.05))
  for (let radius = 0; radius <= radiusLimit; radius += 1) {
    const after = ideal + radius
    if (after >= minimum && after <= maximum && isNaturalTextBoundary(characters, after)) {
      return after
    }
    const before = ideal - radius
    if (before >= minimum && before <= maximum && isNaturalTextBoundary(characters, before)) {
      return before
    }
  }
  return Math.max(minimum, Math.min(maximum, ideal))
}

function splitTextByDuration(text: string, durations: number[]) {
  const characters = Array.from(text.trim())
  if (durations.length <= 1 || characters.length === 0) return [text.trim()]
  const totalDuration = durations.reduce((total, duration) => total + duration, 0)
  if (totalDuration <= 0) return [text.trim()]

  const pieces: string[] = []
  let previousCut = 0
  let elapsedDuration = 0
  for (let index = 0; index < durations.length - 1; index += 1) {
    elapsedDuration += durations[index]
    const remainingPieces = durations.length - index - 1
    const minimum = Math.min(characters.length, previousCut + 1)
    const maximum = Math.max(minimum, characters.length - remainingPieces)
    const ideal = Math.round((characters.length * elapsedDuration) / totalDuration)
    const cut = nearestTextBoundary(characters, ideal, minimum, maximum)
    pieces.push(characters.slice(previousCut, cut).join('').trim())
    previousCut = cut
  }
  pieces.push(characters.slice(previousCut).join('').trim())
  return pieces
}

function transcriptFragmentsForBlocks(segment: TranscriptSegment, blocks: ArticleBlock[]) {
  const overlaps = blocks.flatMap((block, index) => {
    const duration = overlapDuration(segment, block)
    return duration > 0 ? [{ blockIndex: index, block, duration }] : []
  })
  const segmentDuration = Math.max(0, segment.endMs - segment.startMs)
  if (overlaps.length < 2 || segmentDuration < LONG_UNTIMED_TRANSCRIPT_MS) return []

  const pieces = splitTextByDuration(
    segment.text,
    overlaps.map((overlap) => overlap.duration),
  )
  return overlaps.flatMap((overlap, index) => {
    const text = pieces[index]?.trim()
    if (!text) return []
    return [
      {
        blockIndex: overlap.blockIndex,
        segment: {
          ...segment,
          id: `${segment.id}-block-${overlap.blockIndex}`,
          startMs: Math.max(segment.startMs, overlap.block.startMs),
          endMs: Math.min(segment.endMs, overlap.block.endMs),
          text,
        },
      },
    ]
  })
}

function blockIndexForTranscript(segment: TranscriptSegment, blocks: ArticleBlock[]) {
  let bestIndex = -1
  let bestOverlap = 0
  blocks.forEach((block, index) => {
    const overlap = overlapDuration(segment, block)
    if (overlap > bestOverlap) {
      bestIndex = index
      bestOverlap = overlap
    }
  })
  if (bestIndex >= 0) return bestIndex
  const midpoint = (segment.startMs + segment.endMs) / 2
  return blocks.findIndex(
    (block, index) =>
      midpoint >= block.startMs && (midpoint < block.endMs || index === blocks.length - 1),
  )
}

export function assignTranscriptToArticleBlocks(
  blocks: ArticleBlock[],
  transcriptSegments: TranscriptSegment[],
  model: string,
): ArticleBlock[] {
  const assigned = blocks.map(() => [] as TranscriptSegment[])
  for (const transcriptSegment of transcriptSegments) {
    const fragments = transcriptFragmentsForBlocks(transcriptSegment, blocks)
    if (fragments.length > 0) {
      for (const fragment of fragments) assigned[fragment.blockIndex].push(fragment.segment)
      continue
    }
    const index = blockIndexForTranscript(transcriptSegment, blocks)
    if (index >= 0) assigned[index].push(transcriptSegment)
  }

  return blocks.map((block, index) => ({
    ...block,
    transcript: {
      raw: assigned[index]
        .toSorted((first, second) => first.startMs - second.startMs)
        .map((segment) => segment.text.trim())
        .filter(Boolean)
        .join(' '),
      model,
    },
  }))
}

export function applyArticleBlocksToSegments(
  segments: VisualSegment[],
  blocks: ArticleBlock[],
): VisualSegment[] {
  const transcriptByHost = new Map<string, ArticleBlock['transcript']>()
  for (const block of blocks) {
    const hostId = articleBlockHostSegmentId(block)
    if (hostId && block.transcript) transcriptByHost.set(hostId, block.transcript)
  }
  return segments.map((segment) => ({
    ...segment,
    transcript: transcriptByHost.get(segment.id),
  }))
}

export function ocrEligibleSegments(
  segments: VisualSegment[],
  blocks: ArticleBlock[],
): VisualSegment[] {
  if (blocks.length === 0) {
    return segments.filter((segment) => effectiveVisualKind(segment) !== 'non-slide')
  }
  const imageIds = new Set(blocks.flatMap((block) => block.imageSegmentId ?? []))
  return segments.filter((segment) => imageIds.has(segment.id))
}

export function articleBlockViews(
  segments: VisualSegment[],
  blocks: ArticleBlock[],
): VisualSegment[] {
  if (blocks.length === 0) return segments.filter((segment) => Boolean(segment.transcript))
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]))
  return blocks.flatMap((block) => {
    const hostId = articleBlockHostSegmentId(block)
    const host = hostId ? segmentById.get(hostId) : undefined
    if (!host) return []
    return [
      {
        ...host,
        index: block.index,
        startMs: block.startMs,
        endMs: block.endMs,
        image: block.imageSegmentId ? host.image : {},
        ocr: block.imageSegmentId ? host.ocr : undefined,
        transcript: block.transcript,
      },
    ]
  })
}
