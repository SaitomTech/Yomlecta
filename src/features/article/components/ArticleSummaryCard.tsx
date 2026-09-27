import { RefreshCw, Square } from 'lucide-react'
import { ArticleModelDetails } from '../../../components/ArticleModelDetails'
import { ApiCostEstimate } from '../../../components/ApiCostEstimate'
import { ModelSelect } from '../../../components/ModelSelect'
import { ProcessingStatusRow } from '../../../components/ProcessingStatusRow'
import {
  APPLE_FOUNDATION_MODELS,
  OPENAI_LUNA_MODEL,
  getArticleModel,
  type ArticleModelId,
} from '../../../lib/article/articleModel'
import { TEXT_MODELS } from '../../../lib/llama/textModel'
import { estimateOpenAiSummaryCost } from '../../../lib/openai/cost'
import type { ArticleSummary, MediaProject } from '../../../types/project'
import { articleSummaryInput } from '../article'
import type { ArticleSummaryController } from '../hooks/useArticleSummary'

type ArticleSummaryCardProps = {
  project: MediaProject
  summary?: ArticleSummary
  generation: ArticleSummaryController
  modelId: ArticleModelId
  onModelChange: (modelId: ArticleModelId) => void
  disabled?: boolean
  onGenerate: (force: boolean) => void
  onCancel: () => void
}

function summaryButtonLabel(generation: ArticleSummaryController, hasSummary: boolean) {
  if (generation.isUpToDate) return '要約を再生成'
  return hasSummary ? '要約を更新' : '要約を生成'
}

function summaryStatusUi(
  generation: ArticleSummaryController,
  summary: ArticleSummary | undefined,
) {
  const isRunning = generation.status === 'running'
  let message = 'まだ開始されていません。'
  if (isRunning) {
    message =
      generation.stage === 'preparing-model'
        ? '文章処理モデルを準備中…'
        : '生成済み本文から文書全体の要約を生成中…'
  } else if (generation.status === 'completed') {
    message = '文書全体の要約を生成しました。'
  } else if (generation.status === 'cancelled') {
    message = '生成を停止しました。'
  } else if (generation.status === 'error') {
    message = '文書全体の要約を生成できませんでした。'
  } else if (generation.hasAllArticleBodies) {
    message = '本文全体を要約できます。'
  } else {
    message = '先に本文を生成してください。'
  }

  const progress =
    generation.status === 'completed'
      ? 1
      : generation.stage === 'preparing-model'
        ? generation.stageProgress
        : null
  const isPreparing =
    isRunning && generation.stage === 'preparing-model' && generation.stageProgress !== null

  return {
    message,
    progress,
    progressLabel: isPreparing
      ? `モデル ${Math.round(generation.stageProgress! * 100)}%`
      : summary
        ? '生成済み'
        : '未生成',
  }
}

export function ArticleSummaryCard({
  project,
  summary,
  generation,
  modelId,
  onModelChange,
  disabled = false,
  onGenerate,
  onCancel,
}: ArticleSummaryCardProps) {
  const isRunning = generation.status === 'running'
  const hasSummary = Boolean(summary)
  const buttonLabel = summaryButtonLabel(generation, hasSummary)
  const statusUi = summaryStatusUi(generation, summary)
  const summaryModel = getArticleModel(modelId)
  const costEstimate =
    summaryModel.provider === 'openai'
      ? estimateOpenAiSummaryCost(articleSummaryInput(project).length)
      : undefined

  return (
    <section className="mt-5" aria-labelledby="article-summary-heading">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="article-summary-heading" className="text-[21px] font-bold tracking-[-0.05em]">
              文書全体の要約
            </h2>
            <p className="mt-1 text-xs leading-5 text-[#71807b]">
              発話がある区間の生成済み本文から、伝えたいことと重要ポイントを整理します。
            </p>
          </div>
          <button
            className={`inline-flex items-center justify-center gap-2 rounded-[9px] px-4 py-3 text-xs font-semibold shadow-[0_7px_16px_rgba(29,107,80,0.17)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${isRunning ? 'border border-[#d28d7a] bg-[#fff5f1] text-[#9d422d] shadow-none hover:bg-[#fbe8e2]' : 'bg-[#1d6b50] text-[#f3faf6] hover:bg-[#174d3c]'}`}
            type="button"
            onClick={() => (isRunning ? onCancel() : onGenerate(generation.isUpToDate))}
            disabled={isRunning ? false : disabled || !generation.hasAllArticleBodies}
          >
            {isRunning ? <Square size={13} fill="currentColor" /> : <RefreshCw size={14} />}
            {isRunning ? '停止' : buttonLabel}
          </button>
        </div>
        {!generation.hasAllArticleBodies && (
          <p className="mt-4 rounded-[8px] border border-[#ead8a8] bg-[#fffaf0] px-3 py-2 text-xs leading-5 text-[#8b6a2b]">
            発話がある区間の本文を生成すると、文書全体の要約を作成できます。無音区間の本文は不要です。
          </p>
        )}
        <div className="mt-4 rounded-[12px] border border-[#d8e1dc] bg-[#f7faf7] p-4 md:p-5">
          <label className="block text-xs text-[#71807b]" htmlFor="article-summary-model">
            <span className="block font-semibold text-[#18211f]">要約に使うモデル</span>
            <ModelSelect
              id="article-summary-model"
              value={modelId}
              systemModels={[APPLE_FOUNDATION_MODELS]}
              localModels={TEXT_MODELS}
              apiModels={[OPENAI_LUNA_MODEL]}
              onChange={(nextModelId) => onModelChange(nextModelId as ArticleModelId)}
              disabled={disabled || isRunning}
              aria-label="要約に使うモデル"
            />
          </label>
          <ArticleModelDetails model={summaryModel} disabled={disabled || isRunning} />
          <ApiCostEstimate isOpenAi={summaryModel.provider === 'openai'} estimate={costEstimate} />
        </div>
      </header>
      <ProcessingStatusRow
        compact
        status={generation.status}
        message={statusUi.message}
        progress={statusUi.progress}
        progressLabel={statusUi.progressLabel}
        progressAriaLabel="文書全体の要約生成の進捗"
        error={generation.error}
        onRetry={() => void generation.generate()}
        retryDisabled={disabled || isRunning || !generation.hasAllArticleBodies}
      />
    </section>
  )
}
