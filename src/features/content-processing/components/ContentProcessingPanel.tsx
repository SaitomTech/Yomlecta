import {
  assignedArticleSlides,
  boundarySourceSlides,
  currentBoundaryPlan,
  createBoundaryPlan,
  boundaryPrompt,
  boundaryInputFingerprint,
} from '../../../lib/pipeline/transcriptBoundaries'
import { BOUNDARY_PROMPT } from '../articleGenerator'
import { RefreshCw, Square } from 'lucide-react'
import { ArticleModelDetails } from '../../../components/ArticleModelDetails'
import { ApiCostEstimate } from '../../../components/ApiCostEstimate'
import { ModelSelect } from '../../../components/ModelSelect'
import { ProcessingStatusRow } from '../../../components/ProcessingStatusRow'
import { estimateOpenAiArticleCost } from '../../../lib/openai/cost'
import type { MediaProject } from '../../../types/project'
import {
  APPLE_FOUNDATION_MODELS,
  OPENAI_LUNA_MODEL,
  type ArticleModel,
  type ArticleModelId,
} from '../../../lib/article/articleModel'
import { TEXT_MODELS } from '../../../lib/llama/textModel'
import type { ContentProcessingController } from '../hooks/useContentProcessing'
import { hasCurrentContent } from '../contentProcessing'

type ContentProcessingPanelProps = {
  project: MediaProject
  processing: ContentProcessingController
  model: ArticleModel
  modelId: ArticleModelId
  onModelChange: (modelId: ArticleModelId) => void
  disabled?: boolean
}

const stageLabels = {
  'preparing-model': '文章処理モデルを確認・準備中…',
  'adjusting-boundaries': '文字起こしの区切りを調整しています…',
  processing: 'Slideごとに本文を生成中…',
} as const

function progressRatio(processing: ContentProcessingController) {
  if (processing.status === 'completed') return 1
  if (processing.status === 'cancelled') {
    return processing.progress.total > 0
      ? processing.progress.completed / processing.progress.total
      : 0
  }
  if (processing.status !== 'running') return null
  if (processing.stage === 'preparing-model') return processing.progress.stageProgress
  return processing.progress.total > 0
    ? processing.progress.completed / processing.progress.total
    : 0
}

export function ContentProcessingPanel({
  project,
  processing,
  model,
  modelId,
  onModelChange,
  disabled = false,
}: ContentProcessingPanelProps) {
  const isRunning = processing.status === 'running'
  const isCompleted = processing.status === 'completed'
  const total = processing.progress.total
  const contextSlides = assignedArticleSlides(project)
  const targetSlides = contextSlides.filter((slide) => slide.transcript?.raw.trim())
  const slidesToProcess = isCompleted
    ? targetSlides
    : targetSlides.filter((slide) => !hasCurrentContent(slide, modelId))
  const sourceSlides = boundarySourceSlides(project)
  const savedPlan = currentBoundaryPlan(project)
  const initialPlan = createBoundaryPlan(sourceSlides)
  const boundaryInputs = initialPlan.boundaries.flatMap((_, index) => {
    const cached = savedPlan?.boundaries[index]
    return cached?.status !== 'fallback' &&
      cached?.inputFingerprint === boundaryInputFingerprint(sourceSlides, index, modelId)
      ? []
      : [BOUNDARY_PROMPT.length + boundaryPrompt(sourceSlides, index).length]
  })
  const costEstimate =
    model.provider === 'openai'
      ? estimateOpenAiArticleCost({
          boundaryInputs,
          slides: slidesToProcess.map((slide) => ({
            transcriptCharacters: slide.transcript?.raw.length ?? 0,
            ocrCharacters: slide.ocr?.rawText.length ?? 0,
          })),
        })
      : undefined
  return (
    <section aria-labelledby="content-processing-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 id="content-processing-heading" className="text-[21px] font-bold tracking-[-0.05em]">
            OCR補正を使って本文を生成
          </h3>
          <p className="mt-1 text-xs text-[#71807b]">
            スライドと音声の文字起こしをもとに、記事本文を生成します。
          </p>
        </div>
        <button
          className={`inline-flex items-center justify-center gap-2 rounded-[9px] px-4 py-3 text-xs font-semibold shadow-[0_7px_16px_rgba(29,107,80,0.17)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${isRunning ? 'border border-[#d28d7a] bg-[#fff5f1] text-[#9d422d] shadow-none hover:bg-[#fbe8e2]' : 'bg-[#1d6b50] text-[#f3faf6] hover:bg-[#174d3c]'}`}
          type="button"
          onClick={() => {
            if (isRunning) {
              processing.cancel()
              return
            }
            void processing.process(isCompleted)
          }}
          disabled={disabled || (!isRunning && total === 0)}
          aria-label={isRunning ? '本文の生成を停止' : undefined}
        >
          {isRunning ? <Square size={13} fill="currentColor" /> : <RefreshCw size={14} />}
          {isRunning ? '停止' : isCompleted ? '再生成' : '生成を開始'}
        </button>
      </div>

      <div className="mt-4 rounded-[12px] border border-[#d8e1dc] bg-[#f7faf7] p-4 md:p-5">
        <label className="block text-xs text-[#71807b]" htmlFor="article-generation-model">
          <span className="block font-semibold text-[#18211f]">使用モデル</span>
          <ModelSelect
            id="article-generation-model"
            value={modelId}
            systemModels={[APPLE_FOUNDATION_MODELS]}
            localModels={TEXT_MODELS}
            apiModels={[OPENAI_LUNA_MODEL]}
            onChange={(nextModelId) => onModelChange(nextModelId as ArticleModelId)}
            disabled={disabled || isRunning}
            aria-label="使用モデル"
          />
        </label>
        <ArticleModelDetails model={model} disabled={disabled || isRunning} />
        <ApiCostEstimate isOpenAi={model.provider === 'openai'} estimate={costEstimate} />
      </div>
    </section>
  )
}

function processingStatusMessage(processing: ContentProcessingController) {
  switch (processing.status) {
    case 'running':
      return stageLabels[processing.stage]
    case 'completed': {
      const skipped = processing.skippedSlides
        .map((slide) => `Slide ${slide.slideIndex + 1}`)
        .join('、')
      const message = skipped
        ? `記事本文の生成が完了しました。${skipped}はスキップしました。`
        : '記事本文をすべて生成しました。'
      return processing.boundaryFallbacks > 0
        ? `${message} ${processing.boundaryFallbacks}か所は元の区切りを使用しました。`
        : message
    }
    case 'cancelled':
      return '生成を停止しました。処理済みのSlideは保存されています。'
    case 'error':
      return '記事本文の生成を完了できませんでした。'
    default:
      return processing.progress.total === 0
        ? '先に文字起こしを実行してください。'
        : 'まだ開始されていません。'
  }
}

export function ContentProcessingStatus({
  processing,
  disabled = false,
}: {
  processing: ContentProcessingController
  disabled?: boolean
}) {
  const isRunning = processing.status === 'running'
  const progress = progressRatio(processing)
  const progressLabel =
    isRunning &&
    processing.stage === 'preparing-model' &&
    processing.progress.stageProgress !== null
      ? `モデル ${Math.round(processing.progress.stageProgress * 100)}%`
      : `${processing.progress.completed} / ${processing.progress.total} ${processing.stage === 'adjusting-boundaries' ? 'か所' : 'slides'}`
  return (
    <div>
      <ProcessingStatusRow
        compact
        status={processing.status}
        message={processingStatusMessage(processing)}
        progress={progress}
        progressLabel={progressLabel}
        progressAriaLabel={isRunning ? stageLabels[processing.stage] : '記事本文生成の進捗'}
        error={processing.error}
        onRetry={processing.retry}
        retryDisabled={disabled || isRunning || processing.progress.total === 0}
      />
    </div>
  )
}
