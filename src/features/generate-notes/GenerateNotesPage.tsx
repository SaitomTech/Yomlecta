import { Play, Square } from 'lucide-react'
import { useState } from 'react'
import { useNavigationDisabled } from '../../app/navigationDisabled'
import { ArticleContextRow } from '../../components/ArticleContextRow'
import { WorkflowBar } from '../../components/WorkflowBar'
import { WorkflowPanelHeader } from '../../components/WorkflowPanelHeader'
import type { WorkflowStep } from '../../lib/workflow'
import { getOcrModel, type OcrModelId } from '../../lib/ocr/modelManager'
import {
  getTranscriptionModel,
  type TranscriptionModelId,
} from '../../lib/transcription/transcriptionModel'
import {
  getActiveMediaSource,
  type MediaProject,
  type SlideResultEdits,
  type TranscriptionResult,
} from '../../types/project'
import { AnalysisResultPreview } from '../content-processing/components/AnalysisResultPreview'
import { OcrPanel, OcrStatus } from '../ocr/components/OcrPanel'
import { useOcr } from '../ocr/hooks/useOcr'
import type { OcrSlideCompleted } from '../ocr/ocr'
import { TranscriptionSettings } from './components/TranscriptionSettings'
import { TranscriptionStatus } from './components/TranscriptionStatus'
import { TranscriptionKeywordsPanel } from './components/TranscriptionKeywordsPanel'
import { useTranscription } from './hooks/useTranscription'
import type { TranscriptionLanguage } from './transcription'
import { ArticleNavigationBar } from '../article/components/ArticleNavigationBar'
import { getActiveArticleSourceContext } from '../../lib/project/articleSource'
import { articleBlockViews } from '../../lib/pipeline/articleBlocks'

type GenerateNotesPageProps = {
  project: MediaProject
  onCompleted: (result: TranscriptionResult) => void | Promise<void>
  onOcrSlideCompleted: OcrSlideCompleted
  onSaveSlideResultEdits: (slideId: string, edits: SlideResultEdits) => void | Promise<void>
  onOpenArticleReview: () => void
  onBackToProject: () => void
  onOpenArticle: (articleId: string) => void | Promise<void>
  onSaveTitle: (title: string) => void | Promise<void>
  maxReachedStep: WorkflowStep
  onStepClick: (step: WorkflowStep) => void
}

type BatchStage = 'idle' | 'ocr' | 'transcription'

export function GenerateNotesPage({
  project,
  onCompleted,
  onOcrSlideCompleted,
  onSaveSlideResultEdits,
  onOpenArticleReview,
  onBackToProject,
  onOpenArticle,
  onSaveTitle,
  maxReachedStep,
  onStepClick,
}: GenerateNotesPageProps) {
  const source = getActiveMediaSource(project)
  const sourceContext = getActiveArticleSourceContext(project)
  const durationMs = sourceContext.range.endMs - sourceContext.range.startMs
  const [language, setLanguage] = useState<TranscriptionLanguage>(
    project.transcription?.language === 'ja' || project.transcription?.language === 'en'
      ? project.transcription.language
      : 'auto',
  )
  const [transcriptionModelId, setTranscriptionModelId] = useState<TranscriptionModelId>(
    () => getTranscriptionModel(project.transcription?.model).id,
  )
  const storedOcrModelId = project.slides
    .map((slide) => slide.ocr?.model)
    .find((modelId): modelId is string => Boolean(modelId))
  const [ocrModelId, setOcrModelId] = useState<OcrModelId>(() => getOcrModel(storedOcrModelId).id)
  const transcription = useTranscription(project, transcriptionModelId, onCompleted)
  const ocr = useOcr(project, onOcrSlideCompleted, ocrModelId)
  const [batchStage, setBatchStage] = useState<BatchStage>('idle')
  const handleTranscribe = () => transcription.transcribe(language)
  const isBatchRunning = batchStage !== 'idle'
  const isOcrRunning = ocr.status === 'running'
  const isProcessing = isBatchRunning || transcription.status === 'running' || isOcrRunning
  useNavigationDisabled(isProcessing)

  const handleRunAll = async () => {
    if (isProcessing) return

    setBatchStage('ocr')
    try {
      if (!(await ocr.recognize())) return

      setBatchStage('transcription')
      if (!(await transcription.transcribe(language))) return
    } finally {
      setBatchStage('idle')
    }
  }

  const handleCancelBatch = () => {
    if (batchStage === 'ocr') ocr.cancel()
    if (batchStage === 'transcription') transcription.cancel()
  }
  return (
    <main className="flex min-h-[calc(100svh-76px)] flex-col bg-[#f4f7f4] font-[Avenir_Next,Hiragino_Sans,Yu_Gothic,system-ui,sans-serif] text-[18px] leading-[1.45] tracking-[0.18px] text-[#18211f]">
      <div className="mx-auto flex min-h-[56px] w-[calc(100%-48px)] max-w-[1040px] items-center md:w-[calc(100%-11.6vw)]">
        <ArticleNavigationBar onBack={onBackToProject} disabled={isProcessing} />
      </div>
      <ArticleContextRow
        project={project}
        sourceName={source.name}
        onSelect={onOpenArticle}
        onSaveTitle={onSaveTitle}
        disabled={isProcessing}
      />

      <section className="mx-auto flex w-[calc(100%-48px)] max-w-[1040px] flex-1 flex-col pb-12 md:w-[calc(100%-11.6vw)]">
        <WorkflowBar
          activeStep="generate-notes"
          maxReachedStep={maxReachedStep}
          onStepClick={onStepClick}
          disabled={isProcessing}
        />
        <div className="overflow-hidden rounded-[18px] border border-[#b7cbc0] bg-[#fbfcfa] shadow-[0_18px_52px_rgba(22,54,42,0.07)]">
          <WorkflowPanelHeader
            eyebrow="03 / TRANSCRIPTION & OCR"
            title="文字起こしとOCR"
            description="音声の文字起こしと、スライド内の文字認識を実行します。"
          />

          <div className="p-5 md:p-7">
            <section aria-labelledby="analysis-settings-heading">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2
                    id="analysis-settings-heading"
                    className="text-[21px] font-bold tracking-[-0.05em]"
                  >
                    1. 解析の設定・実行
                  </h2>
                  <p className="mt-1 text-xs text-[#71807b]">
                    OCRと文字起こしに必要な設定を確認して、順番に実行します。解析結果は下の「2.
                    解析結果の確認」で確認できます。
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
                  disabled={!isBatchRunning && (isProcessing || project.slides.length === 0)}
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

              <div className="mt-6 space-y-10">
                <div>
                  <OcrPanel
                    project={project}
                    ocr={ocr}
                    modelId={ocrModelId}
                    onModelChange={setOcrModelId}
                    disabled={isBatchRunning || transcription.status === 'running'}
                  />
                  <div className="mt-6">
                    <OcrStatus
                      ocr={ocr}
                      disabled={isBatchRunning || transcription.status === 'running'}
                    />
                  </div>
                </div>

                <div>
                  <TranscriptionSettings
                    language={language}
                    modelId={transcriptionModelId}
                    durationMs={durationMs}
                    status={transcription.status}
                    disabled={isBatchRunning || isOcrRunning}
                    onLanguageChange={setLanguage}
                    onModelChange={setTranscriptionModelId}
                    onTranscribe={handleTranscribe}
                    onCancel={transcription.cancel}
                  />
                  <div className="mt-6">
                    <TranscriptionStatus
                      status={transcription.status}
                      stage={transcription.stage}
                      stageProgress={transcription.stageProgress}
                      chunkProgress={transcription.chunkProgress}
                      error={transcription.error}
                      disabled={isBatchRunning || isOcrRunning}
                      onRetry={handleTranscribe}
                    />
                    <TranscriptionKeywordsPanel context={project.transcription?.keywordContext} />
                  </div>
                </div>
              </div>
            </section>

            <AnalysisResultPreview
              slides={articleBlockViews(project.slides, project.articleBlocks)}
              videoPath={sourceContext.source.path}
              sourceOffsetMs={sourceContext.range.startMs}
              onEdit={onOpenArticleReview}
              onSaveSlideResultEdits={onSaveSlideResultEdits}
              disabled={isProcessing}
            />
          </div>
        </div>
      </section>
    </main>
  )
}
