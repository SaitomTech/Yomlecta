import { describe, expect, test } from 'bun:test'
import {
  classifyVisualSegment,
  visualSampleTimestamps,
} from '../src/features/slide-detection/classification'
import type { FrameHash } from '../src/lib/media/ffmpeg'
import type { PeopleDetection } from '../src/lib/vision/personDetection'
import type { TextDetection } from '../src/lib/vision/textDetection'
import {
  PEOPLE_DETECTION_BATCH_SIZE,
  peopleDetectionBatches,
} from '../src/lib/vision/personDetection'
import {
  detectVisualBoundaries,
  mergeAdjacentNonSlideSegments,
} from '../src/features/slide-detection/detection'
import type { SlideData } from '../src/types/project'

const zero = '0000000000000000'
const full = 'ffffffffffffffff'

function frames(cropHashes: string[]): FrameHash[] {
  return cropHashes.map((hash, index) => {
    const timestampMs = index * 1_000
    return {
      timestampMs,
      hash,
      averageLuma: 100,
    }
  })
}

function people(polygon?: PeopleDetection['faces'][number]['polygon']): PeopleDetection[] {
  return Array.from({ length: 3 }, (_, index) => ({
    imagePath: `/tmp/${index}.jpg`,
    faces: polygon ? [{ confidence: 0.9, polygon }] : [],
    humans: [],
    engineVersion: 'test',
  }))
}

const input = {
  segment: { startMs: 0, endMs: 3_000 },
  crop: { x: 200, y: 0, width: 800, height: 1_000 },
  metadata: { width: 1_000, height: 1_000 },
  settleThreshold: 12,
}

function textDetection(area = 0.03): TextDetection {
  return {
    imagePath: '/tmp/crop.jpg',
    textRegions: [
      {
        confidence: 1,
        polygon: [
          { x: 0.1, y: 0.1 },
          { x: 0.1 + area * 2, y: 0.1 },
          { x: 0.1 + area * 2, y: 0.6 },
          { x: 0.1, y: 0.6 },
        ],
      },
    ],
    engineVersion: 'test-text',
  }
}

describe('visual segment classification', () => {
  test('Cropに変化がなければ境界を作らない', () => {
    const result = detectVisualBoundaries({
      frames: frames([zero, zero, zero]),
      threshold: 12,
    })

    expect(result).toEqual([])
  })

  test('人物検知画像を固定上限でバッチ化する', () => {
    const paths = Array.from({ length: PEOPLE_DETECTION_BATCH_SIZE * 2 + 3 }, (_, index) =>
      String(index),
    )
    const batches = peopleDetectionBatches(paths)

    expect(batches.map((batch) => batch.length)).toEqual([
      PEOPLE_DETECTION_BATCH_SIZE,
      PEOPLE_DETECTION_BATCH_SIZE,
      3,
    ])
  })

  test('安定したcropと人物なしはslideになる', () => {
    const result = classifyVisualSegment({
      ...input,
      sampledFrames: frames([zero, zero, zero]),
      people: people(),
    })
    expect(result.autoKind).toBe('slide')
    expect(result.personLayout).toBe('none')
  })

  test('crop外の小さな人物がいてもslideとして扱う', () => {
    const result = classifyVisualSegment({
      ...input,
      sampledFrames: frames([zero, zero, zero]),
      people: people([
        { x: 0.02, y: 0.2 },
        { x: 0.12, y: 0.2 },
        { x: 0.12, y: 0.5 },
        { x: 0.02, y: 0.5 },
      ]),
    })
    expect(result.autoKind).toBe('slide')
    expect(result.personLayout).toBe('outside-crop')
  })

  test('Cropが変化しても人物矩形が静止していればunknownへ逃がす', () => {
    const result = classifyVisualSegment({
      ...input,
      sampledFrames: frames([zero, full, zero]),
      people: people([
        { x: 0.3, y: 0.1 },
        { x: 0.8, y: 0.1 },
        { x: 0.8, y: 0.9 },
        { x: 0.3, y: 0.9 },
      ]),
    })
    expect(result.autoKind).toBe('unknown')
    expect(result.personLayout).toBe('dominant')
  })

  test('背景も人物も静止している大きな人物はunknownへ逃がす', () => {
    const result = classifyVisualSegment({
      ...input,
      sampledFrames: frames([zero, zero, zero]),
      people: people([
        { x: 0.3, y: 0.1 },
        { x: 0.8, y: 0.1 },
        { x: 0.8, y: 0.9 },
        { x: 0.3, y: 0.9 },
      ]),
    })
    expect(result.autoKind).toBe('unknown')
    expect(result.classification.evidence.personCenterMotionMedian).toBe(0)
  })

  test('人物矩形が静止していても顔内部が動けばnon-slideになる', () => {
    const liveFace = people([
      { x: 0.3, y: 0.1 },
      { x: 0.8, y: 0.1 },
      { x: 0.8, y: 0.9 },
      { x: 0.3, y: 0.9 },
    ]).map((sample, index) => ({
      ...sample,
      faces: sample.faces.map((face) => ({
        ...face,
        landmarkSignature: [0.2, 0.2 + index * 0.04, 0.8, 0.8 - index * 0.04],
      })),
    }))
    const result = classifyVisualSegment({
      ...input,
      sampledFrames: frames([zero, zero, zero]),
      people: liveFace,
    })

    expect(result.autoKind).toBe('non-slide')
    expect(result.classification.evidence.faceLandmarkMotionMax).toBeGreaterThan(0.015)
  })

  test('文字のある背景でも顔内部が動く登壇者はnon-slideになる', () => {
    const liveFace = people([
      { x: 0.3, y: 0.1 },
      { x: 0.8, y: 0.1 },
      { x: 0.8, y: 0.9 },
      { x: 0.3, y: 0.9 },
    ]).map((sample, index) => ({
      ...sample,
      faces: sample.faces.map((face) => ({
        ...face,
        landmarkSignature: [0.2, 0.2 + index * 0.04, 0.8, 0.8 - index * 0.04],
      })),
    }))
    const result = classifyVisualSegment({
      ...input,
      sampledFrames: frames([zero, zero, zero]),
      people: liveFace,
      text: textDetection(),
    })

    expect(result.autoKind).toBe('non-slide')
  })

  test('Crop内の文字はスライドの正の証拠になる', () => {
    const result = classifyVisualSegment({
      ...input,
      segment: { startMs: 0, endMs: 5_000 },
      sampledFrames: frames([zero, zero, full, zero, zero]),
      people: people(),
      text: textDetection(),
    })

    expect(result.autoKind).toBe('slide')
    expect(result.classification.evidence.textRegionCount).toBe(1)
  })

  test('Crop安定度は安定フレームの総割合ではなく最長連続区間で判定する', () => {
    const result = classifyVisualSegment({
      ...input,
      segment: { startMs: 0, endMs: 5_000 },
      sampledFrames: frames([zero, zero, full, full, full]),
      people: people(),
    })

    expect(result.classification.evidence.cropLongestStableRunRatio).toBe(0.5)
    expect(result.autoKind).toBe('unknown')
  })

  test('人物矩形が継続して移動すればnon-slideになる', () => {
    const movingPeople = [0.2, 0.3, 0.42].map((left, index) => ({
      imagePath: `/tmp/${index}.jpg`,
      faces: [
        {
          confidence: 0.9,
          polygon: [
            { x: left, y: 0.1 },
            { x: left + 0.4, y: 0.1 },
            { x: left + 0.4, y: 0.9 },
            { x: left, y: 0.9 },
          ],
        },
      ],
      humans: [],
      engineVersion: 'test',
    }))
    const result = classifyVisualSegment({
      ...input,
      sampledFrames: frames([zero, zero, zero]),
      people: movingPeople,
    })

    expect(result.autoKind).toBe('non-slide')
    expect(result.classification.evidence.personCenterMotionMedian).toBeGreaterThan(0)
  })

  test('集合絵の人物矩形が動いても文字と安定Cropがあればslideになる', () => {
    const detectedPeople = [0.18, 0.28, 0.4].map((left, index) => ({
      imagePath: `/tmp/painting-${index}.jpg`,
      faces: [],
      humans: [
        {
          confidence: 0.9,
          polygon: [
            { x: left, y: 0.15 },
            { x: left + 0.45, y: 0.15 },
            { x: left + 0.45, y: 0.9 },
            { x: left, y: 0.9 },
          ],
        },
      ],
      engineVersion: 'test',
    }))
    const result = classifyVisualSegment({
      ...input,
      sampledFrames: frames([zero, zero, zero]),
      people: detectedPeople,
      text: textDetection(),
    })

    expect(result.classification.evidence.faceLandmarkMotionMax).toBe(0)
    expect(result.classification.evidence.personCenterMotionMedian).toBeGreaterThan(0.02)
    expect(result.autoKind).toBe('slide')
  })

  test('5点中2点だけの人物誤検出ではnon-slideにしない', () => {
    const falsePositive = people([
      { x: 0.15, y: 0.1 },
      { x: 0.85, y: 0.1 },
      { x: 0.85, y: 0.9 },
      { x: 0.15, y: 0.9 },
    ]).map((sample, index) => (index < 2 ? sample : { ...sample, faces: [] }))
    falsePositive.push(
      { imagePath: '/tmp/3.jpg', faces: [], humans: [], engineVersion: 'test' },
      { imagePath: '/tmp/4.jpg', faces: [], humans: [], engineVersion: 'test' },
    )
    const result = classifyVisualSegment({
      ...input,
      segment: { startMs: 0, endMs: 5_000 },
      sampledFrames: frames([zero, full, zero, full, zero]),
      people: falsePositive,
    })

    expect(result.autoKind).toBe('unknown')
    expect(result.classification.evidence.facePresenceRatio).toBe(0.4)
  })

  test('安定したCropでは5点中2点の人物誤検出を無視してslideにする', () => {
    const falsePositive = people([
      { x: 0.15, y: 0.1 },
      { x: 0.85, y: 0.1 },
      { x: 0.85, y: 0.9 },
      { x: 0.15, y: 0.9 },
    ]).map((sample, index) => (index < 2 ? sample : { ...sample, faces: [] }))
    falsePositive.push(
      { imagePath: '/tmp/3.jpg', faces: [], humans: [], engineVersion: 'test' },
      { imagePath: '/tmp/4.jpg', faces: [], humans: [], engineVersion: 'test' },
    )
    const result = classifyVisualSegment({
      ...input,
      segment: { startMs: 0, endMs: 5_000 },
      sampledFrames: frames([zero, zero, zero, zero, zero]),
      people: falsePositive,
    })

    expect(result.autoKind).toBe('slide')
    expect(result.personLayout).toBe('none')
  })

  test('集合写真で最大人物が入れ替わっても同じ人物を追跡する', () => {
    const human = (left: number, width: number) => ({
      confidence: 0.9,
      polygon: [
        { x: left, y: 0.2 },
        { x: left + width, y: 0.2 },
        { x: left + width, y: 0.7 },
        { x: left, y: 0.7 },
      ],
    })
    const groupPhoto: PeopleDetection[] = [
      { humans: [human(0.25, 0.4), human(0.64, 0.35)] },
      { humans: [human(0.27, 0.36), human(0.615, 0.4)] },
      { humans: [human(0.25, 0.4), human(0.64, 0.35)] },
    ].map((sample, index) => ({
      imagePath: `/tmp/group-${index}.jpg`,
      faces: [],
      humans: sample.humans,
      engineVersion: 'test',
    }))
    const result = classifyVisualSegment({
      ...input,
      sampledFrames: frames([zero, zero, zero]),
      people: groupPhoto,
    })

    expect(result.autoKind).toBe('slide')
    expect(result.classification.evidence.personCenterMotionMedian).toBeLessThan(0.02)
  })

  test('長さに応じて2・3・5点を選ぶ', () => {
    expect(visualSampleTimestamps(0, 1_000)).toHaveLength(2)
    expect(visualSampleTimestamps(0, 10_000)).toHaveLength(3)
    expect(visualSampleTimestamps(0, 20_000)).toHaveLength(5)
  })

  test('連続するnon-slideは人物の構図が変わっても1区間へ結合する', () => {
    const classification = (samplesAnalyzed: number): SlideData['classification'] => ({
      confidence: 0.9,
      classifierVersion: 'test',
      visionEngineVersion: 'test',
      evidence: {
        samplesAnalyzed,
        cropMotionMedian: 20,
        facePresenceRatio: 0,
        humanPresenceRatio: 1,
        largestFaceAreaRatio: 0,
        largestHumanAreaRatio: 0.32,
        personOutsideCropRatio: 0,
        personCenterMotionMedian: 0.05,
        personAreaChangeMedian: 0.1,
        personBoxIouMedian: 0.7,
      },
    })
    const segment = (
      id: string,
      index: number,
      startMs: number,
      endMs: number,
      personLayout: SlideData['personLayout'],
    ): SlideData => ({
      id,
      index,
      startMs,
      endMs,
      autoKind: 'non-slide',
      personLayout,
      classification: classification(3),
      detection: { source: 'auto' },
      image: {},
    })

    const result = mergeAdjacentNonSlideSegments([
      segment('a', 0, 0, 8_000, 'dominant'),
      segment('b', 1, 8_000, 16_000, 'inside-crop'),
      segment('c', 2, 16_000, 24_000, 'dominant'),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]?.endMs).toBe(24_000)
    expect(result[0]?.classification?.evidence.samplesAnalyzed).toBe(9)
  })
})
