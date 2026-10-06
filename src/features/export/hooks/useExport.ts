import { useCallback, useEffect, useRef, useState } from 'react'
import { articleExportInputKey } from '../exportInput'
import { getErrorDetail } from '../../../lib/errors'
import type { ArticleContext } from '../../../types/project'
import {
  EXPORT_OPTIONS,
  downloadAllExportFiles,
  downloadExportFile,
  exportProject,
  type ExportFormat,
  type ExportResult,
} from '../export'

export function useExport(
  project: ArticleContext,
  onGenerated: () => void | Promise<void>,
  enabled: boolean,
) {
  const [status, setStatus] = useState<'idle' | 'generating' | 'downloading'>('idle')
  const [localResult, setLocalResult] = useState<{ inputKey: string; output: ExportResult } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const isOperating = useRef(false)
  const preparedInput = useRef<string | null>(null)
  const inputKey = articleExportInputKey(project)
  const result = localResult?.inputKey === inputKey ? localResult.output : null

  const generate = useCallback(async () => {
    if (!enabled || isOperating.current) return
    isOperating.current = true
    preparedInput.current = inputKey
    setStatus('generating')
    setError(null)
    setMessage(null)
    setLocalResult(null)
    try {
      const output = await exportProject(project)
      setLocalResult({ inputKey, output })
      await onGenerated()
    } catch (exportError) {
      console.error(exportError)
      setError(getErrorDetail(exportError, '書き出しに失敗しました。'))
    } finally {
      isOperating.current = false
      setStatus('idle')
    }
  }, [project, inputKey, onGenerated, enabled])

  useEffect(() => {
    if (enabled && status === 'idle' && preparedInput.current !== inputKey) void generate()
  }, [enabled, status, inputKey, generate])

  const download = async (format?: ExportFormat) => {
    if (!result || isOperating.current) return
    const file = format ? result.files.find((candidate) => candidate.format === format) : null
    if (format && !file) return
    isOperating.current = true
    setStatus('downloading')
    setError(null)
    setMessage(!format || format === 'pdf' ? 'PDFを生成しています…' : null)
    try {
      const saved = file
        ? await downloadExportFile(file, result.assets, result.files)
        : await downloadAllExportFiles(result.files, result.assets)
      const label = EXPORT_OPTIONS.find((option) => option.format === format)?.label
      const savedMessage = format
        ? `${label}を保存しました。`
        : `${result.files.length}件のファイルを保存しました。`
      setMessage(saved ? savedMessage : null)
    } catch (downloadError) {
      console.error(downloadError)
      setMessage(null)
      setError(getErrorDetail(downloadError, 'ダウンロードに失敗しました。'))
    } finally {
      isOperating.current = false
      setStatus('idle')
    }
  }

  return {
    isBusy: status !== 'idle',
    isGenerating: status === 'generating',
    hasFiles: Boolean(result?.files.length),
    error,
    message,
    generate,
    download,
  }
}

export type ExportController = ReturnType<typeof useExport>
