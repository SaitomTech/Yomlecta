import { UserFacingError, withUserFacingError } from '../../lib/errors'
import { extractAudio, extractAudioChunkForOpenAi } from '../../lib/media/ffmpeg'
import { transcribeOpenAiAudio } from '../../lib/openai/openai'
import {
  getAudioAssetPath,
  getTranscriptionAudioChunkPath,
  resetTranscriptionAudioChunks,
} from '../../lib/storage/projectAssets'
import { fileExists, getFileSize } from '../../lib/tauri/filesystem'
import { runAppleSpeech } from '../../lib/speech/appleSpeech'
import {
  getTranscriptionModel,
  OPENAI_TRANSCRIBE_MODEL,
  type TranscriptionModel,
  type TranscriptionModelId,
} from '../../lib/transcription/transcriptionModel'
import { ensureWhisperModel } from '../../lib/whisper/modelManager'
import { runWhisper } from '../../lib/whisper/whisper'
import { normalizeTranscriptSegments } from '../../lib/pipeline/normalizeTranscriptSegments'
import { transcriptionRangesForArticleBlocks } from '../../lib/pipeline/articleBlocks'
import { buildOpenAiTranscriptionContext } from '../../lib/pipeline/transcriptionContext'
import { getActiveArticleSourceContext } from '../../lib/project/articleSource'
import {
  requireActiveArticleId,
  type MediaProject,
  type TranscriptionKeywordChunk,
  type TranscriptSegment,
  type TranscriptionResult,
} from '../../types/project'

export type TranscriptionLanguage = 'auto' | 'ja' | 'en'
export type TranscriptionStage =
  | 'preparing-model'
  | 'extracting-audio'
  | 'preparing-chunks'
  | 'transcribing'
  | 'saving'

export type TranscriptionChunkProgress = {
  completed: number
  total: number
}

type RunTranscriptionInput = {
  project: MediaProject
  language: TranscriptionLanguage
  modelId: TranscriptionModelId
  onStage?: (stage: TranscriptionStage) => void
  onProgress?: (progress: number | null) => void
  onChunkProgress?: (progress: TranscriptionChunkProgress | null) => void
  signal?: AbortSignal
}

type ChunkRange = {
  startMs: number
  endMs: number
}

type PreparedChunk = ChunkRange & {
  path: string
}

type OpenAiTranscriptionProvider = {
  provider: 'openai'
  effectiveLanguage: TranscriptionLanguage
  prepareChunk: (audioPath: string, outputPath: string, range: ChunkRange) => Promise<number>
  transcribeChunk: (chunk: PreparedChunk) => Promise<{
    language?: string
    segments: TranscriptSegment[]
    keywords: string[]
  }>
}

const MAX_OPENAI_AUDIO_BYTES = 25_000_000
const MIN_OPENAI_CHUNK_MS = 1000
const MAX_OPENAI_CONCURRENT_REQUESTS = 4
const MAX_OPENAI_CHUNK_DURATION_MS = 15 * 60 * 1000
const TARGET_OPENAI_CHUNK_DURATION_MS = 60 * 1000
const TRANSCRIPTION_PIPELINE_VERSION = 'transcription-v2-bounded-article-ranges'

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('処理を中止しました。', 'AbortError')
}

function inputFingerprint(project: MediaProject, modelId: TranscriptionModelId, language: string) {
  const context = getActiveArticleSourceContext(project)
  const source = context.source
  const metadata = source.metadata
  const ocrContextFingerprint =
    modelId === OPENAI_TRANSCRIBE_MODEL.id
      ? JSON.stringify(
          project.slides.map((slide) => [
            slide.id,
            slide.startMs,
            slide.endMs,
            slide.ocr?.rawText ?? '',
          ]),
        )
      : ''
  const baseFingerprint = [
    source.path,
    source.sizeBytes ?? 'unknown-size',
    metadata.durationMs,
    metadata.width,
    metadata.height,
    context.range.startMs,
    context.range.endMs,
    JSON.stringify(context.crop),
    JSON.stringify(context.perspectiveCrop ?? null),
    modelId,
    language,
    TRANSCRIPTION_PIPELINE_VERSION,
  ].join(':')
  return modelId === OPENAI_TRANSCRIBE_MODEL.id
    ? `${baseFingerprint}:${ocrContextFingerprint}`
    : baseFingerprint
}

async function prepareAudio(
  project: MediaProject,
  signal: AbortSignal | undefined,
  onStage?: (stage: TranscriptionStage) => void,
) {
  const context = getActiveArticleSourceContext(project)
  throwIfAborted(signal)
  onStage?.('extracting-audio')
  const audioError =
    '動画から音声を準備できませんでした。音声トラックを確認して、再試行してください。'
  return withUserFacingError(audioError, async () => {
    const path = await getAudioAssetPath(project.id, requireActiveArticleId(project))
    await extractAudio({
      path: context.source.path,
      outputPath: path,
      startMs: context.range.startMs,
      endMs: context.range.endMs,
      signal,
    })
    if (!(await fileExists(path))) throw new UserFacingError(audioError)
    return path
  })
}

async function runAppleTranscription({
  project,
  language,
  model,
  onStage,
  onProgress,
  onChunkProgress,
  signal,
}: RunTranscriptionInput & {
  model: Extract<TranscriptionModel, { provider: 'apple' }>
}): Promise<TranscriptionResult> {
  throwIfAborted(signal)
  onStage?.('preparing-model')
  onProgress?.(null)
  onChunkProgress?.(null)
  const audioPath = await prepareAudio(project, signal, onStage)

  throwIfAborted(signal)
  onStage?.('transcribing')
  onProgress?.(null)
  const recognition = await withUserFacingError(
    'Apple SpeechTranscriberで音声を文字起こしできませんでした。macOSの対応状況と音声を確認して、再試行してください。',
    () =>
      runAppleSpeech({
        audioPath,
        language,
        onProgress,
        signal,
      }),
  )

  const normalizedLanguage = recognition.language.toLowerCase().startsWith('ja')
    ? 'ja'
    : recognition.language.toLowerCase().startsWith('en')
      ? 'en'
      : recognition.language

  return {
    model: model.id,
    provider: model.provider,
    engineVersion: recognition.engineVersion,
    language: normalizedLanguage,
    audioPath,
    segments: normalizeTranscriptSegments(recognition.segments),
    transcribedAt: new Date().toISOString(),
    inputFingerprint: inputFingerprint(project, model.id, language),
  }
}

function createOpenAiAudioRanges(project: MediaProject) {
  const context = getActiveArticleSourceContext(project)
  const durationMs = Math.max(1, context.range.endMs - context.range.startMs)
  return transcriptionRangesForArticleBlocks(
    durationMs,
    project.articleBlocks,
    MAX_OPENAI_CHUNK_DURATION_MS,
    TARGET_OPENAI_CHUNK_DURATION_MS,
  )
}

async function runLocalTranscription({
  project,
  language,
  model,
  onStage,
  onProgress,
  signal,
}: RunTranscriptionInput & {
  model: Extract<TranscriptionModel, { provider: 'local' }>
}): Promise<TranscriptionResult> {
  const effectiveLanguage = model.model.languageSupport === 'ja' ? 'ja' : language
  const context = getActiveArticleSourceContext(project)
  throwIfAborted(signal)
  onStage?.('preparing-model')
  onProgress?.(null)

  const modelPath = await withUserFacingError(
    '文字起こしモデルを準備できませんでした。通信状況と空き容量を確認して、再試行してください。',
    () =>
      ensureWhisperModel({
        modelId: model.id,
        signal,
        onProgress: ({ receivedBytes, totalBytes }) => {
          onProgress?.(totalBytes > 0 ? receivedBytes / totalBytes : null)
        },
      }),
  )

  throwIfAborted(signal)
  onStage?.('extracting-audio')
  onProgress?.(null)
  const audioError =
    '動画から音声を準備できませんでした。音声トラックを確認して、再試行してください。'
  const audioPath = await withUserFacingError(audioError, async () => {
    const path = await getAudioAssetPath(project.id, requireActiveArticleId(project))
    await extractAudio({
      path: context.source.path,
      outputPath: path,
      startMs: context.range.startMs,
      endMs: context.range.endMs,
      signal,
    })
    if (!(await fileExists(path))) throw new UserFacingError(audioError)
    return path
  })

  throwIfAborted(signal)
  onStage?.('transcribing')
  onProgress?.(null)
  await resetTranscriptionAudioChunks(project.id, requireActiveArticleId(project), 'local')
  const rawTranscript = await withUserFacingError(
    '音声を文字起こしできませんでした。アプリを再起動して、再試行してください。',
    () =>
      runWhisper({
        projectId: project.id,
        articleId: requireActiveArticleId(project),
        audioPath,
        modelPath,
        language: effectiveLanguage,
        onProgress,
        signal,
      }),
  )

  return {
    model: model.id,
    provider: model.provider,
    language: rawTranscript.language ?? effectiveLanguage,
    audioPath,
    segments: normalizeTranscriptSegments(rawTranscript.segments),
    transcribedAt: new Date().toISOString(),
    inputFingerprint: inputFingerprint(project, model.id, effectiveLanguage),
  }
}

function createOpenAiProvider({
  project,
  language,
  signal,
}: Omit<RunTranscriptionInput, 'modelId' | 'onStage' | 'onProgress' | 'onChunkProgress'> & {
  model: Extract<TranscriptionModel, { provider: 'openai' }>
}): OpenAiTranscriptionProvider {
  const effectiveLanguage = language

  return {
    provider: 'openai',
    effectiveLanguage,
    prepareChunk: async (audioPath, outputPath, range) => {
      const preparedPath = await extractAudioChunkForOpenAi({
        path: audioPath,
        outputPath,
        startMs: range.startMs,
        durationMs: range.endMs - range.startMs,
        signal,
      })
      return getFileSize(preparedPath)
    },
    transcribeChunk: async (chunk) => {
      const context = buildOpenAiTranscriptionContext(
        project.slides,
        { startMs: chunk.startMs, endMs: chunk.endMs },
        effectiveLanguage,
      )
      const result = await transcribeOpenAiAudio({
        audioPath: chunk.path,
        languages: effectiveLanguage === 'auto' ? undefined : [effectiveLanguage],
        ...context,
        signal,
      })
      const text = result.text.trim()
      const segments =
        result.segments
          ?.map((segment) => ({
            id: `segment-${segment.startSeconds}-${segment.endSeconds}`,
            startMs: Math.max(0, segment.startSeconds * 1000),
            endMs: Math.max(0, segment.endSeconds * 1000),
            text: segment.text.trim(),
          }))
          .filter((segment) => segment.text && segment.endMs >= segment.startMs) ?? []
      return {
        language: result.language,
        keywords: context.keywords ?? [],
        segments:
          segments.length > 0
            ? segments
            : text
              ? [
                  {
                    id: `segment-0-${chunk.startMs}-${chunk.endMs}`,
                    startMs: 0,
                    endMs: chunk.endMs - chunk.startMs,
                    text,
                  },
                ]
              : [],
      }
    },
  }
}

async function prepareOpenAiRange({
  project,
  provider,
  audioPath,
  range,
  chunkIndex,
  signal,
}: {
  project: MediaProject
  provider: OpenAiTranscriptionProvider
  audioPath: string
  range: ChunkRange
  chunkIndex: number
  signal?: AbortSignal
}): Promise<PreparedChunk[]> {
  throwIfAborted(signal)
  const path = await getTranscriptionAudioChunkPath(
    project.id,
    requireActiveArticleId(project),
    provider.provider,
    chunkIndex,
  )
  const sizeBytes = await provider.prepareChunk(audioPath, path, range)
  if (sizeBytes <= MAX_OPENAI_AUDIO_BYTES) return [{ ...range, path }]

  if (range.endMs - range.startMs <= MIN_OPENAI_CHUNK_MS) {
    throw new UserFacingError('OpenAI送信用音声を25MB以下に分割できませんでした。')
  }

  const midpointMs = range.startMs + Math.floor((range.endMs - range.startMs) / 2)
  const leftChunks = await prepareOpenAiRange({
    project,
    provider,
    audioPath,
    range: { startMs: range.startMs, endMs: midpointMs },
    chunkIndex,
    signal,
  })
  const rightChunks = await prepareOpenAiRange({
    project,
    provider,
    audioPath,
    range: { startMs: midpointMs, endMs: range.endMs },
    chunkIndex: chunkIndex + leftChunks.length,
    signal,
  })
  return [...leftChunks, ...rightChunks]
}

function reportChunkProgress(
  completed: number,
  total: number,
  onProgress?: (progress: number | null) => void,
  onChunkProgress?: (progress: TranscriptionChunkProgress | null) => void,
) {
  onProgress?.(total > 0 ? completed / total : null)
  onChunkProgress?.({ completed, total })
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
  onCompleted?: (completed: number) => void,
) {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  let completed = 0
  let failure: unknown

  async function worker() {
    while (failure === undefined) {
      throwIfAborted(signal)
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return

      try {
        results[index] = await task(items[index], index)
        completed += 1
        onCompleted?.(completed)
      } catch (error) {
        failure ??= error
        return
      }
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  if (failure !== undefined) throw failure
  return results
}

function offsetSegments(chunk: PreparedChunk, segments: TranscriptSegment[]) {
  return segments.map((segment) => {
    const startMs = Math.min(chunk.endMs, chunk.startMs + Math.max(0, segment.startMs))
    return {
      id: segment.id,
      startMs,
      endMs: Math.max(startMs, Math.min(chunk.endMs, chunk.startMs + Math.max(0, segment.endMs))),
      text: segment.text,
    }
  })
}

export async function runTranscription(input: RunTranscriptionInput): Promise<TranscriptionResult> {
  const { project, modelId, onStage, onProgress, onChunkProgress, signal } = input
  const model = getTranscriptionModel(modelId)
  if (model.provider === 'apple') {
    return runAppleTranscription({ ...input, model })
  }
  if (model.provider === 'local') {
    return runLocalTranscription({ ...input, model })
  }

  const provider = createOpenAiProvider({ ...input, model })
  const context = getActiveArticleSourceContext(project)

  throwIfAborted(signal)
  onStage?.('preparing-model')
  onProgress?.(null)
  onChunkProgress?.(null)

  throwIfAborted(signal)
  onStage?.('extracting-audio')
  onProgress?.(null)
  const audioError =
    '動画から音声を準備できませんでした。音声トラックを確認して、再試行してください。'
  const audioPath = await withUserFacingError(audioError, async () => {
    const path = await getAudioAssetPath(project.id, requireActiveArticleId(project))
    await extractAudio({
      path: context.source.path,
      outputPath: path,
      startMs: context.range.startMs,
      endMs: context.range.endMs,
      signal,
    })
    if (!(await fileExists(path))) throw new UserFacingError(audioError)
    return path
  })

  await resetTranscriptionAudioChunks(project.id, requireActiveArticleId(project), 'openai')
  const ranges = createOpenAiAudioRanges(project)
  const chunks: PreparedChunk[] = []
  onStage?.('preparing-chunks')
  reportChunkProgress(0, ranges.length, onProgress, onChunkProgress)
  for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
    throwIfAborted(signal)
    const preparedChunks = await prepareOpenAiRange({
      project,
      provider,
      audioPath,
      range: ranges[rangeIndex],
      chunkIndex: chunks.length,
      signal,
    })
    chunks.push(...preparedChunks)
    reportChunkProgress(rangeIndex + 1, ranges.length, onProgress, onChunkProgress)
  }

  onStage?.('transcribing')
  reportChunkProgress(0, chunks.length, onProgress, onChunkProgress)
  const segments: TranscriptSegment[] = []
  const keywordChunks: TranscriptionKeywordChunk[] = []
  let detectedLanguage: string | undefined
  const transcriptionError =
    'OpenAI APIで音声を文字起こしできませんでした。APIキーと利用上限を確認してください。'
  await withUserFacingError(transcriptionError, async () => {
    const results = await mapWithConcurrency(
      chunks,
      MAX_OPENAI_CONCURRENT_REQUESTS,
      (chunk) => provider.transcribeChunk(chunk),
      signal,
      (completed) => reportChunkProgress(completed, chunks.length, onProgress, onChunkProgress),
    )

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex]
      const result = results[chunkIndex]
      detectedLanguage ??= result.language
      segments.push(...offsetSegments(chunk, result.segments))
      keywordChunks.push({
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        keywords: result.keywords,
      })
    }
  })

  return {
    model: model.id,
    provider: model.provider,
    language: detectedLanguage ?? provider.effectiveLanguage,
    audioPath,
    segments: normalizeTranscriptSegments(
      segments.sort((first, second) => first.startMs - second.startMs),
    ),
    transcribedAt: new Date().toISOString(),
    inputFingerprint: inputFingerprint(project, model.id, provider.effectiveLanguage),
    keywordContext: {
      chunks: keywordChunks,
      generatedAt: new Date().toISOString(),
    },
  }
}
