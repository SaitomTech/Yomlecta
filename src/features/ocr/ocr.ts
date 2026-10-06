import { readFile } from '@tauri-apps/plugin-fs'
import { mapWithConcurrency } from '../../lib/async/mapWithConcurrency'
import { UserFacingError, withUserFacingError } from '../../lib/errors'
import { completeChat } from '../../lib/llama/chat'
import { withLlamaServer } from '../../lib/llama/server'
import { recognizeOpenAiImage, getOpenAiApiKeyStatus } from '../../lib/openai/openai'
import { recognizeVisionImage } from '../../lib/ocr/vision'
import {
  DEFAULT_OCR_MODEL,
  ensureOcrModel,
  getOcrModel,
  type OcrModel,
  type OcrModelId,
} from '../../lib/ocr/modelManager'
import { modelProgressRatio } from '../../lib/models/download'
import { ocrEligibleSegments } from '../../lib/pipeline/articleBlocks'
import type { ArticleContext, SlideData, SlideOcrResult } from '../../types/project'

const OCR_PROMPT_VERSION = 'text-recognition-v4'
const MAX_OPENAI_OCR_REQUESTS = 4

export type OcrStage = 'preparing-model' | 'recognizing'

export type OcrProgress = {
  completed: number
  total: number
  stageProgress: number | null
}

export type OcrSlideCompleted = (
  results: Array<{ slideId: string; ocr: SlideOcrResult }>,
) => void | Promise<void>

type RunOcrInput = {
  project: ArticleContext
  onStage?: (stage: OcrStage) => void
  onProgress?: (progress: OcrProgress) => void
  onSlideCompleted?: OcrSlideCompleted
  signal?: AbortSignal
  force?: boolean
  modelId?: OcrModelId
}

type OcrRecognition = {
  rawText: string
  blocks?: SlideOcrResult['blocks']
  engineVersion?: string
  language?: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
  requestId?: string
}

function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('OCRを中止しました。', 'AbortError')
}

export function ocrInputFingerprint(slide: SlideData, modelId: OcrModelId = DEFAULT_OCR_MODEL.id) {
  return JSON.stringify([
    slide.id,
    slide.image.representativeFramePath ?? '',
    slide.startMs,
    slide.endMs,
    slide.detection.hash ?? '',
    modelId,
    OCR_PROMPT_VERSION,
  ])
}

async function imageDataFor(slide: SlideData) {
  const imagePath = slide.image.representativeFramePath
  if (!imagePath) throw new UserFacingError(`Slide ${slide.index + 1}の代表画像がありません。`)

  const image = toBase64(await readFile(imagePath))
  return `data:image/jpeg;base64,${image}`
}

async function recognizeLocalSlide(
  baseUrl: string,
  slide: SlideData,
  model: Extract<OcrModel, { provider: 'local' }>,
  signal?: AbortSignal,
) {
  const imageData = await imageDataFor(slide)
  const rawText = await completeChat(baseUrl, {
    model: model.id,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageData } },
          { type: 'text', text: model.model.prompt },
        ],
      },
    ],
    temperature: 0.02,
    maxTokens: 8192,
    signal,
  })
  return { rawText }
}

async function recognizeOpenAiSlide(
  slide: SlideData,
  model: Extract<OcrModel, { provider: 'openai' }>,
  signal?: AbortSignal,
) {
  const result = await recognizeOpenAiImage({
    instructions: model.prompt,
    imageData: await imageDataFor(slide),
    signal,
  })
  return {
    rawText: result.text,
    usage: result.usage,
    requestId: result.requestId,
  }
}

async function recognizeVisionSlide(
  slide: SlideData,
  model: Extract<OcrModel, { provider: 'vision' }>,
  signal?: AbortSignal,
) {
  const imagePath = slide.image.representativeFramePath
  if (!imagePath) throw new UserFacingError(`Slide ${slide.index + 1}の代表画像がありません。`)

  const recognition = await recognizeVisionImage({
    imagePath,
    language: model.language,
    signal,
  })

  return { ...recognition, language: model.language }
}

export async function runOcr({
  project,
  onStage,
  onProgress,
  onSlideCompleted,
  signal,
  force = false,
  modelId = DEFAULT_OCR_MODEL.id,
}: RunOcrInput) {
  const slides = ocrEligibleSegments(project.article.visualSegments, project.article.blocks)
  if (slides.length === 0) {
    throw new UserFacingError('OCRするSlideがありません。先にスライド検出を実行してください。')
  }
  if (slides.some((slide) => !slide.image.representativeFramePath)) {
    throw new UserFacingError(
      '代表画像のないSlideがあります。スライド検出をもう一度実行してください。',
    )
  }

  const pendingSlides = force
    ? slides
    : slides.filter((slide) => slide.ocr?.inputFingerprint !== ocrInputFingerprint(slide, modelId))
  let completed = slides.length - pendingSlides.length
  const report = (stageProgress: number | null) => {
    onProgress?.({
      completed,
      total: slides.length,
      stageProgress,
    })
  }

  report(pendingSlides.length === 0 ? 1 : null)
  if (pendingSlides.length === 0) return

  const ocrModel = getOcrModel(modelId)
  throwIfAborted(signal)
  onStage?.('preparing-model')
  const localModel = await withUserFacingError(
    'OCRモデルまたはOpenAI APIを準備できませんでした。設定と通信状況を確認して、再試行してください。',
    async () => {
      if (ocrModel.provider === 'openai') {
        const status = await getOpenAiApiKeyStatus()
        if (!status.configured) throw new Error('OpenAI APIキーが設定されていません。')
        return null
      }

      if (ocrModel.provider === 'vision') return null

      return ensureOcrModel({
        modelId,
        signal,
        onProgress: (progress) => report(modelProgressRatio(progress)),
      })
    },
  )

  const processSlides = async (
    recognize: (slide: SlideData) => Promise<OcrRecognition>,
    concurrency = 1,
  ) => {
    throwIfAborted(signal)
    onStage?.('recognizing')
    report(null)
    const batch: Array<{ slideId: string; ocr: SlideOcrResult; slideIndex: number }> = []
    // Recognition may finish out of order; project writes must remain serialized.
    let completionTail = Promise.resolve()
    const flush = async () => {
      if (batch.length === 0) return
      const pending = batch.splice(0)
      await withUserFacingError(
        `Slide ${pending[0].slideIndex + 1}以降のOCR結果を保存できませんでした。空き容量を確認して、再試行してください。`,
        () => onSlideCompleted?.(pending.map(({ slideId, ocr }) => ({ slideId, ocr }))),
      )
      completed += pending.length
      report(null)
    }
    const completeSlide = (slide: SlideData, recognition: OcrRecognition) => {
      const completion = completionTail.then(async () => {
        throwIfAborted(signal)
        batch.push({
          slideId: slide.id,
          slideIndex: slide.index,
          ocr: {
            rawText: recognition.rawText,
            model: modelId,
            provider: ocrModel.provider,
            blocks: recognition.blocks,
            engineVersion: recognition.engineVersion,
            language: recognition.language,
            usage: recognition.usage,
            requestId: recognition.requestId,
            inputFingerprint: ocrInputFingerprint(slide, modelId),
          },
        })
        if (batch.length >= 8) await flush()
      })
      completionTail = completion
      return completion
    }
    try {
      await mapWithConcurrency(
        pendingSlides,
        concurrency,
        async (slide) => {
          const recognition = await withUserFacingError(
            `Slide ${slide.index + 1}の文字を読み取れませんでした。再試行してください。`,
            () => recognize(slide),
          )
          await completeSlide(slide, recognition)
        },
        signal,
      )
    } finally {
      await completionTail
      await flush()
    }
  }

  if (ocrModel.provider === 'openai') {
    report(1)
    await withUserFacingError(
      'OpenAI OCRを完了できませんでした。APIキーと利用上限、通信状況を確認してください。',
      () =>
        processSlides(
          (slide) => recognizeOpenAiSlide(slide, ocrModel, signal),
          MAX_OPENAI_OCR_REQUESTS,
        ),
    )
    return
  }

  if (ocrModel.provider === 'vision') {
    report(1)
    await withUserFacingError(
      'Apple Vision OCRを完了できませんでした。macOSの環境と代表画像を確認して、再試行してください。',
      () => processSlides((slide) => recognizeVisionSlide(slide, ocrModel, signal)),
    )
    return
  }

  if (!localModel) throw new Error('ローカルOCRモデルの準備結果がありません。')
  await withUserFacingError(
    'OCRエンジンを起動または実行できませんでした。アプリを再起動して、再試行してください。',
    () =>
      withLlamaServer(
        localModel,
        (baseUrl) =>
          processSlides((slide) => recognizeLocalSlide(baseUrl, slide, ocrModel, signal)),
        signal,
      ),
  )
}
