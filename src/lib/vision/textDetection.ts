import { z } from 'zod'
import { UserFacingError } from '../errors'
import { executeSidecar } from '../tauri/sidecar'

const PointSchema = z.strictObject({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
})

const TextRegionSchema = z.strictObject({
  confidence: z.number().finite().min(0).max(1),
  polygon: z.array(PointSchema).length(4),
})

const TextDetectionResponseSchema = z.array(
  z.strictObject({
    imagePath: z.string().min(1),
    textRegions: z.array(TextRegionSchema),
    engineVersion: z.string().min(1),
  }),
)

export type TextDetection = z.infer<typeof TextDetectionResponseSchema>[number]

const TEXT_DETECTION_BATCH_SIZE = 48

function outputText(output: { stdout: string | Uint8Array }) {
  return typeof output.stdout === 'string' ? output.stdout : new TextDecoder().decode(output.stdout)
}

export async function detectTextInImages({
  imagePaths,
  signal,
}: {
  imagePaths: string[]
  signal?: AbortSignal
}): Promise<TextDetection[]> {
  const detections: TextDetection[] = []
  for (let index = 0; index < imagePaths.length; index += TEXT_DETECTION_BATCH_SIZE) {
    const batch = imagePaths.slice(index, index + TEXT_DETECTION_BATCH_SIZE)
    const output = await executeSidecar(
      'binaries/apple-vision-ocr',
      ['--detect-text-regions', ...batch],
      { signal },
    )
    if (output.code !== 0) {
      throw new Error(
        output.stderr.trim() || `Apple Vision文字領域検出が終了コード${output.code}で終了しました`,
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(outputText(output))
    } catch (error) {
      throw new UserFacingError('Apple Vision文字領域検出の応答を読み取れませんでした。', error)
    }
    const result = TextDetectionResponseSchema.safeParse(parsed)
    if (!result.success) {
      throw new UserFacingError('Apple Vision文字領域検出の応答形式が不正です。', result.error)
    }
    detections.push(...result.data)
  }
  return detections
}

export function textRegionAreaRatio(region: TextDetection['textRegions'][number]) {
  const xs = region.polygon.map((point) => point.x)
  const ys = region.polygon.map((point) => point.y)
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
}
