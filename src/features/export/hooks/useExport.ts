import { useCallback, useRef, useState } from 'react'
import { articleExportInputKey } from '../exportInput'
import { getErrorDetail } from '../../../lib/errors'
import type { MediaProject } from '../../../types/project'
import {
  downloadAllExportFiles,
  downloadExportFile,
  exportProject,
  type ExportFormat,
  type ExportProgress,
  type ExportResult,
} from '../export'

type ExportStatus = 'idle' | 'running' | 'completed' | 'error'

function exportErrorMessage(error: unknown) {
  const detail = getErrorDetail(error, '')
  if (detail) return detail
  if (error && typeof error === 'object') {
    try {
      const serialized = JSON.stringify(error)
      if (serialized && serialized !== '{}') return serialized
    } catch {
      // Keep the user-facing fallback for non-serializable error objects.
    }
  }
  return '書き出しに失敗しました。'
}

export function useExport(project: MediaProject) {
  const [status, setStatus] = useState<ExportStatus>('idle')
  const [progress, setProgress] = useState<ExportProgress>({
    stage: 'copying-images',
    completed: 0,
    total: 0,
  })
  const [localResult, setLocalResult] = useState<{ inputKey: string; output: ExportResult } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const isGenerating = useRef(false)
  const inputKey = articleExportInputKey(project)
  const result = localResult?.inputKey === inputKey ? localResult.output : null

  const generate = useCallback(async () => {
    if (isGenerating.current) return null

    isGenerating.current = true
    setStatus('running')
    setError(null)
    setLocalResult(null)
    setProgress({ stage: 'copying-images', completed: 0, total: 0 })

    try {
      const output = await exportProject(project, setProgress)
      setLocalResult({ inputKey, output })
      setStatus('completed')
      return output
    } catch (exportError) {
      console.error(exportError)
      setStatus('error')
      setError(exportErrorMessage(exportError))
      return null
    } finally {
      isGenerating.current = false
    }
  }, [project, inputKey])

  const download = useCallback(
    async (format: ExportFormat) => {
      if (!result) return false
      const file = result.files.find((candidate) => candidate.format === format)
      if (!file) return false
      return downloadExportFile(file, result.assets, result.files)
    },
    [result],
  )

  const downloadAll = useCallback(async () => {
    if (!result) return false
    return downloadAllExportFiles(result.files, result.assets)
  }, [result])

  return {
    status,
    progress,
    files: result?.files ?? [],
    previewHtml: result?.previewHtml ?? null,
    error,
    generate,
    download,
    downloadAll,
  }
}

export type ExportController = ReturnType<typeof useExport>
