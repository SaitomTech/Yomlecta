import { Languages, Play, RefreshCw, Square } from 'lucide-react'
import { useMemo } from 'react'
import { ApiCostEstimate } from '../../../components/ApiCostEstimate'
import { ModelSelect } from '../../../components/ModelSelect'
import { OpenAiApiKeySettings } from '../../../components/OpenAiApiKeySettings'
import { ProcessingStatusRow } from '../../../components/ProcessingStatusRow'
import { OPENAI_LUNA_MODEL } from '../../../lib/article/articleModel'
import { estimateOpenAiTranslationCost } from '../../../lib/openai/cost'
import type { ArticleTranslationLanguage, ArticleContext } from '../../../types/project'
import type { ArticleTranslationController } from '../hooks/useArticleTranslation'
import { articleLanguageLabel } from '../articleLanguage'
import {
  TRANSLATION_ENGINES,
  TRANSLATION_LANGUAGES,
  articleTranslationSegmentCharacterCounts,
  type TranslationEngineId,
} from '../translation'

export function ArticleTranslationCard({
  project,
  sourceLanguage,
  targetLanguage,
  engineId,
  includeInBatch,
  generation,
  onSourceLanguageChange,
  onTargetLanguageChange,
  onEngineChange,
  onIncludeInBatchChange,
  onTranslate,
  onCancel,
  disabled = false,
}: {
  project: ArticleContext
  sourceLanguage: ArticleTranslationLanguage
  targetLanguage: ArticleTranslationLanguage
  engineId: TranslationEngineId
  includeInBatch: boolean
  generation: ArticleTranslationController
  onSourceLanguageChange: (language: ArticleTranslationLanguage) => void
  onTargetLanguageChange: (language: ArticleTranslationLanguage) => void
  onEngineChange: (engine: TranslationEngineId) => void
  onIncludeInBatchChange: (include: boolean) => void
  onTranslate: () => void
  onCancel: () => void
  disabled?: boolean
}) {
  const saved = project.article.document?.translations?.[targetLanguage]
  const translation = generation.currentTranslation ?? saved
  const isStale = Boolean(saved && !generation.currentTranslation)
  const isRunning = generation.status === 'running'
  const hasArticleBody = project.article.blocks.some((slide) =>
    slide.transcript?.articleBody?.trim(),
  )
  const localPairSupported =
    ['ja', 'en'].includes(sourceLanguage) &&
    ['ja', 'en'].includes(targetLanguage) &&
    sourceLanguage !== targetLanguage
  const isOpenAi = engineId === 'openai:gpt-6-luna'
  const costEstimate = useMemo(
    () =>
      isOpenAi
        ? estimateOpenAiTranslationCost(articleTranslationSegmentCharacterCounts(project))
        : undefined,
    [isOpenAi, project],
  )

  const statusMessage = isRunning
    ? generation.stage === 'preparing-model'
      ? '翻訳モデルを準備しています…'
      : '記事タイトル・本文・要約・章見出しを翻訳しています…'
    : generation.status === 'completed'
      ? `${articleLanguageLabel(targetLanguage)}への翻訳が完了しました。`
      : generation.status === 'cancelled'
        ? '翻訳を停止しました。'
        : isStale
          ? '原文または言語設定が更新されています。再翻訳してください。'
          : hasArticleBody
            ? '記事タイトル・本文・要約・章見出しを翻訳できます。'
            : '先に本文を生成してください。'
  const progress =
    generation.status === 'completed'
      ? 1
      : generation.stage === 'preparing-model'
        ? generation.progress.stageProgress
        : generation.progress.total > 0 && generation.progress.completed > 0
          ? generation.progress.completed / generation.progress.total
          : null
  const progressLabel =
    isRunning && generation.stage === 'preparing-model'
      ? generation.progress.stageProgress === null
        ? '準備中'
        : `モデル ${Math.round(generation.progress.stageProgress * 100)}%`
      : isRunning && generation.progress.total > 0
        ? `${generation.progress.completed}/${generation.progress.total}項目`
        : generation.currentTranslation
          ? '翻訳済み'
          : isStale
            ? '再翻訳が必要'
            : '未生成'

  return (
    <section aria-labelledby="article-translation-heading">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2
              id="article-translation-heading"
              className="flex items-center gap-2 text-[21px] font-bold tracking-[-0.05em]"
            >
              <Languages size={17} className="text-[#1d6b50]" aria-hidden="true" />
              翻訳
            </h2>
            <p className="mt-1 text-xs leading-5 text-[#71807b]">
              原文を残したまま、翻訳版を記事に保存します。
            </p>
          </div>
          <button
            className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-[9px] px-4 py-3 text-xs font-semibold shadow-[0_7px_16px_rgba(29,107,80,0.17)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${isRunning ? 'border border-[#d28d7a] bg-[#fff5f1] text-[#9d422d] shadow-none hover:bg-[#fbe8e2]' : 'bg-[#1d6b50] text-[#f3faf6] hover:bg-[#174d3c]'}`}
            type="button"
            onClick={isRunning ? onCancel : onTranslate}
            disabled={
              !isRunning &&
              (disabled ||
                !hasArticleBody ||
                sourceLanguage === targetLanguage ||
                (engineId === LFM2_ENGINE_ID && !localPairSupported))
            }
          >
            {isRunning ? (
              <Square size={13} fill="currentColor" />
            ) : translation ? (
              <RefreshCw size={14} />
            ) : (
              <Play size={13} fill="currentColor" />
            )}
            {isRunning ? '停止' : translation ? '再翻訳' : '翻訳を生成'}
          </button>
        </div>
      </header>

      <div className="mt-4 rounded-[12px] border border-[#d8e1dc] bg-[#f7faf7] p-4 md:p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs text-[#71807b]">
            原文の言語
            <select
              className="mt-2 block w-full rounded-[8px] border border-[#b7cbc0] bg-[#fbfcfa] px-3 py-2.5 text-sm text-[#18211f] outline-none focus:border-[#1d6b50] focus:ring-2 focus:ring-[#1d6b50]/20 disabled:opacity-50"
              value={sourceLanguage}
              onChange={(event) =>
                onSourceLanguageChange(event.target.value as ArticleTranslationLanguage)
              }
              disabled={disabled || isRunning}
            >
              {TRANSLATION_LANGUAGES.map((language) => (
                <option key={language.id} value={language.id}>
                  {language.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[#71807b]">
            翻訳先
            <select
              className="mt-2 block w-full rounded-[8px] border border-[#b7cbc0] bg-[#fbfcfa] px-3 py-2.5 text-sm text-[#18211f] outline-none focus:border-[#1d6b50] focus:ring-2 focus:ring-[#1d6b50]/20 disabled:opacity-50"
              value={targetLanguage}
              onChange={(event) =>
                onTargetLanguageChange(event.target.value as ArticleTranslationLanguage)
              }
              disabled={disabled || isRunning}
            >
              {TRANSLATION_LANGUAGES.map((language) => (
                <option key={language.id} value={language.id}>
                  {language.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4">
          <label className="block text-xs text-[#71807b]" htmlFor="article-translation-model">
            <span className="block font-semibold text-[#18211f]">使用モデル</span>
            <ModelSelect
              id="article-translation-model"
              value={engineId}
              systemModels={[{ id: 'apple-translation', label: 'Apple Translation' }]}
              localModels={[
                {
                  id: LFM2_ENGINE_ID,
                  label: 'LFM2-350M-ENJP-MT',
                  disabled: !localPairSupported,
                },
              ]}
              apiModels={[{ id: 'openai:gpt-6-luna', label: 'GPT-6 Luna' }]}
              onChange={(nextEngineId) => onEngineChange(nextEngineId as TranslationEngineId)}
              disabled={disabled || isRunning}
              aria-label="翻訳に使うモデル"
            />
          </label>
          {engineId === 'apple-translation' && (
            <p className="mt-2 text-[10px] leading-5 text-[#71807b]">
              Apple Translationのアプリ内翻訳にはmacOS
              26以降が必要です。翻訳言語はシステム設定の「一般」&gt;「言語と地域」&gt;「翻訳言語」で追加できます。
            </p>
          )}
        </div>

        <label className="mt-4 flex items-start gap-2 text-xs leading-5 text-[#53615b]">
          <input
            className="mt-1 accent-[#1d6b50]"
            type="checkbox"
            checked={includeInBatch}
            onChange={(event) => onIncludeInBatchChange(event.target.checked)}
            disabled={disabled || isRunning}
          />
          <span>一括実行に翻訳を含める</span>
        </label>

        {engineId === 'openai:gpt-6-luna' && (
          <>
            <p className="mt-3 text-[10px] leading-5 text-[#9a7a35]">
              記事タイトル・本文・要約・章見出しをOpenAI APIへ送信して翻訳します。
            </p>
            <OpenAiApiKeySettings
              verificationModel={OPENAI_LUNA_MODEL.apiModel}
              verificationLabel={OPENAI_LUNA_MODEL.label}
              billingNote="翻訳のAPI利用料は、入力したAPIキーに紐づくOpenAI APIの請求先に発生します。"
              disabled={disabled || isRunning}
            />
          </>
        )}
        {engineId === LFM2_ENGINE_ID && !localPairSupported && (
          <p className="mt-1 text-[10px] leading-5 text-[#9a7a35]">
            LFM2-350M-ENJP-MTは日本語と英語の組み合わせで利用できます。
          </p>
        )}
        {engineId === LFM2_ENGINE_ID && localPairSupported && (
          <p className="mt-1 text-[10px] leading-5 text-[#71807b]">
            初回利用時に翻訳モデル（約229 MB）をダウンロードします。翻訳処理はこのMac内で行います。
          </p>
        )}
        <ApiCostEstimate isOpenAi={isOpenAi} estimate={costEstimate} />
      </div>
      <ProcessingStatusRow
        compact
        status={generation.status}
        message={statusMessage}
        progress={progress}
        progressLabel={progressLabel}
        progressAriaLabel="翻訳の進捗"
        error={generation.error}
        onRetry={() => void generation.generate(true)}
        retryDisabled={disabled || isRunning || !hasArticleBody}
      />
    </section>
  )
}

const LFM2_ENGINE_ID = TRANSLATION_ENGINES[2].id
