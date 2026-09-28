import { hammingDistance } from '../../lib/media/dhash'
import type { FrameHash } from '../../lib/media/ffmpeg'
import {
  regionAreaRatio,
  regionBounds,
  type PeopleDetection,
} from '../../lib/vision/personDetection'
import { textRegionAreaRatio, type TextDetection } from '../../lib/vision/textDetection'
import type {
  CropRegion,
  MediaMetadata,
  PersonLayout,
  VisualClassificationMetadata,
  VisualSegment,
  VisualSegmentKind,
} from '../../types/project'

export const VISUAL_CLASSIFIER_VERSION = 'visual-rules-v16-stationary-person-slides'

const MIN_PERSON_CONFIDENCE = 0.5
const MIN_PERSON_TRACK_IOU = 0.1
const MIN_SUSTAINED_PERSON_PRESENCE = 0.6
const MIN_FACE_LANDMARK_MOTION = 0.04
const MIN_LONGEST_STABLE_RUN_RATIO = 0.6
const MIN_TEXT_REGION_CONFIDENCE = 0.3
const MIN_TEXT_REGION_AREA_RATIO = 0.008
const MIN_TEXT_STABLE_RUN_RATIO = 0.25

function frameDistance(first: FrameHash, second: FrameHash) {
  const hashDistance = hammingDistance(first.hash, second.hash)
  const lumaDistance =
    first.averageLuma === undefined || second.averageLuma === undefined
      ? 0
      : Math.round(Math.abs(first.averageLuma - second.averageLuma) / 8)
  return hashDistance + lumaDistance
}

function median(values: number[]) {
  if (values.length === 0) return 0
  const ordered = values.toSorted((first, second) => first - second)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : (ordered[middle] ?? 0)
}

function cropBounds(crop: CropRegion, metadata: Pick<MediaMetadata, 'width' | 'height'>) {
  return {
    left: crop.x / metadata.width,
    top: crop.y / metadata.height,
    right: (crop.x + crop.width) / metadata.width,
    bottom: (crop.y + crop.height) / metadata.height,
  }
}

function outsideCropRatio(
  region: PeopleDetection['faces'][number],
  crop: CropRegion,
  metadata: Pick<MediaMetadata, 'width' | 'height'>,
) {
  const person = regionBounds(region)
  const area = person.width * person.height
  if (area <= 0) return 0
  const target = cropBounds(crop, metadata)
  const width = Math.max(
    0,
    Math.min(person.right, target.right) - Math.max(person.left, target.left),
  )
  const height = Math.max(
    0,
    Math.min(person.bottom, target.bottom) - Math.max(person.top, target.top),
  )
  return Math.max(0, Math.min(1, 1 - (width * height) / area))
}

function personLayoutFor(inside: boolean, outside: boolean, dominant: boolean): PersonLayout {
  if (dominant) return 'dominant'
  if (inside && outside) return 'both'
  if (outside) return 'outside-crop'
  if (inside) return 'inside-crop'
  return 'none'
}

function intersectionOverUnion(
  first: ReturnType<typeof regionBounds>,
  second: ReturnType<typeof regionBounds>,
) {
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left))
  const height = Math.max(
    0,
    Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
  )
  const intersection = width * height
  const union = first.width * first.height + second.width * second.height - intersection
  return union <= 0 ? 1 : intersection / union
}

type PersonRegionKind = 'humans' | 'faces'

function personBounds(sample: PeopleDetection, kind: PersonRegionKind) {
  return sample[kind]
    .filter((region) => region.confidence >= MIN_PERSON_CONFIDENCE)
    .map(regionBounds)
}

function boundsArea(bounds: ReturnType<typeof regionBounds>) {
  return bounds.width * bounds.height
}

function trackedPersonMotion(people: PeopleDetection[], kind: PersonRegionKind) {
  const centerMotions: number[] = []
  const areaChanges: number[] = []
  const boxIous: number[] = []
  let previous: ReturnType<typeof regionBounds> | undefined

  for (const sample of people) {
    const candidates = personBounds(sample, kind)
    if (candidates.length === 0) {
      previous = undefined
      continue
    }
    if (!previous) {
      previous = candidates.toSorted((first, second) => boundsArea(second) - boundsArea(first))[0]
      continue
    }

    const match = candidates
      .map((bounds) => ({ bounds, iou: intersectionOverUnion(previous!, bounds) }))
      .toSorted((first, second) => second.iou - first.iou)[0]
    if (!match || match.iou < MIN_PERSON_TRACK_IOU) {
      previous = candidates.toSorted((first, second) => boundsArea(second) - boundsArea(first))[0]
      continue
    }
    const current = match.bounds
    const previousCenter = {
      x: previous.left + previous.width / 2,
      y: previous.top + previous.height / 2,
    }
    const currentCenter = {
      x: current.left + current.width / 2,
      y: current.top + current.height / 2,
    }
    centerMotions.push(
      Math.hypot(currentCenter.x - previousCenter.x, currentCenter.y - previousCenter.y),
    )
    const previousArea = previous.width * previous.height
    const currentArea = current.width * current.height
    areaChanges.push(previousArea <= 0 ? 0 : Math.abs(currentArea - previousArea) / previousArea)
    boxIous.push(match.iou)
    previous = current
  }
  return {
    matchedPairs: boxIous.length,
    personCenterMotionMedian: median(centerMotions),
    personAreaChangeMedian: median(areaChanges),
    personBoxIouMedian: boxIous.length === 0 ? 1 : median(boxIous),
  }
}

function personMotionEvidence(people: PeopleDetection[]) {
  const humanMotion = trackedPersonMotion(people, 'humans')
  const faceMotion = trackedPersonMotion(people, 'faces')
  return humanMotion.matchedPairs >= faceMotion.matchedPairs ? humanMotion : faceMotion
}

function landmarkDistance(first: number[], second: number[]) {
  if (first.length !== second.length || first.length === 0) return undefined
  return (
    first.reduce((total, value, index) => total + Math.abs(value - (second[index] ?? value)), 0) /
    first.length
  )
}

function trackedFaceLandmarkMotion(people: PeopleDetection[]) {
  const changes: number[] = []
  let previous: PeopleDetection['faces'][number] | undefined

  for (const sample of people) {
    const candidates = sample.faces.filter(
      (face) => face.confidence >= MIN_PERSON_CONFIDENCE && face.landmarkSignature,
    )
    if (candidates.length === 0) {
      previous = undefined
      continue
    }
    if (!previous) {
      previous = candidates.toSorted(
        (first, second) => regionAreaRatio(second) - regionAreaRatio(first),
      )[0]
      continue
    }
    const previousBounds = regionBounds(previous)
    const match = candidates
      .map((face) => ({ face, iou: intersectionOverUnion(previousBounds, regionBounds(face)) }))
      .toSorted((first, second) => second.iou - first.iou)[0]
    if (!match || match.iou < MIN_PERSON_TRACK_IOU) {
      previous = candidates.toSorted(
        (first, second) => regionAreaRatio(second) - regionAreaRatio(first),
      )[0]
      continue
    }
    const distance = landmarkDistance(
      previous.landmarkSignature ?? [],
      match.face.landmarkSignature ?? [],
    )
    if (distance !== undefined) changes.push(distance)
    previous = match.face
  }
  return Math.max(0, ...changes)
}

function longestStableRun(frames: FrameHash[], distances: number[], settleThreshold: number) {
  if (distances.length === 0) return { ratio: 1, durationMs: 0 }
  let currentDurationMs = 0
  let longestDurationMs = 0
  for (let index = 0; index < distances.length; index += 1) {
    if ((distances[index] ?? Infinity) <= settleThreshold) {
      currentDurationMs += Math.max(
        0,
        (frames[index + 1]?.timestampMs ?? 0) - (frames[index]?.timestampMs ?? 0),
      )
      longestDurationMs = Math.max(longestDurationMs, currentDurationMs)
    } else {
      currentDurationMs = 0
    }
  }
  const sampledDurationMs = Math.max(
    0,
    (frames.at(-1)?.timestampMs ?? 0) - (frames[0]?.timestampMs ?? 0),
  )
  return {
    ratio: sampledDurationMs === 0 ? 1 : longestDurationMs / sampledDurationMs,
    durationMs: longestDurationMs,
  }
}

type VisualClassification = {
  autoKind: VisualSegmentKind
  personLayout: PersonLayout
  classification: VisualClassificationMetadata
}

export function classifyVisualSegment({
  segment,
  sampledFrames,
  people,
  text,
  crop,
  metadata,
  settleThreshold,
}: {
  segment: Pick<VisualSegment, 'startMs' | 'endMs'>
  sampledFrames: FrameHash[]
  people: PeopleDetection[]
  text?: TextDetection
  crop: CropRegion
  metadata: Pick<MediaMetadata, 'width' | 'height'>
  settleThreshold: number
}): VisualClassification {
  const frames = sampledFrames.filter(
    (frame) => frame.timestampMs >= segment.startMs && frame.timestampMs < segment.endMs,
  )
  const cropDistances: number[] = []
  for (let index = 1; index < frames.length; index += 1) {
    cropDistances.push(frameDistance(frames[index - 1], frames[index]))
  }
  const cropLongestStableRun = longestStableRun(frames, cropDistances, settleThreshold)
  const confidentFaces = people.map((sample) =>
    sample.faces.filter((region) => region.confidence >= MIN_PERSON_CONFIDENCE),
  )
  const confidentHumans = people.map((sample) =>
    sample.humans.filter((region) => region.confidence >= MIN_PERSON_CONFIDENCE),
  )
  const facePresenceRatio =
    people.length === 0
      ? 0
      : confidentFaces.filter((regions) => regions.length > 0).length / people.length
  const humanPresenceRatio =
    people.length === 0
      ? 0
      : confidentHumans.filter((regions) => regions.length > 0).length / people.length
  const faces = confidentFaces.flat()
  const humans = confidentHumans.flat()
  const largestFaceAreaRatio = Math.max(0, ...faces.map(regionAreaRatio))
  const largestHumanAreaRatio = Math.max(0, ...humans.map(regionAreaRatio))
  const allPeople = [...faces, ...humans]
  const outsideRatios = allPeople.map((region) => outsideCropRatio(region, crop, metadata))
  const personOutsideCropRatio = outsideRatios.length === 0 ? 0 : Math.max(...outsideRatios)
  const hasPerson =
    facePresenceRatio >= MIN_SUSTAINED_PERSON_PRESENCE ||
    humanPresenceRatio >= MIN_SUSTAINED_PERSON_PRESENCE
  const stableSlide = cropLongestStableRun.ratio >= MIN_LONGEST_STABLE_RUN_RATIO
  const dominantPerson = largestFaceAreaRatio >= 0.08 || largestHumanAreaRatio >= 0.25
  const personOutsideCrop = personOutsideCropRatio >= 0.5
  const personInsideCrop = hasPerson && personOutsideCropRatio < 0.85
  const personLayout = hasPerson
    ? personLayoutFor(personInsideCrop, personOutsideCrop, dominantPerson)
    : 'none'
  const meaningfulPerson = largestFaceAreaRatio >= 0.012 || largestHumanAreaRatio >= 0.08
  const smallOutsidePerson = personOutsideCrop && !dominantPerson
  const motion = personMotionEvidence(people)
  const faceLandmarkMotionMax = trackedFaceLandmarkMotion(people)
  const liveFaceMotion = faceLandmarkMotionMax >= MIN_FACE_LANDMARK_MOTION
  const movingPersonBox =
    motion.personCenterMotionMedian >= 0.02 ||
    motion.personAreaChangeMedian >= 0.12 ||
    motion.personBoxIouMedian <= 0.82
  const stationaryPersonTrack =
    motion.matchedPairs >= 4 &&
    motion.personCenterMotionMedian <= 0.005 &&
    motion.personAreaChangeMedian <= 0.02 &&
    motion.personBoxIouMedian >= 0.97 &&
    faceLandmarkMotionMax < MIN_FACE_LANDMARK_MOTION
  const textRegions =
    text?.textRegions.filter((region) => region.confidence >= MIN_TEXT_REGION_CONFIDENCE) ?? []
  const textRegionCount = textRegions.length
  const textRegionArea = Math.min(
    1,
    textRegions.reduce((sum, region) => sum + textRegionAreaRatio(region), 0),
  )
  const hasTextEvidence = textRegionCount >= 2 || textRegionArea >= MIN_TEXT_REGION_AREA_RATIO
  const slideLikeCrop =
    stableSlide || (hasTextEvidence && cropLongestStableRun.ratio >= MIN_TEXT_STABLE_RUN_RATIO)
  const stationaryPersonSlide =
    stableSlide &&
    hasPerson &&
    meaningfulPerson &&
    Math.max(facePresenceRatio, humanPresenceRatio) >= 0.8 &&
    stationaryPersonTrack &&
    (hasTextEvidence ||
      (motion.personCenterMotionMedian <= 0.002 &&
        motion.personAreaChangeMedian <= 0.01 &&
        motion.personBoxIouMedian >= 0.99))

  let autoKind: VisualSegmentKind = 'unknown'
  let confidence = 0.45
  if (slideLikeCrop && hasPerson && smallOutsidePerson) {
    autoKind = 'slide'
    confidence = 0.78
  } else if (stationaryPersonSlide) {
    // Stable, repeatedly identical person boxes on a settled frame indicate a still image, even
    // when the slide is a painting/photo with no OCR text or the person dominates the crop.
    autoKind = 'slide'
    confidence = hasTextEvidence ? 0.88 : 0.82
  } else if (hasPerson && meaningfulPerson && !smallOutsidePerson && liveFaceMotion) {
    autoKind = 'non-slide'
    confidence = dominantPerson ? 0.92 : 0.84
  } else if (
    hasPerson &&
    meaningfulPerson &&
    dominantPerson &&
    !smallOutsidePerson &&
    movingPersonBox
  ) {
    // A prominent moving person is stronger evidence than text-like stage lighting or logos.
    autoKind = 'non-slide'
    confidence = 0.86
  } else if (slideLikeCrop && hasTextEvidence && !dominantPerson) {
    autoKind = 'slide'
    confidence = stableSlide ? 0.9 : 0.76
  } else if (hasPerson && meaningfulPerson && !smallOutsidePerson && movingPersonBox) {
    autoKind = 'non-slide'
    confidence = dominantPerson ? 0.86 : 0.76
  } else if (hasPerson && meaningfulPerson && !smallOutsidePerson && !slideLikeCrop) {
    autoKind = 'non-slide'
    confidence = dominantPerson ? 0.76 : 0.68
  } else if (stableSlide && !hasPerson) {
    autoKind = 'slide'
    confidence = 0.88
  } else if (stableSlide && hasPerson && !dominantPerson) {
    autoKind = 'slide'
    confidence = 0.62
  }

  return {
    autoKind,
    personLayout,
    classification: {
      confidence,
      classifierVersion: VISUAL_CLASSIFIER_VERSION,
      visionEngineVersion:
        [people[0]?.engineVersion, text?.engineVersion].filter(Boolean).join('+') || undefined,
      evidence: {
        samplesAnalyzed: people.length,
        cropLongestStableRunRatio: cropLongestStableRun.ratio,
        cropLongestStableRunMs: cropLongestStableRun.durationMs,
        cropMotionMedian: median(cropDistances),
        textRegionCount,
        textRegionAreaRatio: textRegionArea,
        facePresenceRatio,
        humanPresenceRatio,
        largestFaceAreaRatio,
        largestHumanAreaRatio,
        personOutsideCropRatio,
        personCenterMotionMedian: motion.personCenterMotionMedian,
        personAreaChangeMedian: motion.personAreaChangeMedian,
        personBoxIouMedian: motion.personBoxIouMedian,
        faceLandmarkMotionMax,
      },
    },
  }
}

export function visualSampleTimestamps(startMs: number, endMs: number) {
  const duration = Math.max(0, endMs - startMs)
  const ratios =
    duration < 2_000
      ? [0.25, 0.75]
      : duration < 15_000
        ? [0.2, 0.5, 0.8]
        : [0.1, 0.3, 0.5, 0.7, 0.9]
  return ratios.map((ratio) => {
    const raw = startMs + duration * ratio
    const minimum = startMs + Math.min(300, duration / 2)
    const maximum = endMs - Math.min(300, duration / 2)
    return Math.round(Math.max(minimum, Math.min(maximum, raw)))
  })
}

const MAX_ADDITIONAL_PERSON_SAMPLES = 24

export function needsDensePersonSampling(
  segment: Pick<VisualSegment, 'autoKind' | 'personLayout' | 'classification'>,
) {
  const evidence = segment.classification?.evidence
  // A stable crop or OCR noise cannot distinguish a static speaker from a slide.
  // Dominant-person segments need denser motion evidence either way.
  return (
    segment.autoKind === 'unknown' &&
    segment.personLayout === 'dominant' &&
    evidence !== undefined &&
    (evidence.cropLongestStableRunRatio ?? evidence.cropStableRatio ?? 0) >=
      MIN_LONGEST_STABLE_RUN_RATIO
  )
}

export function additionalPersonSampleTimestamps(
  startMs: number,
  endMs: number,
  existingTimestamps: number[],
) {
  const duration = Math.max(0, endMs - startMs)
  if (duration <= 0) return []

  const targetSpacingMs = duration <= 3_000 ? 250 : duration <= 15_000 ? 500 : 1_000
  const intervalCount = Math.min(
    MAX_ADDITIONAL_PERSON_SAMPLES + 1,
    Math.max(1, Math.ceil(duration / targetSpacingMs)),
  )
  const timestamps: number[] = []

  for (let index = 1; index < intervalCount; index += 1) {
    const timestamp = Math.round(startMs + (duration * index) / intervalCount)
    if (
      existingTimestamps.some((existing) => Math.abs(existing - timestamp) < 100) ||
      timestamps.some((existing) => existing === timestamp)
    ) {
      continue
    }
    timestamps.push(timestamp)
  }

  return timestamps
}
