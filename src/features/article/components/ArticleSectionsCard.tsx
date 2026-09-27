import { RefreshCw, Square } from 'lucide-react'
import { ArticleModelDetails } from '../../../components/ArticleModelDetails'
import { ApiCostEstimate } from '../../../components/ApiCostEstimate'
import { ModelSelect } from '../../../components/ModelSelect'
import { ProcessingStatusRow } from '../../../components/ProcessingStatusRow'
import {
  APPLE_FOUNDATION_MODELS,
  OPENAI_LUNA_MODEL,
  type ArticleModel,
  type ArticleModelId,
} from '../../../lib/article/articleModel'
import { TEXT_MODELS } from '../../../lib/llama/textModel'
import { estimateOpenAiSectionsCost } from '../../../lib/openai/cost'
import type { ArticleSections, MediaProject } from '../../../types/project'
import { articleSectionsInput } from '../article'
import type { ArticleSectionsController } from '../hooks/useArticleSections'

type ArticleSectionsCardProps = {
  project: MediaProject
  sections?: ArticleSections
  generation: ArticleSectionsController
  model: ArticleModel
  modelId: ArticleModelId
  onModelChange: (modelId: ArticleModelId) => void
  onGenerate: (force: boolean) => void
  onCancel: () => void
  disabled?: boolean
}

function sectionsStatusUi(
  generation: ArticleSectionsController,
  sections: ArticleSections | undefined,
) {
  const isRunning = generation.status === 'running'
  let message = 'まだ開始されていません。'
  if (isRunning) {
    message =
      generation.stage === 'preparing-model'
        ? '文章処理モデルを準備中…'
        : '生成済み本文をテーマごとに整理中…'
  } else if (generation.status === 'completed') {
    message = 'セクションを生成しました。2の確認・編集で構成を調整できます。'
  } else if (generation.status === 'cancelled') {
    message = '生成を停止しました。'
  } else if (generation.status === 'error') {
    message = 'セクションを生成できませんでした。'
  } else if (generation.hasAllArticleBodies) {
    message = '記事の確認・編集で、セクションの追加・見出し編集・区切りの調整ができます。'
  } else {
    message = '発話がある区間の本文を先に生成してください。無音区間の本文は不要です。'
  }

  const progress =
    generation.status === 'completed'
      ? 1
      : generation.stage === 'preparing-model'
        ? generation.stageProgress
        : null
  const progressLabel =
    isRunning && generation.stage === 'preparing-model' && generation.stageProgress !== null
      ? `モデル ${Math.round(generation.stageProgress * 100)}%`
      : sections
        ? `${sections.sections.length}セクション`
        : '未生成'

  return { message, progress, progressLabel }
}

export function ArticleSectionsCard({
  project,
  sections,
  generation,
  model,
  modelId,
  onModelChange,
  onGenerate,
  onCancel,
  disabled = false,
}: ArticleSectionsCardProps) {
  const isRunning = generation.status === 'running'
  const statusUi = sectionsStatusUi(generation, sections)
  const costEstimate =
    model.provider === 'openai'
      ? estimateOpenAiSectionsCost(articleSectionsInput(project).length)
      : undefined

  return (
    <section aria-labelledby="article-sections-heading">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="article-sections-heading" className="text-[21px] font-bold tracking-[-0.05em]">
              セクション構成の生成
            </h2>
            <p className="mt-1 text-xs leading-5 text-[#71807b]">
              OCR補正済みの本文をテーマごとに整理します。生成後の追加・編集は、下の確認・編集画面で行えます。
            </p>
          </div>
          <button
            className={`inline-flex items-center gap-2 rounded-[9px] px-4 py-3 text-xs font-semibold shadow-[0_7px_16px_rgba(29,107,80,0.17)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${isRunning ? 'border border-[#d28d7a] bg-[#fff5f1] text-[#9d422d] shadow-none hover:bg-[#fbe8e2]' : 'bg-[#1d6b50] text-[#f3faf6] hover:bg-[#174d3c]'}`}
            type="button"
            onClick={() => (isRunning ? onCancel() : onGenerate(Boolean(sections)))}
            disabled={disabled || (!isRunning && !generation.hasAllArticleBodies)}
          >
            {isRunning ? <Square size={13} fill="currentColor" /> : <RefreshCw size={14} />}
            {isRunning ? '停止' : sections ? '再生成' : 'セクションを生成'}
          </button>
        </div>

        <div className="mt-4 rounded-[12px] border border-[#d8e1dc] bg-[#f7faf7] p-4 md:p-5">
          <label className="block text-xs text-[#71807b]" htmlFor="article-sections-model">
            <span className="block font-semibold text-[#18211f]">使用モデル</span>
            <ModelSelect
              id="article-sections-model"
              value={modelId}
              systemModels={[APPLE_FOUNDATION_MODELS]}
              localModels={TEXT_MODELS}
              apiModels={[OPENAI_LUNA_MODEL]}
              onChange={(nextModelId) => onModelChange(nextModelId as ArticleModelId)}
              disabled={disabled || isRunning}
              aria-label="セクション生成に使うモデル"
            />
          </label>
          <ArticleModelDetails model={model} disabled={disabled || isRunning} />
          <ApiCostEstimate isOpenAi={model.provider === 'openai'} estimate={costEstimate} />
        </div>
      </header>
      <ProcessingStatusRow
        compact
        status={generation.status}
        message={statusUi.message}
        progress={statusUi.progress}
        progressLabel={statusUi.progressLabel}
        progressAriaLabel="セクション生成の進捗"
        error={generation.error}
        onRetry={() => void generation.generate()}
        retryDisabled={disabled || isRunning || !generation.hasAllArticleBodies}
      />
    </section>
  )
}
