import { z } from 'zod'
import { openJsonLineSidecar } from '../tauri/sidecar'

const AppleTranslationResponseSchema = z.object({
  id: z.string().min(1),
  ok: z.boolean(),
  translations: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string(),
      }),
    )
    .nullable()
    .optional(),
  error: z.string().nullable().optional(),
})

export async function openAppleTranslation(signal?: AbortSignal) {
  return openJsonLineSidecar('binaries/apple-translator', signal)
}

export async function translateBatchWithApple({
  client,
  sourceLanguage,
  targetLanguage,
  items,
  signal,
  onProgress,
}: {
  client: Awaited<ReturnType<typeof openAppleTranslation>>
  sourceLanguage: string
  targetLanguage: string
  items: Array<{ id: string; text: string }>
  signal?: AbortSignal
  onProgress?: (progress: { completed: number; total: number }) => void
}) {
  const response = await client.request(
    { sourceLanguage, targetLanguage, items },
    signal,
    (progress) => {
      if (!progress || typeof progress !== 'object') return
      const value = progress as { completed?: unknown; total?: unknown }
      if (
        typeof value.completed === 'number' &&
        Number.isFinite(value.completed) &&
        typeof value.total === 'number' &&
        Number.isFinite(value.total)
      ) {
        onProgress?.({ completed: value.completed, total: value.total })
      }
    },
  )
  const parsed = AppleTranslationResponseSchema.safeParse(response)
  if (!parsed.success) throw new Error('Apple Translationの応答形式が不正です。')
  if (!parsed.data.ok || !parsed.data.translations) {
    throw new Error(parsed.data.error || 'Apple Translationの応答が空でした。')
  }
  if (parsed.data.translations.length !== items.length) {
    throw new Error('Apple Translationの翻訳件数が一致しません。')
  }

  const translations = new Map(
    parsed.data.translations.map((translation) => [translation.id, translation.text.trim()]),
  )
  for (const item of items) {
    if (!translations.get(item.id)) {
      throw new Error(`Apple Translationの応答が空でした: ${item.id}`)
    }
  }
  return translations
}
