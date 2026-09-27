import { RefreshCw, Square } from 'lucide-react'
import { ApiCostEstimate } from '../../../components/ApiCostEstimate'
import { OpenAiApiKeySettings } from '../../../components/OpenAiApiKeySettings'
import { ModelDescription } from '../../../components/ModelDescription'
import { ModelSelect } from '../../../components/ModelSelect'
import { ProcessingStatusRow } from '../../../components/ProcessingStatusRow'
import { estimateOpenAiOcrCost, representativeFrameDimensions } from '../../../lib/openai/cost'
import { ocrEligibleSegments } from '../../../lib/pipeline/articleBlocks'
import {
  APPLE_VISION_OCR_MODEL,
  getOcrModel,
  OPENAI_OCR_MODEL,
  OCR_LOCAL_MODELS,
  type OcrModel,
  type OcrModelId,
} from '../../../lib/ocr/modelManager'
import type { MediaProject } from '../../../types/project'
import type { OcrController } from '../hooks/useOcr'
import { ocrInputFingerprint } from '../ocr'

type OcrPanelProps = {
  project: MediaProject
  ocr: OcrController
  modelId: OcrModelId
  onModelChange: (modelId: OcrModelId) => void
  disabled?: boolean
}

const stageLabels = {
  'preparing-model': 'OCRモデルを確認・準備中…',
  recognizing: 'スライド画像を読み取り中…',
} as const

function formatModelSize(bytes: number) {
  return `${(bytes / 1024 ** 3).toFixed(2)}GB`
}

function assertNever(value: never): never {
  throw new Error(`未対応のOCRプロバイダーです: ${JSON.stringify(value)}`)
}

function OcrModelDetails({ model, disabled }: { model: OcrModel; disabled: boolean }) {
  switch (model.provider) {
    case 'vision':
      return (
        <ModelDescription
          description={model.description}
          annotation="代表画像をMac内で処理します。画像やOCR結果を外部へ送信せず、追加モデルのダウンロードもありません。"
        />
      )
    case 'local':
      return (
        <ModelDescription
          description={model.model.description}
          annotation={`初回のみモデルをダウンロードします（約${formatModelSize(model.model.totalSizeBytes)}）。画像は外部送信しません。`}
        />
      )
    case 'openai':
      return (
        <ModelDescription
          description={model.description}
          annotation="代表画像をOpenAIへ送信して処理します。動画・音声は送信しません。API利用料は設定したOpenAIアカウントに発生します。"
        >
          <OpenAiApiKeySettings
            verificationModel={model.apiModel}
            verificationLabel={model.label}
            billingNote="API利用料は、入力したAPIキーに紐づくOpenAI APIの請求先に発生します。"
            disabled={disabled}
          />
        </ModelDescription>
      )
    default:
      return assertNever(model)
  }
}

function progressRatio(ocr: OcrController) {
  if (ocr.status === 'completed') return 1
  if (ocr.status === 'cancelled') {
    return ocr.progress.total > 0 ? ocr.progress.completed / ocr.progress.total : 0
  }
  if (ocr.status !== 'running') return null
  if (ocr.stage === 'preparing-model') return ocr.progress.stageProgress
  return ocr.progress.total > 0 ? ocr.progress.completed / ocr.progress.total : 0
}

export function OcrPanel({
  project,
  ocr,
  modelId,
  onModelChange,
  disabled = false,
}: OcrPanelProps) {
  const isRunning = ocr.status === 'running'
  const isCompleted = ocr.status === 'completed'
  const total = ocr.progress.total
  const model = getOcrModel(modelId)
  const eligibleSlides = ocrEligibleSegments(project.slides, project.articleBlocks)
  const slidesToProcess = isCompleted
    ? eligibleSlides
    : eligibleSlides.filter(
        (slide) => slide.ocr?.inputFingerprint !== ocrInputFingerprint(slide, modelId),
      )
  const frameSize = representativeFrameDimensions(
    project.source.metadata.width,
    project.source.metadata.height,
  )
  const costEstimate =
    model.provider === 'openai'
      ? estimateOpenAiOcrCost({
          slideCount: slidesToProcess.length,
          imageWidth: frameSize.width,
          imageHeight: frameSize.height,
        })
      : undefined

  return (
    <section aria-labelledby="ocr-settings-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 id="ocr-settings-heading" className="text-[15px] font-semibold text-[#18211f]">
            画像データから文字を抽出
          </h3>
          <p className="mt-1 text-xs text-[#71807b]">
            macOS標準のApple Vision、ローカルモデル、またはOpenAI
            APIを選び、代表画像からスライド内の文字を抽出します。
          </p>
        </div>
        <button
          className={`inline-flex items-center justify-center gap-2 rounded-[9px] px-4 py-3 text-xs font-semibold shadow-[0_7px_16px_rgba(29,107,80,0.17)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${isRunning ? 'border border-[#d28d7a] bg-[#fff5f1] text-[#9d422d] shadow-none hover:bg-[#fbe8e2]' : 'bg-[#1d6b50] text-[#f3faf6] hover:bg-[#174d3c]'}`}
          type="button"
          onClick={() => {
            if (isRunning) {
              ocr.cancel()
              return
            }
            void ocr.recognize(isCompleted)
          }}
          disabled={disabled || (!isRunning && total === 0)}
          aria-label={isRunning ? 'OCRを停止' : undefined}
        >
          {isRunning ? <Square size={13} fill="currentColor" /> : <RefreshCw size={14} />}
          {isRunning ? '停止' : isCompleted ? '再OCR' : 'OCRを開始'}
        </button>
      </div>

      <div className="mt-4 rounded-[12px] border border-[#d8e1dc] bg-[#f7faf7] p-4 md:p-5">
        <label className="block text-xs text-[#71807b]" htmlFor="ocr-model">
          <span className="block font-semibold text-[#18211f]">使用モデル</span>
          <ModelSelect
            id="ocr-model"
            value={modelId}
            systemModels={[APPLE_VISION_OCR_MODEL]}
            localModels={OCR_LOCAL_MODELS}
            apiModels={[OPENAI_OCR_MODEL]}
            onChange={(nextModelId) => onModelChange(nextModelId as OcrModelId)}
            disabled={disabled || isRunning}
            aria-label="使用モデル"
          />
        </label>
        <OcrModelDetails model={model} disabled={disabled || isRunning} />
        <ApiCostEstimate isOpenAi={model.provider === 'openai'} estimate={costEstimate} />
      </div>
    </section>
  )
}

export function OcrStatus({ ocr, disabled = false }: Pick<OcrPanelProps, 'ocr' | 'disabled'>) {
  const isRunning = ocr.status === 'running'
  const isCompleted = ocr.status === 'completed'
  const isCancelled = ocr.status === 'cancelled'
  const progress = progressRatio(ocr)
  const progressLabel =
    isRunning && ocr.stage === 'preparing-model' && ocr.progress.stageProgress !== null
      ? `モデル ${Math.round(ocr.progress.stageProgress * 100)}%`
      : `${ocr.progress.completed} / ${ocr.progress.total} slides`
  const message = isRunning
    ? stageLabels[ocr.stage]
    : isCompleted
      ? 'すべてのSlideを処理しました。'
      : isCancelled
        ? 'OCRを停止しました。処理済みのSlideは保存されています。'
        : ocr.status === 'error'
          ? 'スライドOCRを完了できませんでした。'
          : 'まだ開始されていません。'

  return (
    <ProcessingStatusRow
      status={ocr.status}
      message={message}
      progress={progress}
      progressLabel={progressLabel}
      progressAriaLabel={isRunning ? stageLabels[ocr.stage] : 'OCRの進捗'}
      error={ocr.error}
      errorDetail={ocr.errorDetail}
      onRetry={() => ocr.recognize()}
      retryDisabled={disabled || isRunning}
    />
  )
}
