import { Check, FilePenLine, Lightbulb, Save, Sparkles, Tag, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type {
  ArticleOutputLanguage,
  ArticleSummary,
  ArticleTranslation,
  ArticleTranslationSummary,
} from '../../../types/project'
import { articleLanguageLabel, resolveArticleLanguageVisibility } from '../articleLanguage'

type SummaryDraft = Pick<ArticleSummary, 'overview' | 'mainMessage' | 'keyPoints' | 'keywords'>

type ArticleSummaryResultProps = {
  summary?: ArticleSummary
  translation?: ArticleTranslation
  outputLanguage: ArticleOutputLanguage
  disabled?: boolean
  readOnly?: boolean
  onSave?: (summary: ArticleSummary) => void | Promise<void>
}

function draftFromSummary(summary: ArticleSummary): SummaryDraft {
  return {
    overview: summary.overview,
    mainMessage: summary.mainMessage,
    keyPoints: summary.keyPoints,
    keywords: summary.keywords,
  }
}

function nonEmptyLines(value: string | string[]) {
  const values = typeof value === 'string' ? value.split('\n') : value
  return values.flatMap((line) => {
    const trimmed = line.trim()
    return trimmed ? [trimmed] : []
  })
}

function valuesWithKeys(values: string[], prefix: string) {
  const occurrences = new Map<string, number>()
  return values.map((value) => {
    const occurrence = occurrences.get(value) ?? 0
    occurrences.set(value, occurrence + 1)
    return { key: `${prefix}:${value}:${occurrence}`, value }
  })
}

function SummaryLanguageLabel({ language }: { language: string }) {
  return (
    <p className="mb-1 text-[10px] font-semibold text-[#71807b]">
      {articleLanguageLabel(language)}
    </p>
  )
}

function SummaryField({
  label,
  value,
  onChange,
  placeholder,
  rows,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  rows: number
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-[#18211f]">{label}</span>
      <textarea
        className="mt-2 w-full resize-y rounded-[9px] border border-[#b7cbc0] bg-[#fbfcfa] px-3 py-2.5 text-sm leading-7 text-[#33413c] outline-none transition placeholder:text-[#9aa6a1] focus:border-[#1d6b50] focus:ring-2 focus:ring-[#1d6b50]/15"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
      />
    </label>
  )
}

function SummaryEditForm({
  draft,
  onChange,
}: {
  draft: SummaryDraft
  onChange: (draft: SummaryDraft) => void
}) {
  return (
    <div className="grid gap-5 p-5 md:grid-cols-2 md:p-6">
      <div className="md:col-span-2">
        <SummaryField
          label="概要"
          value={draft.overview}
          onChange={(overview) => onChange({ ...draft, overview })}
          placeholder="文書全体の概要"
          rows={4}
        />
      </div>
      <div className="md:col-span-2">
        <SummaryField
          label="中心メッセージ"
          value={draft.mainMessage}
          onChange={(mainMessage) => onChange({ ...draft, mainMessage })}
          placeholder="講演者・講師が最も伝えたかった主張や結論"
          rows={3}
        />
      </div>
      <SummaryField
        label="主なポイント（1行に1つ）"
        value={draft.keyPoints.join('\n')}
        onChange={(value) => onChange({ ...draft, keyPoints: nonEmptyLines(value) })}
        placeholder="重要なポイントを1行ずつ"
        rows={6}
      />
      <SummaryField
        label="キーワード（1行に1つ）"
        value={draft.keywords.join('\n')}
        onChange={(value) => onChange({ ...draft, keywords: nonEmptyLines(value) })}
        placeholder="重要な概念や専門用語を1行ずつ"
        rows={6}
      />
    </div>
  )
}

function SummaryLanguageBlock({
  language,
  showLabel,
  divider,
  children,
}: {
  language: string
  showLabel: boolean
  divider?: boolean
  children: ReactNode
}) {
  return (
    <div className={divider ? 'mt-3 border-t border-[#e0e8e3] pt-3' : 'mt-2'}>
      {showLabel && <SummaryLanguageLabel language={language} />}
      {children}
    </div>
  )
}

function SummaryList({ values, translated = false }: { values: string[]; translated?: boolean }) {
  return (
    <ul className="space-y-2.5">
      {valuesWithKeys(values, translated ? 'translated-summary' : 'summary').map(
        ({ key, value }) => (
          <li className="flex gap-2.5 text-sm leading-7 text-[#33413c]" key={key}>
            {translated ? (
              <span className="mt-3 size-1.5 shrink-0 rounded-full bg-[#8bb6a2]" />
            ) : (
              <Check className="mt-1 shrink-0 text-[#1d6b50]" size={15} strokeWidth={2.2} />
            )}
            <span>{value}</span>
          </li>
        ),
      )}
    </ul>
  )
}

function SummaryKeywords({ values }: { values: string[] }) {
  if (values.length === 0) return <p className="text-sm text-[#9aa6a1]">キーワードはありません。</p>

  return (
    <div className="flex flex-wrap gap-2">
      {valuesWithKeys(values, 'keyword').map(({ key, value }) => (
        <span
          className="rounded-full border border-[#b7cbc0] bg-[#f4f8f4] px-2.5 py-1 text-xs text-[#53615b]"
          key={key}
        >
          {value}
        </span>
      ))}
    </div>
  )
}

type SummaryTextSectionProps = {
  title: string
  source: string
  translated?: string
  sourceLanguage: string
  targetLanguage: string
  showSource: boolean
  showTranslation: boolean
  showSourceLanguageLabel: boolean
  showTargetLanguageLabel: boolean
  showTranslationDivider: boolean
  emphasized?: boolean
}

function SummaryTextSection({
  title,
  source,
  translated,
  sourceLanguage,
  targetLanguage,
  showSource,
  showTranslation,
  showSourceLanguageLabel,
  showTargetLanguageLabel,
  showTranslationDivider,
  emphasized = false,
}: SummaryTextSectionProps) {
  const textClass = emphasized
    ? 'rounded-[9px] bg-[#f4f8f4] px-4 py-3 text-[15px] leading-8 text-[#33413c]'
    : 'text-[15px] leading-8 text-[#33413c]'
  return (
    <div>
      <h4 className="text-xs font-semibold tracking-[0.03em] text-[#71807b]">{title}</h4>
      {showSource && (
        <SummaryLanguageBlock language={sourceLanguage} showLabel={showSourceLanguageLabel}>
          <p className={textClass}>{source}</p>
        </SummaryLanguageBlock>
      )}
      {showTranslation && translated !== undefined && (
        <SummaryLanguageBlock
          language={targetLanguage}
          showLabel={showTargetLanguageLabel}
          divider={showTranslationDivider}
        >
          <p className={textClass}>{translated}</p>
        </SummaryLanguageBlock>
      )}
    </div>
  )
}

function SummaryDisplay({
  summary,
  translatedSummary,
  sourceLanguage,
  targetLanguage,
  outputLanguage,
}: {
  summary: ArticleSummary
  translatedSummary?: ArticleTranslationSummary
  sourceLanguage: string
  targetLanguage: string
  outputLanguage: ArticleOutputLanguage
}) {
  const visibility = resolveArticleLanguageVisibility({
    outputLanguage,
    sourceLanguage,
    targetLanguage,
    hasTranslation: Boolean(translatedSummary),
  })
  const languageBlockProps = {
    sourceLanguage,
    targetLanguage,
    showSource: visibility.showSource,
    showTranslation: visibility.showTranslation,
    showSourceLanguageLabel: visibility.showSourceLanguageLabel,
    showTargetLanguageLabel: visibility.showTargetLanguageLabel,
    showTranslationDivider: visibility.showTranslationDivider,
  }

  return (
    <div className="p-5 md:p-6">
      <SummaryTextSection
        title="概要"
        source={summary.overview}
        translated={translatedSummary?.overview}
        {...languageBlockProps}
      />
      <div className="mt-6 border-t border-[#d8e1dc] pt-5">
        <SummaryTextSection
          title="中心メッセージ"
          source={summary.mainMessage}
          translated={translatedSummary?.mainMessage}
          emphasized
          {...languageBlockProps}
        />
      </div>
      <div className="mt-6 grid gap-6 border-t border-[#d8e1dc] pt-5 md:grid-cols-2">
        <div>
          <div className="flex items-center gap-2">
            <Lightbulb className="text-[#1d6b50]" size={15} />
            <h4 className="text-xs font-semibold tracking-[0.03em] text-[#71807b]">主なポイント</h4>
          </div>
          {visibility.showSource && (
            <SummaryLanguageBlock
              language={sourceLanguage}
              showLabel={visibility.showSourceLanguageLabel}
            >
              <SummaryList values={summary.keyPoints} />
            </SummaryLanguageBlock>
          )}
          {visibility.showTranslation && translatedSummary && (
            <SummaryLanguageBlock
              language={targetLanguage}
              showLabel={visibility.showTargetLanguageLabel}
              divider={visibility.showTranslationDivider}
            >
              <SummaryList values={translatedSummary.keyPoints} translated />
            </SummaryLanguageBlock>
          )}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <Tag className="text-[#1d6b50]" size={15} />
            <h4 className="text-xs font-semibold tracking-[0.03em] text-[#71807b]">キーワード</h4>
          </div>
          {visibility.showSource && (
            <SummaryLanguageBlock
              language={sourceLanguage}
              showLabel={visibility.showSourceLanguageLabel}
            >
              <SummaryKeywords values={summary.keywords} />
            </SummaryLanguageBlock>
          )}
          {visibility.showTranslation && translatedSummary && (
            <SummaryLanguageBlock
              language={targetLanguage}
              showLabel={visibility.showTargetLanguageLabel}
              divider={visibility.showTranslationDivider}
            >
              <SummaryKeywords values={translatedSummary.keywords} />
            </SummaryLanguageBlock>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryActions({
  editing,
  canEdit,
  isSaving,
  onEdit,
  onCancel,
  onSave,
}: {
  editing: boolean
  canEdit: boolean
  isSaving: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
}) {
  if (!editing) {
    return (
      <button
        className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#b7cbc0] bg-[#fbfcfa] px-3 py-2 text-[11px] font-semibold text-[#1d6b50] transition hover:border-[#1d6b50] hover:bg-[#e2eee8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        onClick={onEdit}
        disabled={!canEdit}
      >
        <FilePenLine size={13} />
        編集
      </button>
    )
  }
  return (
    <>
      <button
        className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#d8e1dc] bg-[#fbfcfa] px-3 py-2 text-[11px] font-semibold text-[#71807b] transition hover:bg-[#f1f3f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        onClick={onCancel}
        disabled={isSaving}
      >
        <X size={13} />
        キャンセル
      </button>
      <button
        className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#1d6b50] px-3 py-2 text-[11px] font-semibold text-[#f3faf6] transition hover:bg-[#174d3c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        onClick={onSave}
        disabled={isSaving}
      >
        <Save size={13} />
        {isSaving ? '保存中…' : '保存'}
      </button>
    </>
  )
}

function useSummaryEditor({
  summary,
  disabled,
  readOnly,
  onSave,
}: Pick<ArticleSummaryResultProps, 'summary' | 'disabled' | 'readOnly' | 'onSave'>) {
  const [draft, setDraft] = useState<SummaryDraft | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const canEdit = Boolean(summary && onSave) && !disabled && !isSaving && !readOnly

  const startEditing = () => {
    if (!summary || !canEdit) return
    setDraft(draftFromSummary(summary))
    setSaveError(null)
  }
  const cancelEditing = () => {
    setDraft(null)
    setSaveError(null)
  }
  const saveEditing = async () => {
    if (!summary || !draft || !onSave) return
    const overview = draft.overview.trim()
    const keyPoints = nonEmptyLines(draft.keyPoints)
    const keywords = nonEmptyLines(draft.keywords)
    if (!overview || !draft.mainMessage.trim() || keyPoints.length === 0 || keywords.length === 0) {
      setSaveError('概要、中心メッセージ、主なポイント、キーワードを入力してください。')
      return
    }
    setIsSaving(true)
    setSaveError(null)
    try {
      await onSave({
        ...summary,
        overview,
        mainMessage: draft.mainMessage.trim(),
        keyPoints,
        keywords,
      })
      setDraft(null)
    } catch (error) {
      console.error(error)
      setSaveError(error instanceof Error ? error.message : '要約の保存に失敗しました。')
    } finally {
      setIsSaving(false)
    }
  }

  return {
    draft,
    setDraft,
    isSaving,
    saveError,
    canEdit,
    startEditing,
    cancelEditing,
    saveEditing,
  }
}

export function ArticleSummaryResult({
  summary,
  translation,
  outputLanguage,
  disabled = false,
  readOnly = false,
  onSave,
}: ArticleSummaryResultProps) {
  const editor = useSummaryEditor({ summary, disabled, readOnly, onSave })
  const sourceLanguage = translation?.sourceLanguage ?? 'ja'
  const targetLanguage = translation?.targetLanguage ?? 'en'
  const visibility = resolveArticleLanguageVisibility({
    outputLanguage,
    sourceLanguage,
    targetLanguage,
    hasTranslation: Boolean(translation?.summary),
  })

  return (
    <section
      className="mt-6 overflow-hidden rounded-[15px] border border-[#b7cbc0] bg-[#fbfcfa]"
      aria-labelledby="article-summary-result-heading"
    >
      <header className="border-b border-[#d8e1dc] bg-[#eef6f0] px-5 py-5 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[#1d6b50]">
              <Sparkles size={12} />
              AI SUMMARY
            </p>
            <h3
              id="article-summary-result-heading"
              className="mt-1 text-[20px] font-bold tracking-[-0.05em]"
            >
              文書全体の要約
            </h3>
            <p className="mt-1 text-xs leading-5 text-[#71807b]">
              {readOnly
                ? '生成された要約を表示しています。'
                : '原文の要約を編集できます。訳文は再翻訳で更新されます。'}
            </p>
          </div>
          {summary && visibility.showSource && !readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              <SummaryActions
                editing={editor.draft !== null}
                canEdit={editor.canEdit}
                isSaving={editor.isSaving}
                onEdit={editor.startEditing}
                onCancel={editor.cancelEditing}
                onSave={() => void editor.saveEditing()}
              />
            </div>
          )}
        </div>
        {editor.saveError && (
          <p className="mt-4 rounded-[8px] border border-[#e6b6a8] bg-[#fff5f1] px-3 py-2 text-xs leading-5 text-[#9d422d]">
            {editor.saveError}
          </p>
        )}
      </header>

      {editor.draft && visibility.showSource ? (
        <SummaryEditForm draft={editor.draft} onChange={editor.setDraft} />
      ) : summary && (visibility.showSource || visibility.showTranslation) ? (
        <SummaryDisplay
          summary={summary}
          translatedSummary={translation?.summary}
          sourceLanguage={sourceLanguage}
          targetLanguage={targetLanguage}
          outputLanguage={outputLanguage}
        />
      ) : visibility.showSource ? (
        <p className="px-5 py-8 text-center text-xs leading-5 text-[#71807b] md:px-6">
          Step 1で要約を生成すると、ここに結果が表示されます。
        </p>
      ) : null}
    </section>
  )
}
