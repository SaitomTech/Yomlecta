import type { TranscriptSegment } from '../../types/project'

function transcriptSegmentId(segment: TranscriptSegment, index: number) {
  return segment.id.trim() || `segment-${index}-${segment.startMs}-${segment.endMs}`
}

export function normalizeTranscriptSegments(segments: TranscriptSegment[]) {
  const occurrences = new Map<string, number>()
  return segments.map((segment, index) => {
    const baseId = transcriptSegmentId(segment, index)
    const occurrence = occurrences.get(baseId) ?? 0
    occurrences.set(baseId, occurrence + 1)
    return {
      ...segment,
      id: occurrence === 0 ? baseId : `${baseId}-${occurrence}`,
      text: segment.text.trim(),
    }
  })
}
