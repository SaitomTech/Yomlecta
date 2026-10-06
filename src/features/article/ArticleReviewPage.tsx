import { ArrowRight, Play, Square } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigationDisabled } from '../../app/navigationDisabled'
import { ArticleContextRow } from '../../components/ArticleContextRow'
import { WorkflowBar } from '../../components/WorkflowBar'
import { WorkflowPanelHeader } from '../../components/WorkflowPanelHeader'
import { getArticleModel, type ArticleModelId } from '../../lib/article/articleModel'
import type { WorkflowStep } from '../../lib/workflow'
import type {
  ArticleDraft,
  ArticleOutputLanguage,
  ArticleSections,
  ArticleSummary,
  ArticleTranslation,
  ArticleTranslationLanguage,
  MediaProject,
  TranscriptBoundaryPlan,
} from '../../types/project'
import { ArticleNavigationBar } from './components/ArticleNavigationBar'
import { ArticleTranslationCard } from './components/ArticleTranslationCard'
import { ArticleStructureEditor } from './components/ArticleStructureEditor'
import { useArticleTranslation } from './hooks/useArticleTranslation'
import {
  ContentProcessingPanel,
  ContentProcessingStatus,
} from '../content-processing/components/ContentProcessingPanel'
import type { ContentProcessingSlideCompleted } from '../content-processing/contentProcessing'
import { useContentProcessing } from '../content-processing/hooks/useContentProcessing'
import { getActiveArticleSourceContext } from '../../lib/project/articleSource'
import { articleBlockViews } from '../../lib/pipeline/articleBlocks'
import { getTranslationEngineId, normalizeLanguage, type TranslationEngineId } from './translation'
import { getArticleOutputLanguage, getCurrentTranslationForOutputLanguage } from './outputLanguage'

type ArticleReviewPageProps = {
  project: MediaProject
  onBoundaryPlanCompleted: (plan: TranscriptBoundaryPlan) => Promise<void>
  onContentSlideCompleted: ContentProcessingSlideCompleted
  onSaveSections: (sections: ArticleSections | null) => void | Promise<void>
  getCurrentProject: () => MediaProject | null
  onSave: (draft: ArticleDraft) => void | Promise<void>
  onSaveSummary: (summary: ArticleSummary) => void | Promise<void>
  onSaveTranslation: (translation: ArticleTranslation) => void | Promise<void>
  onSaveOutputLanguage: (language: ArticleOutputLanguage) => void | Promise<void>
  onExport: () => void
  onBackToProject: () => void
  onOpenArticle: (articleId: string) => void | Promise<void>
  onSaveTitle: (title: string) => void | Promise<void>
  maxReachedStep: WorkflowStep
  onStepClick: (step: WorkflowStep) => void
}

type EditingTarget = { type: 'slide'; slideId: string } | null
type BatchStage = 'idle' | 'content' | 'translation'

type ArticleBatchActions = {
  isBusy: boolean
  includeTranslation: boolean
  setStage: (stage: BatchStage) => void
  processContent: () => Promise<boolean>
  generateTranslation: () => Promise<boolean>
}

async function runArticleBatch(actions: ArticleBatchActions) {
  if (actions.isBusy) return
  const steps: Array<{ stage: Exclude<BatchStage, 'idle'>; run: () => Promise<boolean> }> = [
    { stage: 'content' as const, run: actions.processContent },
  ]
  if (actions.includeTranslation) {
    steps.push({ stage: 'translation' as const, run: actions.generateTranslation })
  }

  try {
    for (const step of steps) {
      actions.setStage(step.stage)
      if (!(await step.run())) return
    }
  } finally {
    actions.setStage('idle')
  }
}

function cancelArticleBatch(
  stage: BatchStage,
  cancelers: Record<Exclude<BatchStage, 'idle'>, () => void>,
) {
  if (stage !== 'idle') cancelers[stage]()
}

function getCurrentArticleSections(project: MediaProject) {
  return project.article?.sections
}

function getReviewControlState({
  isSaving,
  isBatchRunning,
  isProcessingRunning,
  isTranslationRunning,
  hasUnsavedChanges,
  isSwitchingArticle,
}: {
  isSaving: boolean
  isBatchRunning: boolean
  isProcessingRunning: boolean
  isTranslationRunning: boolean
  hasUnsavedChanges: boolean
  isSwitchingArticle: boolean
}) {
  const isBusy = isSaving || isBatchRunning || isProcessingRunning || isTranslationRunning
  return {
    isBusy,
    isBatchRunning,
    contentControlsDisabled:
      isBatchRunning || isSaving || isTranslationRunning || hasUnsavedChanges || isSwitchingArticle,
  }
}

export function ArticleReviewPage({
  project,
  onBoundaryPlanCompleted,
  onContentSlideCompleted,
  onSaveSections,
  getCurrentProject,
  onSave,
  onSaveSummary,
  onSaveTranslation,
  onSaveOutputLanguage,
  onExport,
  onBackToProject,
  onOpenArticle,
  onSaveTitle,
  maxReachedStep,
  onStepClick,
}: ArticleReviewPageProps) {
  const articleSlides = articleBlockViews(project.slides, project.articleBlocks).filter((slide) =>
    Boolean(slide.transcript),
  )
  const currentArticleSections = getCurrentArticleSections(project)
  const { outputLanguage, outputTranslation } = useMemo(() => {
    const language = getArticleOutputLanguage(project)
    return {
      outputLanguage: language,
      outputTranslation: getCurrentTranslationForOutputLanguage(project, language),
    }
  }, [project])
  const sourcePath = getActiveArticleSourceContext(project).source.path
  const activeArticle = project.articles.find((article) => article.id === project.activeArticleId)
  const articleTitle =
    activeArticle?.title.trim() ||
    project.article?.title?.trim() ||
    project.source.name.replace(/\.[^.]+$/, '')
  const [includeSummary, setIncludeSummary] = useState(true)
  const storedTextModelId = project.slides
    .map((slide) => slide.transcript?.articleModel)
    .find((modelId): modelId is string => Boolean(modelId))
  const [textModelId, setTextModelId] = useState<ArticleModelId>(
    () => getArticleModel(storedTextModelId).id,
  )
  const initialTranslationSource: ArticleTranslationLanguage =
    normalizeLanguage(project.transcription?.language) ?? 'ja'
  const initialTranslationTarget: ArticleTranslationLanguage =
    initialTranslationSource === 'ja' ? 'en' : 'ja'
  const [translationSourceLanguage, setTranslationSourceLanguage] =
    useState<ArticleTranslationLanguage>(initialTranslationSource)
  const [translationTargetLanguage, setTranslationTargetLanguage] =
    useState<ArticleTranslationLanguage>(initialTranslationTarget)
  const [translationEngineId, setTranslationEngineId] = useState<TranslationEngineId>(() =>
    getTranslationEngineId(project.article?.translations?.[initialTranslationTarget]),
  )
  const [includeTranslationInBatch, setIncludeTranslationInBatch] = useState(false)
  const reviewSections = currentArticleSections ?? {
    model: 'manual',
    inputFingerprint: 'manual',
    sections: [],
  }
  const textModel = getArticleModel(textModelId)
  const initialBodies = Object.fromEntries(
    articleSlides.map((slide) => [slide.id, slide.transcript?.articleBody ?? '']),
  )
  const [savedBodies, setSavedBodies] = useState<Record<string, string>>(initialBodies)
  const [editingTarget, setEditingTarget] = useState<EditingTarget>(null)
  const [bodyDraft, setBodyDraft] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [switchingArticleId, setSwitchingArticleId] = useState<string | null>(null)
  const [batchStage, setBatchStage] = useState<BatchStage>('idle')

  const handleContentSlideCompleted: ContentProcessingSlideCompleted = async (results) => {
    await onContentSlideCompleted(results)
    setSavedBodies((current) => ({
      ...current,
      ...Object.fromEntries(results.map(({ slideId, result }) => [slideId, result.article.body])),
    }))
  }

  const processing = useContentProcessing(
    project,
    handleContentSlideCompleted,
    textModelId,
    getCurrentProject,
    onBoundaryPlanCompleted,
    onSaveSections,
    onSaveSummary,
    includeSummary,
  )
  const translationGeneration = useArticleTranslation(
    project,
    translationEngineId,
    translationSourceLanguage,
    translationTargetLanguage,
    onSaveTranslation,
    getCurrentProject,
  )

  const editingSlideId = editingTarget?.type === 'slide' ? editingTarget.slideId : null
  const isBodyDirty = editingSlideId !== null && bodyDraft !== (savedBodies[editingSlideId] ?? '')
  const hasUnsavedChanges = isBodyDirty
  const { isBusy, isBatchRunning, contentControlsDisabled } = getReviewControlState({
    isSaving,
    isBatchRunning: batchStage !== 'idle',
    isProcessingRunning: processing.status === 'running',
    isTranslationRunning: translationGeneration.status === 'running',
    hasUnsavedChanges,
    isSwitchingArticle: switchingArticleId !== null,
  })
  const canEdit = editingTarget === null && !isBusy

  const handleRunAll = () =>
    runArticleBatch({
      isBusy,
      includeTranslation: includeTranslationInBatch,
      setStage: setBatchStage,
      processContent: () => processing.process(processing.status === 'completed'),
      generateTranslation: () => translationGeneration.generate(translationGeneration.isUpToDate),
    })

  const handleCancelBatch = () =>
    cancelArticleBatch(batchStage, {
      content: processing.cancel,
      translation: translationGeneration.cancel,
    })

  const handleTextModelChange = (nextModelId: ArticleModelId) => {
    processing.reset()
    setTextModelId(nextModelId)
  }

  const startSlideEditing = (slideId: string) => {
    if (!canEdit) return
    setBodyDraft(savedBodies[slideId] ?? '')
    setEditingTarget({ type: 'slide', slideId })
    setSaveError(null)
  }

  const cancelEditing = () => {
    setEditingTarget(null)
    setBodyDraft('')
    setSaveError(null)
  }

  const saveSlide = async () => {
    if (editingSlideId === null || !isBodyDirty) return

    setIsSaving(true)
    setSaveError(null)
    try {
      const nextBodies = { ...savedBodies, [editingSlideId]: bodyDraft }
      await onSave({ title: articleTitle, bodies: nextBodies })
      setSavedBodies(nextBodies)
      setBodyDraft('')
      setEditingTarget(null)
    } catch (error) {
      console.error(error)
      setSaveError(error instanceof Error ? error.message : '記事の保存に失敗しました。')
    } finally {
      setIsSaving(false)
    }
  }

  const switchArticle = async (articleId: string) => {
    if (articleId === project.activeArticleId) {
      return true
    }
    if (switchingArticleId || isBusy) return false

    if (hasUnsavedChanges) {
      const nextBodies = { ...savedBodies, [editingSlideId!]: bodyDraft }
      setIsSaving(true)
      setSaveError(null)
      try {
        await onSave({ title: articleTitle, bodies: nextBodies })
        setSavedBodies(nextBodies)
        setBodyDraft('')
        setEditingTarget(null)
      } catch (error) {
        console.error(error)
        setSaveError(error instanceof Error ? error.message : '記事の保存に失敗しました。')
        return false
      } finally {
        setIsSaving(false)
      }
    }

    setSwitchingArticleId(articleId)
    try {
      await onOpenArticle(articleId)
      return true
    } catch (error) {
      console.error(error)
      setSaveError(error instanceof Error ? error.message : '記事を切り替えられませんでした。')
      return false
    } finally {
      setSwitchingArticleId(null)
    }
  }

  const handleWorkflowNavigation = (nextStep: WorkflowStep) => {
    if (hasUnsavedChanges && !window.confirm('未保存の変更があります。保存せずに移動しますか？'))
      return
    onStepClick(nextStep)
  }
  useNavigationDisabled(hasUnsavedChanges || isBusy)

  return (
    <main className="flex min-h-[calc(100svh-76px)] flex-col bg-[#f4f7f4] font-[Avenir_Next,Hiragino_Sans,Yu_Gothic,system-ui,sans-serif] text-[18px] leading-[1.45] tracking-[0.18px] text-[#18211f]">
      <div className="mx-auto flex min-h-[56px] w-[calc(100%-48px)] max-w-[1040px] items-center md:w-[calc(100%-11.6vw)]">
        <ArticleNavigationBar
          onBack={onBackToProject}
          disabled={isBusy || switchingArticleId !== null}
        />
      </div>
      <ArticleContextRow
        project={project}
        sourceName={project.source.name}
        onSelect={switchArticle}
        onSaveTitle={onSaveTitle}
        disabled={isBusy || switchingArticleId !== null || editingSlideId !== null}
      />

      <section className="mx-auto flex w-[calc(100%-48px)] max-w-[1040px] flex-1 flex-col pb-12 md:w-[calc(100%-11.6vw)]">
        <WorkflowBar
          activeStep="article-review"
          maxReachedStep={maxReachedStep}
          onStepClick={handleWorkflowNavigation}
          disabled={isBusy}
        />
        <div className="overflow-hidden rounded-[18px] border border-[#b7cbc0] bg-[#fbfcfa] shadow-[0_18px_52px_rgba(22,54,42,0.07)]">
          <WorkflowPanelHeader
            eyebrow="04 / ARTICLE GENERATION & EDITING"
            title="記事の生成・編集"
            description="記事を生成し、内容や表示を編集します。"
          />

          <div className="space-y-10 p-5 md:p-7">
            <section aria-labelledby="article-generation-heading">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2
                    id="article-generation-heading"
                    className="text-[21px] font-bold tracking-[-0.05em]"
                  >
                    1. 記事を生成
                  </h2>
                  <p className="mt-1 text-xs text-[#71807b]">
                    OCR結果で文字起こしを補正し、要約とテーマ別セクションを追加します。
                  </p>
                </div>
                <button
                  className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-[9px] px-4 py-3 text-xs font-semibold shadow-[0_7px_16px_rgba(49,95,117,0.2)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#315f75]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${isBatchRunning ? 'border border-[#d28d7a] bg-[#fff5f1] text-[#9d422d] shadow-none hover:bg-[#fbe8e2]' : 'bg-[#315f75] text-[#f4fbff] hover:bg-[#264b5d]'}`}
                  type="button"
                  onClick={() => {
                    if (isBatchRunning) {
                      handleCancelBatch()
                      return
                    }
                    void handleRunAll()
                  }}
                  disabled={!isBatchRunning && (isBusy || project.slides.length === 0)}
                  aria-label={isBatchRunning ? '一括実行を停止' : undefined}
                >
                  {isBatchRunning ? (
                    <Square size={13} fill="currentColor" />
                  ) : (
                    <Play size={13} fill="currentColor" />
                  )}
                  {isBatchRunning ? '停止' : '一括実行'}
                </button>
              </div>
              <div className="mt-5 space-y-5">
                <div>
                  <ContentProcessingPanel
                    project={project}
                    processing={processing}
                    model={textModel}
                    modelId={textModelId}
                    onModelChange={handleTextModelChange}
                    includeSummary={includeSummary}
                    onIncludeSummaryChange={(enabled) => {
                      processing.reset()
                      setIncludeSummary(enabled)
                    }}
                    disabled={contentControlsDisabled || switchingArticleId !== null}
                  />
                  <ContentProcessingStatus
                    processing={processing}
                    disabled={contentControlsDisabled || switchingArticleId !== null}
                  />
                </div>
                <ArticleTranslationCard
                  project={project}
                  sourceLanguage={translationSourceLanguage}
                  targetLanguage={translationTargetLanguage}
                  engineId={translationEngineId}
                  includeInBatch={includeTranslationInBatch}
                  generation={translationGeneration}
                  onSourceLanguageChange={setTranslationSourceLanguage}
                  onTargetLanguageChange={setTranslationTargetLanguage}
                  onEngineChange={setTranslationEngineId}
                  onIncludeInBatchChange={setIncludeTranslationInBatch}
                  onTranslate={() => void translationGeneration.generate(true)}
                  onCancel={translationGeneration.cancel}
                  disabled={
                    isBusy ||
                    hasUnsavedChanges ||
                    switchingArticleId !== null ||
                    processing.status === 'running'
                  }
                />
              </div>
            </section>
            <section aria-labelledby="article-review-heading">
              <ArticleStructureEditor
                project={project}
                sections={reviewSections}
                sourcePath={sourcePath}
                canEditSlide={canEdit}
                editingSlideId={editingSlideId}
                savedBodies={savedBodies}
                bodyDraft={bodyDraft}
                isSavingBody={isSaving}
                isBodyDirty={isBodyDirty}
                bodySaveError={saveError}
                onStartSlideEditing={startSlideEditing}
                onCancelSlideEditing={cancelEditing}
                onSaveSlide={() => void saveSlide()}
                onBodyChange={(body) => {
                  setBodyDraft(body)
                  setSaveError(null)
                }}
                onSaveSections={onSaveSections}
                summary={project.article?.summary}
                translation={outputTranslation}
                outputLanguage={outputLanguage}
                onSaveOutputLanguage={onSaveOutputLanguage}
                summaryDisabled={isBusy || hasUnsavedChanges || switchingArticleId !== null}
                onSaveSummary={onSaveSummary}
                disabled={isBusy || isBodyDirty || switchingArticleId !== null}
              />
            </section>
          </div>
          <div
            className={`flex flex-wrap items-center gap-4 border-t border-[#d8e1dc] px-5 py-4 md:px-7 ${hasUnsavedChanges ? 'justify-between' : 'justify-end'}`}
          >
            {hasUnsavedChanges && (
              <p className="text-xs text-[#9a7a35]">
                未保存の変更があります。保存してから書き出せます。
              </p>
            )}
            <button
              className="inline-flex items-center gap-2 rounded-[9px] bg-[#1d6b50] px-4 py-3 text-xs font-semibold text-[#f3faf6] shadow-[0_7px_16px_rgba(29,107,80,0.17)] transition hover:bg-[#174d3c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              type="button"
              onClick={onExport}
              disabled={hasUnsavedChanges || isBusy}
              title={hasUnsavedChanges ? '編集中の変更を保存してください' : undefined}
            >
              閲覧・ダウンロードへ
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
