import { z } from 'zod'
import { UserFacingError } from '../errors'
import { executeSidecar } from '../tauri/sidecar'

const PointSchema = z.strictObject({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
})

const RegionSchema = z.strictObject({
  confidence: z.number().finite().min(0).max(1),
  polygon: z.array(PointSchema).length(4),
})

const FaceRegionSchema = RegionSchema.extend({
  landmarkSignature: z.array(z.number().finite()).min(1).optional(),
})

const PeopleDetectionResponseSchema = z.array(
  z.strictObject({
    imagePath: z.string().min(1),
    faces: z.array(FaceRegionSchema),
    humans: z.array(RegionSchema),
    engineVersion: z.string().min(1),
  }),
)

export type VisionRegion = z.infer<typeof RegionSchema>
export type PeopleDetection = z.infer<typeof PeopleDetectionResponseSchema>[number]

export const PEOPLE_DETECTION_BATCH_SIZE = 48

export function peopleDetectionBatches(
  imagePaths: string[],
  batchSize = PEOPLE_DETECTION_BATCH_SIZE,
) {
  const size = Math.max(1, Math.floor(batchSize))
  const batches: string[][] = []
  for (let index = 0; index < imagePaths.length; index += size) {
    batches.push(imagePaths.slice(index, index + size))
  }
  return batches
}

function outputText(output: { stdout: string | Uint8Array }) {
  return typeof output.stdout === 'string' ? output.stdout : new TextDecoder().decode(output.stdout)
}

export async function detectPeopleInImages({
  imagePaths,
  signal,
}: {
  imagePaths: string[]
  signal?: AbortSignal
}): Promise<{ detections: PeopleDetection[]; failedImagePaths: string[] }> {
  if (imagePaths.length === 0) return { detections: [], failedImagePaths: [] }
  const detections: PeopleDetection[] = []
  const failedImagePaths: string[] = []

  const batches = peopleDetectionBatches(imagePaths)
  for (const [index, batch] of batches.entries()) {
    try {
      const result = await detectPeopleBatch(batch, signal)
      detections.push(...result)
      const returned = new Set(result.map((detection) => detection.imagePath))
      failedImagePaths.push(...batch.filter((path) => !returned.has(path)))
    } catch (error) {
      if (signal?.aborted) throw new DOMException('処理を中止しました。', 'AbortError')
      failedImagePaths.push(...batch)
      console.warn(`人物検知バッチ ${index + 1} に失敗しました`, error)
    }
  }
  return { detections, failedImagePaths }
}

async function detectPeopleBatch(imagePaths: string[], signal?: AbortSignal) {
  const output = await executeSidecar(
    'binaries/apple-vision-ocr',
    ['--detect-people', ...imagePaths],
    {
      signal,
    },
  )
  if (output.code !== 0) {
    throw new Error(
      output.stderr.trim() || `Apple Vision人物検出が終了コード${output.code}で終了しました`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(outputText(output))
  } catch (error) {
    throw new UserFacingError('Apple Vision人物検出の応答を読み取れませんでした。', error)
  }
  const result = PeopleDetectionResponseSchema.safeParse(parsed)
  if (!result.success) {
    throw new UserFacingError('Apple Vision人物検出の応答形式が不正です。', result.error)
  }
  return result.data
}

export function regionBounds(region: VisionRegion) {
  const xs = region.polygon.map((point) => point.x)
  const ys = region.polygon.map((point) => point.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  const right = Math.max(...xs)
  const bottom = Math.max(...ys)
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

export function regionAreaRatio(region: VisionRegion) {
  const bounds = regionBounds(region)
  return Math.max(0, bounds.width) * Math.max(0, bounds.height)
}
