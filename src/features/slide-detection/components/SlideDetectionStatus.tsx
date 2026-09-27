import { AlertTriangle, Check, RefreshCw, ScanLine } from 'lucide-react'
import type { SlideDetectionStatus as DetectionStatus } from '../hooks/useSlideDetection'
import type { SlideDetectionStage } from '../types'

type SlideDetectionStatusProps = {
  status: DetectionStatus
  stage: SlideDetectionStage
  stageProgress: number | null
  error: string | null
  isSaving: boolean
  isReviewDirty: boolean
  onDetect: () => void | Promise<void>
}

const stageLabels: Record<SlideDetectionStage, string> = {
  preparing: '解析の準備中…',
  sampling: 'フレームを読み込み中…',
  comparing: 'フレームの変化を比較中…',
  classifying: '映像区間を分類中…',
  extracting: '代表画像を作成中…',
  saving: '検出結果を保存中…',
  completed: '検出結果を確認してください。',
}

function progressLabel(
  isSaving: boolean,
  isRunning: boolean,
  isCompleted: boolean,
  progress: number | null,
) {
  if (isSaving) return '保存中'
  if (progress !== null) return `${Math.round(progress * 100)}%`
  if (isRunning) return '処理中'
  return isCompleted ? '完了' : '未開始'
}

function statusLabel(status: DetectionStatus, isSaving: boolean) {
  if (isSaving) return 'SAVING'
  if (status === 'completed') return 'DETECTED'
  if (status === 'error') return 'ERROR'
  return status === 'running' ? 'ANALYZING' : 'READY'
}

function statusDescription(
  stage: SlideDetectionStage,
  isSaving: boolean,
  isRunning: boolean,
  isCompleted: boolean,
) {
  if (isSaving) return '区間と代表画像を保存中…'
  if (isRunning) return stageLabels[stage]
  return isCompleted ? stageLabels.completed : '自動検出はまだ開始されていません。'
}

function StatusIcon({
  isSaving,
  isCompleted,
  hasError,
}: {
  isSaving: boolean
  isCompleted: boolean
  hasError: boolean
}) {
  if (isSaving) return <RefreshCw size={13} className="animate-spin" />
  if (isCompleted) return <Check size={13} />
  if (hasError) return <AlertTriangle size={13} />
  return <ScanLine size={13} />
}

export function SlideDetectionStatus({
  status,
  stage,
  stageProgress,
  error,
  isSaving,
  isReviewDirty,
  onDetect,
}: SlideDetectionStatusProps) {
  const isRunning = status === 'running'
  const isCompleted = status === 'completed'
  const hasError = status === 'error'
  const currentProgressLabel = progressLabel(isSaving, isRunning, isCompleted, stageProgress)
  const currentStatusLabel = statusLabel(status, isSaving)
  const currentStatusDescription = statusDescription(stage, isSaving, isRunning, isCompleted)
  const statusColor = isCompleted
    ? 'text-[#1d6b50]'
    : hasError
      ? 'text-[#b6533a]'
      : 'text-[#9a7a35]'

  return (
    <section aria-labelledby="analysis-status-heading">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="analysis-status-heading" className="text-[21px] font-bold tracking-[-0.05em]">
          自動検出
        </h2>
        <button
          className="inline-flex items-center justify-center gap-2 rounded-[9px] border border-[#b7cbc0] bg-[#fbfcfa] px-4 py-3 text-xs font-semibold text-[#1d6b50] transition hover:border-[#1d6b50] hover:bg-[#e2eee8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onClick={() => void onDetect()}
          disabled={isRunning || isSaving || isReviewDirty}
        >
          <RefreshCw size={14} className={isRunning ? 'animate-spin' : ''} />
          {isRunning ? '自動検出中…' : isCompleted ? '自動で再検出' : '自動検出を開始'}
        </button>
      </div>

      <div className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-semibold text-[#18211f]">自動検出の状況</p>
              <div
                className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] ${statusColor}`}
              >
                <StatusIcon isSaving={isSaving} isCompleted={isCompleted} hasError={hasError} />
                {currentStatusLabel}
              </div>
            </div>
            <p className="mt-1 text-xs text-[#71807b]">{currentStatusDescription}</p>
          </div>
          <span className="font-mono text-[11px] tabular-nums text-[#1d6b50]">
            {currentProgressLabel}
          </span>
        </div>

        <div
          className="mt-4 h-1 overflow-hidden rounded-full bg-[#e2eee8]"
          aria-label={
            isSaving ? '区間と代表画像を保存中' : isRunning ? stageLabels[stage] : '検出の進捗'
          }
        >
          {isSaving || (isRunning && stageProgress === null) ? (
            <div className="h-full w-1/3 rounded-full bg-[#1d6b50] animate-pulse" />
          ) : (
            <div
              className="h-full rounded-full bg-[#1d6b50] transition-[width] duration-300"
              style={{
                width: `${isCompleted ? 100 : Math.max(0, Math.min(100, (stageProgress ?? 0) * 100))}%`,
              }}
            />
          )}
        </div>

        {error && (
          <div className="mt-5 flex items-start justify-between gap-4 rounded-[10px] border border-[#e4b4a7] bg-[#fff5f1] px-4 py-3 text-xs text-[#9d422d]">
            <p>{error}</p>
            <button
              className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-[#9d422d] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b6533a]/30"
              type="button"
              onClick={() => void onDetect()}
              disabled={isRunning || isSaving || isReviewDirty}
            >
              <RefreshCw size={13} />
              自動検出を再試行
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
