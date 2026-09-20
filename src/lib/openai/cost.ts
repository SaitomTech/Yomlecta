const OPENAI_TRANSCRIPTION_USD_PER_MINUTE = 0.0045
const OPENAI_INPUT_USD_PER_MILLION_TOKENS = 0.2
const OPENAI_OUTPUT_USD_PER_MILLION_TOKENS = 1.2

/** Deliberately conservative display-only conversion for the Japanese UI. */
export const DISPLAY_USD_TO_JPY = 160

const APPROX_CHARS_PER_TOKEN = 1.5
const OCR_INSTRUCTION_TOKENS = 160
const OCR_OUTPUT_TOKENS = 200
const ARTICLE_INSTRUCTION_TOKENS = 3_000
const ARTICLE_OUTPUT_MIN_TOKENS = 120
const SUMMARY_INSTRUCTION_TOKENS = 500
const SUMMARY_OUTPUT_TOKENS = 450
const SECTIONS_INSTRUCTION_TOKENS = 700
const SECTIONS_OUTPUT_TOKENS = 500

export type OpenAiCostEstimate = {
  usd: number
  inputTokens?: number
  outputTokens?: number
}

function costForTokens(inputTokens: number, outputTokens: number): OpenAiCostEstimate {
  return {
    usd:
      (inputTokens / 1_000_000) * OPENAI_INPUT_USD_PER_MILLION_TOKENS +
      (outputTokens / 1_000_000) * OPENAI_OUTPUT_USD_PER_MILLION_TOKENS,
    inputTokens,
    outputTokens,
  }
}

function estimateTextTokens(characters: number) {
  return Math.ceil(Math.max(0, characters) / APPROX_CHARS_PER_TOKEN)
}

export function estimateOpenAiTranscriptionCost(durationMs: number): OpenAiCostEstimate {
  const minutes = Math.max(0, durationMs) / 60_000
  return { usd: minutes * OPENAI_TRANSCRIPTION_USD_PER_MINUTE }
}

export function representativeFrameDimensions(cropWidth: number, cropHeight: number) {
  const width = 1280
  const height = Math.max(
    2,
    Math.floor((width * Math.max(1, cropHeight)) / Math.max(1, cropWidth) / 2) * 2,
  )
  return { width, height }
}

export function originalImageTokens(width: number, height: number) {
  const patches = Math.ceil(Math.max(1, width) / 32) * Math.ceil(Math.max(1, height) / 32)
  return Math.ceil(patches * 1.2)
}

export function estimateOpenAiOcrCost({
  slideCount,
  imageWidth,
  imageHeight,
}: {
  slideCount: number
  imageWidth: number
  imageHeight: number
}): OpenAiCostEstimate {
  const count = Math.max(0, slideCount)
  const inputTokens =
    count * (originalImageTokens(imageWidth, imageHeight) + OCR_INSTRUCTION_TOKENS)
  return costForTokens(inputTokens, count * OCR_OUTPUT_TOKENS)
}

export function estimateOpenAiArticleCost({
  slides,
}: {
  slides: Array<{ transcriptCharacters: number; ocrCharacters: number }>
}): OpenAiCostEstimate {
  const inputTokens = slides.reduce(
    (total, slide) =>
      total +
      ARTICLE_INSTRUCTION_TOKENS +
      estimateTextTokens(slide.transcriptCharacters + slide.ocrCharacters),
    0,
  )
  const outputTokens = slides.reduce(
    (total, slide) =>
      total + Math.max(ARTICLE_OUTPUT_MIN_TOKENS, estimateTextTokens(slide.transcriptCharacters)),
    0,
  )
  return costForTokens(inputTokens, outputTokens)
}

export function estimateOpenAiSummaryCost(articleCharacters: number): OpenAiCostEstimate {
  return costForTokens(
    SUMMARY_INSTRUCTION_TOKENS + estimateTextTokens(articleCharacters),
    SUMMARY_OUTPUT_TOKENS,
  )
}

export function estimateOpenAiSectionsCost(articleCharacters: number): OpenAiCostEstimate {
  return costForTokens(
    SECTIONS_INSTRUCTION_TOKENS + estimateTextTokens(articleCharacters),
    SECTIONS_OUTPUT_TOKENS,
  )
}

export function formatOpenAiCost(usd: number) {
  const yen = usd * DISPLAY_USD_TO_JPY
  const usdLabel = usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
  return {
    usdLabel,
    yenLabel: `約¥${yen.toFixed(2)}`,
  }
}
