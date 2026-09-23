import { invoke } from '@tauri-apps/api/core'

export type OpenAiCredentialStatus = {
  configured: boolean
  lastFour?: string
}

export type OpenAiArticleResponse = {
  body: string
  requestId?: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

export type OpenAiTranscriptionResponse = {
  text: string
  language?: string
  durationSeconds?: number
  requestId?: string
  segments?: Array<{
    startSeconds: number
    endSeconds: number
    text: string
  }>
}

export type OpenAiOcrResponse = {
  text: string
  requestId?: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

export function getOpenAiApiKeyStatus() {
  return invoke<OpenAiCredentialStatus>('get_openai_api_key_status')
}

export function validateAndSaveOpenAiApiKey(apiKey: string, model = 'gpt-6-luna') {
  return invoke<OpenAiCredentialStatus>('validate_and_save_openai_api_key', { apiKey, model })
}

export function testOpenAiConnection(model = 'gpt-6-luna') {
  return invoke<void>('test_openai_connection', { model })
}

export async function transcribeOpenAiAudio({
  audioPath,
  languages,
  prompt,
  keywords,
  signal,
}: {
  audioPath: string
  languages?: Array<'ja' | 'en'>
  prompt?: string
  keywords?: string[]
  signal?: AbortSignal
}) {
  if (signal?.aborted) throw new DOMException('処理を中止しました。', 'AbortError')

  const clientRequestId = crypto.randomUUID()
  const handleAbort = () => {
    void invoke('cancel_openai_request', { clientRequestId }).catch(() => undefined)
  }
  signal?.addEventListener('abort', handleAbort, { once: true })

  try {
    return await invoke<OpenAiTranscriptionResponse>('transcribe_openai_audio', {
      request: { audioPath, languages, prompt, keywords, clientRequestId },
    })
  } catch (error) {
    if (signal?.aborted) throw new DOMException('処理を中止しました。', 'AbortError')
    throw error
  } finally {
    signal?.removeEventListener('abort', handleAbort)
  }
}

export async function recognizeOpenAiImage({
  instructions,
  imageData,
  signal,
}: {
  instructions: string
  imageData: string
  signal?: AbortSignal
}) {
  if (signal?.aborted) throw new DOMException('処理を中止しました。', 'AbortError')

  const clientRequestId = crypto.randomUUID()
  const handleAbort = () => {
    void invoke('cancel_openai_request', { clientRequestId }).catch(() => undefined)
  }
  signal?.addEventListener('abort', handleAbort, { once: true })

  try {
    return await invoke<OpenAiOcrResponse>('recognize_openai_image', {
      request: { instructions, imageData, clientRequestId },
    })
  } catch (error) {
    if (signal?.aborted) throw new DOMException('処理を中止しました。', 'AbortError')
    throw error
  } finally {
    signal?.removeEventListener('abort', handleAbort)
  }
}

export function deleteOpenAiApiKey() {
  return invoke<void>('delete_openai_api_key')
}

export async function generateOpenAiArticle({
  instructions,
  input,
  maxOutputTokens = 8192,
  signal,
}: {
  instructions: string
  input: string
  maxOutputTokens?: number
  signal?: AbortSignal
}) {
  if (signal?.aborted) throw new DOMException('処理を中止しました。', 'AbortError')

  const clientRequestId = crypto.randomUUID()
  const handleAbort = () => {
    void invoke('cancel_openai_request', { clientRequestId }).catch(() => undefined)
  }
  signal?.addEventListener('abort', handleAbort, { once: true })

  try {
    return await invoke<OpenAiArticleResponse>('generate_openai_article', {
      request: { instructions, input, maxOutputTokens, clientRequestId },
    })
  } catch (error) {
    if (signal?.aborted) throw new DOMException('処理を中止しました。', 'AbortError')
    throw error
  } finally {
    signal?.removeEventListener('abort', handleAbort)
  }
}
