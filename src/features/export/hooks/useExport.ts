import { useCallback, useRef, useState } from 'react'
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

export function useExport(project: MediaProject, initialResult: ExportResult | null = null) {
  const [status, setStatus] = useState<ExportStatus>('idle')
  const [progress, setProgress] = useState<ExportProgress>({
    stage: 'copying-images',
    completed: 0,
    total: 0,
  })
  const [hasLocalResult, setHasLocalResult] = useState(false)
  const [localResult, setLocalResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isGenerating = useRef(false)
  const result = hasLocalResult ? localResult : initialResult

  const generate = useCallback(async () => {
    if (isGenerating.current) return null

    isGenerating.current = true
    setStatus('running')
    setError(null)
    setHasLocalResult(true)
    setLocalResult(null)
    setProgress({ stage: 'copying-images', completed: 0, total: 0 })

    try {
      const output = await exportProject(project, setProgress)
      setLocalResult(output)
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
  }, [project])

  const download = useCallback(
    async (format: ExportFormat) => {
      if (!result) return false
      const file = result.files.find((candidate) => candidate.format === format)
      if (!file) return false
      return downloadExportFile(file, result.assets)
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
