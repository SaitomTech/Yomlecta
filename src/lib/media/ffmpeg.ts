import { executeSidecar, executeSidecarRaw } from '../tauri/sidecar'
import type { CropRegion, MediaMetadata, PerspectiveCrop } from '../../types/project'
import type { VideoFormatAdjustment } from '../../types/media'
import { computeAverageLuma, computeDHash } from './dhash'

export async function extractVideoThumbnail(path: string, outputPath: string, timestampMs = 0) {
  const seekArgs = timestampMs > 0 ? ['-ss', String(timestampMs / 1000)] : []
  const output = await executeSidecar('binaries/ffmpeg', [
    '-hide_banner',
    '-v',
    'error',
    ...seekArgs,
    '-i',
    path,
    '-frames:v',
    '1',
    '-vf',
    'scale=480:-2:force_original_aspect_ratio=decrease',
    '-q:v',
    '4',
    '-y',
    outputPath,
  ])
  if (output.code !== 0) {
    throw new Error(
      output.stderr.trim() || `動画サムネイルの生成に失敗しました (code ${output.code})`,
    )
  }
  return outputPath
}

export type FrameHash = {
  timestampMs: number
  hash: string
  averageLuma?: number
}

type SampleCropFramesInput = {
  path: string
  crop: CropRegion
  perspectiveCrop?: PerspectiveCrop
  metadata: Pick<MediaMetadata, 'width' | 'height'>
  sampleIntervalMs: number
  startMs?: number
  endMs?: number
}

type RepresentativeFrameInput = {
  path: string
  crop: CropRegion
  perspectiveCrop?: PerspectiveCrop
  metadata: Pick<MediaMetadata, 'width' | 'height'>
  timestampMs: number
  outputPath: string
  signal?: AbortSignal
}

type CropDetectionFrameInput = {
  path: string
  timestampMs: number
  outputPath: string
  signal?: AbortSignal
}

type ExtractAudioInput = {
  path: string
  outputPath: string
  startMs?: number
  endMs?: number
  signal?: AbortSignal
}

type ExtractAudioChunkInput = {
  path: string
  outputPath: string
  startMs: number
  durationMs: number
  signal?: AbortSignal
}

type ConvertVideoForWebViewInput = {
  path: string
  outputPath: string
  adjustment: VideoFormatAdjustment
  signal?: AbortSignal
}

function outputText(value: string | Uint8Array) {
  return typeof value === 'string' ? value : new TextDecoder().decode(value)
}

function filterNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(4) : '0'
}

function fileExtension(path: string) {
  return path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase()
}

function hasMp4Container(formatName?: string) {
  return formatName?.split(',').some((format) => format.trim() === 'mp4') ?? false
}

export function getWebViewFormatAdjustment(
  path: string,
  metadata: Pick<MediaMetadata, 'formatName' | 'videoCodec' | 'videoPixelFormat' | 'audioCodec'>,
): VideoFormatAdjustment {
  return {
    container: fileExtension(path) !== 'mp4' || !hasMp4Container(metadata.formatName),
    video: metadata.videoCodec !== 'h264' || metadata.videoPixelFormat !== 'yuv420p',
    audio: metadata.audioCodec !== 'aac',
  }
}

function perspectiveOutputSize(perspectiveCrop: PerspectiveCrop, outputWidth = 1280) {
  const aspectRatio = Math.max(0.1, perspectiveCrop.aspectRatio.value)
  const width = Math.max(2, Math.round(outputWidth / 2) * 2)
  const height = Math.max(2, Math.round(width / aspectRatio / 2) * 2)
  return { width, height }
}

/** Builds the one crop transform shared by detection, preview exports, and OCR images. */
export function buildCropVideoFilter({
  crop,
  perspectiveCrop,
  metadata,
  outputWidth,
  outputHeight,
  scaleFlags = 'lanczos',
}: {
  crop: CropRegion
  perspectiveCrop?: PerspectiveCrop
  metadata: Pick<MediaMetadata, 'width' | 'height'>
  outputWidth?: number
  outputHeight?: number
  scaleFlags?: 'area' | 'fast_bilinear' | 'lanczos'
}) {
  if (!perspectiveCrop) {
    const scale = outputWidth
      ? `,scale=${outputWidth}:${outputHeight ?? -2}:flags=${scaleFlags}`
      : ''
    return `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}${scale}`
  }

  const { width, height } = perspectiveOutputSize(perspectiveCrop, outputWidth ?? 1280)
  const outputSize =
    outputWidth && outputHeight
      ? `${outputWidth}:${outputHeight}`
      : `${width}:${outputHeight ?? height}`
  const { topLeft, topRight, bottomRight, bottomLeft } = perspectiveCrop.corners
  // FFmpeg's source order is top-left, top-right, bottom-left, bottom-right.
  const points = [topLeft, topRight, bottomLeft, bottomRight]
    .flatMap((point) => [point.x * metadata.width, point.y * metadata.height])
    .map(filterNumber)
    .join(':')

  return `perspective=${points}:sense=source,scale=${outputSize}:flags=${scaleFlags},setsar=1`
}

/** Samples the configured slide region for boundary detection and crop stability. */
export async function sampleCropFrames({
  path,
  crop,
  perspectiveCrop,
  metadata,
  sampleIntervalMs,
  startMs = 0,
  endMs,
}: SampleCropFramesInput): Promise<FrameHash[]> {
  const frameWidth = 9
  const frameHeight = 8
  const frameSize = frameWidth * frameHeight
  const fps = 1000 / sampleIntervalMs
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('サンプリング間隔が不正です')

  const durationSeconds =
    endMs === undefined ? undefined : Math.max(0.001, (endMs - Math.max(0, startMs)) / 1000)
  const output = await executeSidecarRaw('binaries/ffmpeg', [
    '-hide_banner',
    '-v',
    'error',
    ...(startMs > 0 ? ['-ss', String(startMs / 1000)] : []),
    '-i',
    path,
    ...(durationSeconds ? ['-t', String(durationSeconds)] : []),
    '-an',
    '-sn',
    '-vf',
    `fps=${fps},${buildCropVideoFilter({
      crop,
      perspectiveCrop,
      metadata,
      outputWidth: frameWidth,
      outputHeight: frameHeight,
      scaleFlags: 'area',
    })},format=gray`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'gray',
    'pipe:1',
  ])

  if (output.code !== 0) {
    const detail = outputText(output.stderr).trim()
    throw new Error(detail || `ffmpegが終了コード${output.code}で終了しました`)
  }

  const rawFrames = output.stdout
  const frameCount = Math.floor(rawFrames.length / frameSize)
  if (frameCount === 0) throw new Error('サンプリングできるフレームがありません')

  const frames = Array.from({ length: frameCount }, (_, index) => {
    const pixels = rawFrames.subarray(index * frameSize, (index + 1) * frameSize)
    return {
      timestampMs: index * sampleIntervalMs,
      hash: computeDHash(pixels, frameWidth, frameHeight),
      averageLuma: computeAverageLuma(pixels),
    }
  })
  return frames
}

export async function extractRepresentativeFrame({
  path,
  crop,
  perspectiveCrop,
  metadata,
  timestampMs,
  outputPath,
  signal,
}: RepresentativeFrameInput) {
  const output = await executeSidecar(
    'binaries/ffmpeg',
    [
      '-hide_banner',
      '-v',
      'error',
      '-ss',
      String(Math.max(0, timestampMs / 1000)),
      '-i',
      path,
      '-an',
      '-sn',
      '-vf',
      buildCropVideoFilter({
        crop,
        perspectiveCrop,
        metadata,
        outputWidth: 1280,
        scaleFlags: 'lanczos',
      }),
      '-frames:v',
      '1',
      '-q:v',
      '3',
      '-y',
      outputPath,
    ],
    { signal },
  )

  if (output.code !== 0) {
    const detail = output.stderr.trim()
    throw new Error(detail || `代表フレームの抽出に失敗しました (code ${output.code})`)
  }

  return outputPath
}

/** Extracts a small still image for local slide-region detection. */
export async function extractCropDetectionFrame({
  path,
  timestampMs,
  outputPath,
  signal,
}: CropDetectionFrameInput) {
  const output = await executeSidecar(
    'binaries/ffmpeg',
    [
      '-hide_banner',
      '-v',
      'error',
      '-ss',
      String(Math.max(0, timestampMs / 1000)),
      '-i',
      path,
      '-an',
      '-sn',
      '-dn',
      '-vf',
      'scale=640:-2:flags=fast_bilinear',
      '-frames:v',
      '1',
      '-q:v',
      '6',
      '-y',
      outputPath,
    ],
    { signal },
  )

  if (output.code !== 0) {
    const detail = output.stderr.trim()
    throw new Error(detail || `crop候補フレームの抽出に失敗しました (code ${output.code})`)
  }

  return outputPath
}

/** Extracts a 640px-wide full-frame still for local visual classification. */
export const extractFullFrame = extractCropDetectionFrame

export async function extractAudio({
  path,
  outputPath,
  startMs = 0,
  endMs,
  signal,
}: ExtractAudioInput) {
  const durationSeconds =
    endMs === undefined ? undefined : Math.max(0.001, (endMs - Math.max(0, startMs)) / 1000)
  const output = await executeSidecar(
    'binaries/ffmpeg',
    [
      '-hide_banner',
      '-v',
      'error',
      ...(startMs > 0 ? ['-ss', String(startMs / 1000)] : []),
      '-i',
      path,
      ...(durationSeconds ? ['-t', String(durationSeconds)] : []),
      '-vn',
      '-sn',
      '-dn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      '-y',
      outputPath,
    ],
    { signal },
  )

  if (output.code !== 0) {
    const detail = output.stderr.trim()
    throw new Error(detail || `音声の抽出に失敗しました (code ${output.code})`)
  }

  return outputPath
}

/** Converts only tracks that are outside the WebView-compatible format. */
export async function convertVideoForWebView({
  path,
  outputPath,
  adjustment,
  signal,
}: ConvertVideoForWebViewInput) {
  const videoArguments = adjustment.video
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p']
    : ['-c:v', 'copy']
  const audioArguments = adjustment.audio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-c:a', 'copy']

  const output = await executeSidecar(
    'binaries/ffmpeg',
    [
      '-hide_banner',
      '-v',
      'error',
      '-i',
      path,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      ...videoArguments,
      ...audioArguments,
      '-sn',
      '-dn',
      '-movflags',
      '+faststart',
      '-y',
      outputPath,
    ],
    { signal },
  )

  if (output.code !== 0) {
    const detail = output.stderr.trim()
    throw new Error(detail || `動画をWebView対応形式へ変換できませんでした (code ${output.code})`)
  }

  return outputPath
}

/** Creates a compact upload copy while preserving the local WAV used by whisper.cpp. */
export async function extractAudioChunkForOpenAi({
  path,
  outputPath,
  startMs,
  durationMs,
  signal,
}: ExtractAudioChunkInput) {
  const output = await executeSidecar(
    'binaries/ffmpeg',
    [
      '-hide_banner',
      '-v',
      'error',
      '-ss',
      String(Math.max(0, startMs / 1000)),
      '-i',
      path,
      '-t',
      String(Math.max(0.001, durationMs / 1000)),
      '-vn',
      '-sn',
      '-dn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'aac',
      '-b:a',
      '32k',
      '-y',
      outputPath,
    ],
    { signal },
  )

  if (output.code !== 0) {
    const detail = output.stderr.trim()
    throw new Error(detail || `OpenAI送信用音声の準備に失敗しました (code ${output.code})`)
  }

  return outputPath
}
