import { AlertTriangle, Check, RefreshCw, ScanLine } from 'lucide-react'
import type { SlideDetectionStatus } from '../hooks/useSlideDetection'
import type { SlideDetectionStage } from '../types'

type SlideDetectionSettingsStatusProps = {
  threshold: number
  sampleIntervalMs: number
  status: SlideDetectionStatus
  stage: SlideDetectionStage
  stageProgress: number | null
  error: string | null
  isSaving: boolean
  isReviewDirty: boolean
  onThresholdChange: (value: number) => void
  onSampleIntervalChange: (value: number) => void
  onDetect: () => void | Promise<void>
}

const stageLabels: Record<SlideDetectionStage, string> = {
  preparing: '解析の準備中…',
  sampling: 'フレームを読み込み中…',
  comparing: 'フレームの変化を比較中…',
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

function statusLabel(status: SlideDetectionStatus, isSaving: boolean) {
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

export function SlideDetectionSettingsStatus({
  threshold,
  sampleIntervalMs,
  status,
  stage,
  stageProgress,
  error,
  isSaving,
  isReviewDirty,
  onThresholdChange,
  onSampleIntervalChange,
  onDetect,
}: SlideDetectionSettingsStatusProps) {
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

      <div className="mt-6">
        <p className="text-[13px] font-semibold text-[#18211f]">自動検出の設定</p>
      </div>

      <div className="mt-3 rounded-[12px] border border-[#d8e1dc] bg-[#f7faf7] p-4 md:p-5">
        <div className="grid gap-5 md:grid-cols-2">
          <label className="block text-xs text-[#71807b]">
            <span className="flex items-center justify-between gap-3">
              <span>しきい値</span>
              <span className="font-mono text-[#1d6b50]">{threshold}</span>
            </span>
            <input
              className="mt-3 w-full accent-[#1d6b50]"
              type="range"
              min="4"
              max="32"
              step="1"
              value={threshold}
              onChange={(event) => onThresholdChange(Number(event.target.value))}
              disabled={isRunning || isSaving}
              aria-label="スライド変化のしきい値"
            />
            <span className="mt-1 block text-[10px] text-[#9aa6a1]">
              小さい変化も拾う ← → 大きな変化だけ
            </span>
          </label>

          <label className="block text-xs text-[#71807b]">
            <span className="flex items-center justify-between gap-3">
              <span>インターバル</span>
              <span className="font-mono text-[#1d6b50]">
                {sampleIntervalMs >= 1000
                  ? `${(sampleIntervalMs / 1000).toFixed(1)}秒`
                  : `${sampleIntervalMs}ms`}
              </span>
            </span>
            <input
              className="mt-3 w-full accent-[#1d6b50]"
              type="range"
              min="100"
              max="2000"
              step="100"
              value={sampleIntervalMs}
              onChange={(event) => onSampleIntervalChange(Number(event.target.value))}
              disabled={isRunning || isSaving}
              aria-label="フレームを確認する間隔"
            />
            <span className="mt-1 block text-[10px] text-[#9aa6a1]">
              短いほど細かく検出、長いほど速く解析
            </span>
          </label>
        </div>
      </div>

      <div className="mt-8 border-t border-[#e0e8e3] pt-6">
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
