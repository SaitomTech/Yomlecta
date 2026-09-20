import { invoke } from '@tauri-apps/api/core'

export type DbErrorCode =
  | 'REVISION_CONFLICT'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'UNKNOWN'

export class DbError extends Error {
  readonly code: DbErrorCode
  readonly retryable: boolean

  constructor(code: DbErrorCode, message: string, retryable = false) {
    super(message)
    this.name = 'DbError'
    this.code = code
    this.retryable = retryable
  }
}

function asText(value: unknown) {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  if (value && typeof value === 'object' && 'message' in value) {
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return 'データベース操作に失敗しました。'
}

export function normalizeDbError(value: unknown) {
  if (value instanceof DbError) return value
  const raw = asText(value)
  const match = raw.match(/^([A-Z][A-Z0-9_]*):\s*(.*)$/s)
  const code = (match?.[1] ?? 'UNKNOWN') as DbErrorCode
  const message = match?.[2] || raw
  return new DbError(code, message, code === 'REVISION_CONFLICT')
}

export function invokeDb<T>(command: string, args?: Record<string, unknown>) {
  return invoke<T>(command, args).catch((error: unknown) => {
    throw normalizeDbError(error)
  })
}
