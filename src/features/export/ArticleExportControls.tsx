import { ChevronDown, Download, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { MediaProject } from '../../types/project'
import { EXPORT_OPTIONS, type ExportFormat } from './export'
import { articleExportInputKey } from './exportInput'
import { useExport } from './hooks/useExport'

export function ArticleExportControls({
  project,
  onGenerated,
  onBusyChange,
}: {
  project: MediaProject
  onGenerated: () => void | Promise<void>
  onBusyChange: (busy: boolean) => void
}) {
  const exporter = useExport(project)
  const { generate } = exporter
  const [isPreparing, setIsPreparing] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const inputKey = articleExportInputKey(project)
  const preparedInput = useRef<string | null>(null)
  const isBusy = isPreparing || exporter.status === 'running' || isDownloading

  useEffect(() => {
    onBusyChange(isBusy)
    return () => onBusyChange(false)
  }, [isBusy, onBusyChange])

  const handleGenerate = useCallback(async () => {
    setSaveError(null)
    setDownloadMessage(null)
    setIsPreparing(true)
    try {
      const output = await generate()
      if (output) await onGenerated()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '書き出し状態を保存できませんでした。')
    } finally {
      setIsPreparing(false)
    }
  }, [generate, onGenerated])

  useEffect(() => {
    if (preparedInput.current === inputKey) return
    preparedInput.current = inputKey
    void handleGenerate()
  }, [inputKey, handleGenerate])

  const handleDownload = async (event: ChangeEvent<HTMLSelectElement>) => {
    const format = event.target.value as ExportFormat
    event.target.value = ''
    if (!format || isBusy) return

    setIsDownloading(true)
    setDownloadMessage(format === 'pdf' ? 'PDFを生成しています…' : null)
    try {
      if (await exporter.download(format)) {
        const option = EXPORT_OPTIONS.find((candidate) => candidate.format === format)
        setDownloadMessage(`${option?.label ?? format}を保存しました。`)
      }
    } catch (error) {
      console.error(error)
      setDownloadMessage(error instanceof Error ? error.message : 'ダウンロードに失敗しました。')
    } finally {
      setIsDownloading(false)
    }
  }

  const handleDownloadAll = async () => {
    if (isBusy || exporter.files.length === 0) return

    setIsDownloading(true)
    setDownloadMessage('PDFを生成しています…')
    try {
      if (await exporter.downloadAll()) setDownloadMessage('4つのファイルを保存しました。')
    } catch (error) {
      console.error(error)
      setDownloadMessage(error instanceof Error ? error.message : 'ダウンロードに失敗しました。')
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#b7cbc0] bg-[#fbfcfa] px-3 py-2 text-xs font-semibold text-[#1d6b50] transition hover:border-[#1d6b50] hover:bg-[#e2eee8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onClick={() => void handleGenerate()}
          disabled={isBusy}
        >
          <RefreshCw size={13} />
          再生成
        </button>
        <label className="relative inline-flex items-center">
          <Download className="pointer-events-none absolute left-3 text-[#f3faf6]" size={14} />
          <select
            className="h-[34px] w-[148px] cursor-pointer appearance-none rounded-[9px] bg-[#1d6b50] py-2 pl-9 pr-10 text-xs font-semibold text-[#f3faf6] shadow-[0_7px_16px_rgba(29,107,80,0.17)] outline-none transition hover:bg-[#174d3c] focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            defaultValue=""
            onChange={(event) => void handleDownload(event)}
            disabled={isBusy || exporter.files.length === 0}
            aria-label="ダウンロード形式を選択"
          >
            <option value="" disabled>
              Download
            </option>
            <option value="html">HTML</option>
            <option value="pdf">PDF</option>
            <option value="markdown">Markdown</option>
            <option value="txt">TXT</option>
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex w-9 items-center justify-center border-l border-[#8eb8a5]/45 text-[#f3faf6]">
            <ChevronDown size={16} strokeWidth={2.2} />
          </span>
        </label>
        <button
          className="inline-flex items-center gap-2 rounded-[9px] border border-[#1d6b50] bg-[#fbfcfa] px-3 py-2 text-xs font-semibold text-[#1d6b50] transition hover:bg-[#e2eee8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onClick={() => void handleDownloadAll()}
          disabled={isBusy || exporter.files.length === 0}
        >
          <Download size={14} />
          すべてダウンロード
        </button>
      </div>
      {(exporter.error || saveError) && (
        <p className="w-full text-xs text-[#b6533a]" role="alert">
          {exporter.error || saveError}
        </p>
      )}
      {exporter.status === 'running' && (
        <p className="w-full text-xs text-[#71807b]" role="status">
          ダウンロード用のファイルを準備しています…
        </p>
      )}
      {downloadMessage && (
        <p className="w-full text-xs text-[#1d6b50]" role="status">
          {downloadMessage}
        </p>
      )}
    </div>
  )
}
