import { createHash } from 'node:crypto'
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'

const TARGET_TRIPLE =
  process.env.TAURI_ENV_TARGET_TRIPLE ??
  (process.platform === 'darwin' && process.arch === 'arm64' ? 'aarch64-apple-darwin' : '')
const SIDECAR_DIRECTORY = join(import.meta.dir, '..', 'src-tauri', 'binaries')
const SIDECAR_METADATA_SUFFIX = '.sha256'
const VISION_SOURCE = join(import.meta.dir, '..', 'src-tauri', 'vision-ocr', 'main.swift')
const VISION_SIDECAR_NAME = 'apple-vision-ocr'
const SPEECH_SOURCE = join(import.meta.dir, '..', 'src-tauri', 'speech-transcriber', 'main.swift')
const SPEECH_SIDECAR_NAME = 'apple-speech-transcriber'
const FOUNDATION_MODELS_SOURCE = join(
  import.meta.dir,
  '..',
  'src-tauri',
  'foundation-models',
  'main.swift',
)
const FOUNDATION_MODELS_SIDECAR_NAME = 'apple-foundation-models'
const APPLE_TRANSLATOR_SOURCE = join(
  import.meta.dir,
  '..',
  'src-tauri',
  'apple-translator',
  'main.swift',
)
const APPLE_TRANSLATOR_SIDECAR_NAME = 'apple-translator'
const YT_DLP_SIDECAR_NAME = 'yt-dlp'
const YT_DLP_VERSION = '2026.08.19'
const RELEASE_DIRECTORY = '1787073674_9.0.1'
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const DOWNLOAD_PROGRESS_INTERVAL_MS = 30 * 1000
const LLAMA_RUNTIME_FILES = {
  'libllama-server-impl.dylib': 'libllama-server-impl.dylib',
  'libllama-common.0.dylib': 'libllama-common.0.4.0.dylib',
  'libmtmd.0.dylib': 'libmtmd.0.4.0.dylib',
  'libllama.0.dylib': 'libllama.0.4.0.dylib',
  'libggml.0.dylib': 'libggml.0.23.0.dylib',
  'libggml-cpu.0.dylib': 'libggml-cpu.0.23.0.dylib',
  'libggml-blas.0.dylib': 'libggml-blas.0.23.0.dylib',
  'libggml-metal.0.dylib': 'libggml-metal.0.23.0.dylib',
  'libggml-rpc.0.dylib': 'libggml-rpc.0.23.0.dylib',
  'libggml-base.0.dylib': 'libggml-base.0.23.0.dylib',
} as const

type Sidecar = {
  name: string
  archive: 'zip' | 'tar.gz'
  archiveEntry?: string
  runtimeDirectory?: string
  runtimeFiles?: Readonly<Record<string, string>>
  url: string
  sha256: string
}

const SIDECARS: Sidecar[] = [
  {
    name: 'ffmpeg',
    archive: 'zip',
    url: `https://ffmpeg.martin-riedl.de/download/macos/arm64/${RELEASE_DIRECTORY}/ffmpeg.zip`,
    sha256: '8287a1b2229e05eb41859f073e18e6c52c60a778f2f5e6881070fe51b79407fe',
  },
  {
    name: 'ffprobe',
    archive: 'zip',
    url: `https://ffmpeg.martin-riedl.de/download/macos/arm64/${RELEASE_DIRECTORY}/ffprobe.zip`,
    sha256: '102a26b8940a053298d9929bfaae71e4b6ef65ba5f19a99a88c433108560741a',
  },
  {
    name: 'whisper-cli',
    archive: 'zip',
    archiveEntry: 'whisper-cpp-darwin-arm64',
    url: 'https://github.com/sjoerdteunisse/whisper.cpp/releases/download/v1.0.0/whisper-cpp-darwin-arm64.zip',
    sha256: 'd033bd3f590cad50f39957bf86354f87b44394cb001e3f78a7b47264358103e3',
  },
  {
    name: 'llama-server',
    archive: 'tar.gz',
    archiveEntry: 'llama-server',
    runtimeDirectory: 'llama-runtime',
    runtimeFiles: LLAMA_RUNTIME_FILES,
    url: 'https://github.com/ggml-org/llama.cpp/releases/download/b10853/llama-b10853-bin-macos-arm64.tar.gz',
    sha256: '44ac38967081c681880467e7d8ffed0fa4389797a659f446e87bc31c7e82c48b',
  },
]

const YT_DLP_SIDECAR = {
  name: YT_DLP_SIDECAR_NAME,
  version: YT_DLP_VERSION,
  url: `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp_macos`,
  sha256: '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202',
} as const

function sidecarPath(name: string) {
  return join(SIDECAR_DIRECTORY, `${name}-${TARGET_TRIPLE}`)
}

function sidecarMetadataPath(name: string) {
  return `${sidecarPath(name)}${SIDECAR_METADATA_SUFFIX}`
}

async function buildVisionSidecar(temporaryDirectory: string, force: boolean) {
  const destination = sidecarPath(VISION_SIDECAR_NAME)
  if (!force) {
    try {
      const [sourceStats, destinationStats] = await Promise.all([
        stat(VISION_SOURCE),
        stat(destination),
      ])
      if (destinationStats.size > 0 && destinationStats.mtimeMs >= sourceStats.mtimeMs) return
    } catch {
      // The helper has not been built yet, so continue with compilation.
    }
  }

  const temporaryDestination = join(temporaryDirectory, VISION_SIDECAR_NAME)
  const moduleCachePath = join(temporaryDirectory, 'swift-module-cache')
  await run('swiftc', [
    '-O',
    '-target',
    'arm64-apple-macosx11.0',
    '-module-cache-path',
    moduleCachePath,
    '-framework',
    'Foundation',
    '-framework',
    'Vision',
    VISION_SOURCE,
    '-o',
    temporaryDestination,
  ])
  await chmod(temporaryDestination, 0o755)
  await rename(temporaryDestination, destination)
  console.log(`✓ ${VISION_SIDECAR_NAME}-${TARGET_TRIPLE}`)
}

async function buildSpeechSidecar(temporaryDirectory: string, force: boolean) {
  const destination = sidecarPath(SPEECH_SIDECAR_NAME)
  if (!force) {
    try {
      const [sourceStats, destinationStats] = await Promise.all([
        stat(SPEECH_SOURCE),
        stat(destination),
      ])
      if (destinationStats.size > 0 && destinationStats.mtimeMs >= sourceStats.mtimeMs) return
    } catch {
      // The helper has not been built yet, so continue with compilation.
    }
  }

  const temporaryDestination = join(temporaryDirectory, SPEECH_SIDECAR_NAME)
  const moduleCachePath = join(temporaryDirectory, 'swift-module-cache')
  await run('swiftc', [
    '-O',
    '-parse-as-library',
    '-target',
    'arm64-apple-macosx26.0',
    '-module-cache-path',
    moduleCachePath,
    '-framework',
    'Foundation',
    '-framework',
    'AVFoundation',
    '-framework',
    'Speech',
    SPEECH_SOURCE,
    '-o',
    temporaryDestination,
  ])
  await chmod(temporaryDestination, 0o755)
  await rename(temporaryDestination, destination)
  console.log(`✓ ${SPEECH_SIDECAR_NAME}-${TARGET_TRIPLE}`)
}

async function buildFoundationModelsSidecar(temporaryDirectory: string, force: boolean) {
  const destination = sidecarPath(FOUNDATION_MODELS_SIDECAR_NAME)
  if (!force) {
    try {
      const [sourceStats, destinationStats] = await Promise.all([
        stat(FOUNDATION_MODELS_SOURCE),
        stat(destination),
      ])
      if (destinationStats.size > 0 && destinationStats.mtimeMs >= sourceStats.mtimeMs) return
    } catch {
      // The helper has not been built yet, so continue with compilation.
    }
  }

  const temporaryDestination = join(temporaryDirectory, FOUNDATION_MODELS_SIDECAR_NAME)
  const moduleCachePath = join(temporaryDirectory, 'swift-module-cache')
  await run('swiftc', [
    '-O',
    '-parse-as-library',
    '-target',
    'arm64-apple-macosx26.0',
    '-module-cache-path',
    moduleCachePath,
    '-framework',
    'Foundation',
    '-framework',
    'FoundationModels',
    FOUNDATION_MODELS_SOURCE,
    '-o',
    temporaryDestination,
  ])
  await chmod(temporaryDestination, 0o755)
  await rename(temporaryDestination, destination)
  console.log(`✓ ${FOUNDATION_MODELS_SIDECAR_NAME}-${TARGET_TRIPLE}`)
}

async function buildAppleTranslatorSidecar(temporaryDirectory: string, force: boolean) {
  const destination = sidecarPath(APPLE_TRANSLATOR_SIDECAR_NAME)
  if (!force) {
    try {
      const [sourceStats, destinationStats] = await Promise.all([
        stat(APPLE_TRANSLATOR_SOURCE),
        stat(destination),
      ])
      if (destinationStats.size > 0 && destinationStats.mtimeMs >= sourceStats.mtimeMs) return
    } catch {
      // The helper has not been built yet, so continue with compilation.
    }
  }

  const temporaryDestination = join(temporaryDirectory, APPLE_TRANSLATOR_SIDECAR_NAME)
  const moduleCachePath = join(temporaryDirectory, 'swift-module-cache')
  await run('swiftc', [
    '-O',
    '-parse-as-library',
    '-target',
    'arm64-apple-macosx15.0',
    '-module-cache-path',
    moduleCachePath,
    '-framework',
    'Foundation',
    '-framework',
    'Translation',
    APPLE_TRANSLATOR_SOURCE,
    '-o',
    temporaryDestination,
  ])
  await chmod(temporaryDestination, 0o755)
  await rename(temporaryDestination, destination)
  console.log(`✓ ${APPLE_TRANSLATOR_SIDECAR_NAME}-${TARGET_TRIPLE}`)
}

async function pathExists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function nonEmptyFileExists(path: string) {
  try {
    return (await stat(path)).size > 0
  } catch {
    return false
  }
}

async function run(command: string, args: string[]) {
  const child = Bun.spawn([command, ...args], {
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  if (code !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${code}): ${stderr.trim()}`)
  }

  return stdout
}

async function sha256(path: string) {
  const hash = createHash('sha256')
  const contents = await readFile(path)
  hash.update(contents)
  return hash.digest('hex')
}

async function listArchiveEntries(sidecar: Sidecar, archivePath: string) {
  const output =
    sidecar.archive === 'zip'
      ? await run('unzip', ['-Z1', archivePath])
      : await run('tar', ['-tzf', archivePath])

  return output
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

async function extractArchiveEntry(sidecar: Sidecar, archivePath: string, entry: string) {
  const [command, args] =
    sidecar.archive === 'zip'
      ? ['unzip', ['-p', archivePath, entry]]
      : ['tar', ['-xOf', archivePath, entry]]
  const child = Bun.spawn([command, ...args], {
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const [contents, stderr, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) {
    throw new Error(`${sidecar.name}の展開に失敗しました (${code}): ${stderr.trim()}`)
  }

  return new Uint8Array(contents)
}

async function prepareRuntimeFiles(
  sidecar: Sidecar,
  archivePath: string,
  destination: string,
  entries: string[],
) {
  if (!sidecar.runtimeDirectory || !sidecar.runtimeFiles) return

  const runtimeDirectory = join(SIDECAR_DIRECTORY, sidecar.runtimeDirectory)
  await rm(runtimeDirectory, { force: true, recursive: true })
  await mkdir(runtimeDirectory, { recursive: true })

  for (const [destinationName, sourceName] of Object.entries(sidecar.runtimeFiles)) {
    const entry = entries.find((candidate) => basename(candidate) === sourceName)
    if (!entry) {
      throw new Error(`${sidecar.name}のランタイム ${sourceName} が見つかりませんでした`)
    }

    const runtimePath = join(runtimeDirectory, destinationName)
    await Bun.write(runtimePath, await extractArchiveEntry(sidecar, archivePath, entry))
    await chmod(runtimePath, 0o755)
  }

  await run('install_name_tool', [
    '-add_rpath',
    '@loader_path/../Resources/llama-runtime',
    '-add_rpath',
    '@loader_path/../../binaries/llama-runtime',
    destination,
  ])
}

async function downloadAndExtract(sidecar: (typeof SIDECARS)[number], temporaryDirectory: string) {
  const extension = sidecar.archive === 'zip' ? 'zip' : 'tar.gz'
  const archivePath = join(temporaryDirectory, `${sidecar.name}.${extension}`)
  const startedAt = Date.now()
  console.log(`[${sidecar.name}] ダウンロード開始: ${sidecar.url}`)

  let progressTimer: ReturnType<typeof setInterval> | undefined
  try {
    const response = await fetch(sidecar.url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`${sidecar.name}のダウンロードに失敗しました: HTTP ${response.status}`)
    }

    const contentLength = response.headers.get('content-length')
    console.log(
      `[${sidecar.name}] HTTP ${response.status}` +
        (contentLength ? ` (${contentLength} bytes)` : ' (サイズ不明)'),
    )
    progressTimer = setInterval(() => {
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000)
      console.log(`[${sidecar.name}] ダウンロード中: ${elapsedSeconds}秒経過`)
    }, DOWNLOAD_PROGRESS_INTERVAL_MS)
    await Bun.write(archivePath, response)
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(
        `${sidecar.name}のダウンロードが${DOWNLOAD_TIMEOUT_MS / 60_000}分でタイムアウトしました`,
      )
    }
    throw error
  } finally {
    if (progressTimer) clearInterval(progressTimer)
  }

  const archiveSize = (await stat(archivePath)).size
  const downloadSeconds = Math.round((Date.now() - startedAt) / 1000)
  console.log(`[${sidecar.name}] ダウンロード完了: ${archiveSize} bytes (${downloadSeconds}秒)`)
  console.log(`[${sidecar.name}] SHA-256検証開始`)
  const actualHash = await sha256(archivePath)
  if (actualHash !== sidecar.sha256) {
    throw new Error(
      `${sidecar.name}のSHA-256が一致しません (expected ${sidecar.sha256}, got ${actualHash})`,
    )
  }
  console.log(`[${sidecar.name}] SHA-256検証完了`)

  console.log(`[${sidecar.name}] アーカイブ内容を確認中`)
  const entries = await listArchiveEntries(sidecar, archivePath)
  const entry = entries.find(
    (candidate) => basename(candidate) === (sidecar.archiveEntry ?? sidecar.name),
  )
  if (!entry) {
    throw new Error(`${sidecar.name}をアーカイブ内から見つけられませんでした`)
  }

  const destination = sidecarPath(sidecar.name)
  const temporaryDestination = `${destination}.tmp`
  console.log(`[${sidecar.name}] 実行ファイルを展開中`)
  await Bun.write(temporaryDestination, await extractArchiveEntry(sidecar, archivePath, entry))
  await chmod(temporaryDestination, 0o755)
  await rename(temporaryDestination, destination)
  console.log(`[${sidecar.name}] 実行ファイルの展開完了`)
  if (sidecar.runtimeDirectory) console.log(`[${sidecar.name}] runtimeを展開中`)
  await prepareRuntimeFiles(sidecar, archivePath, destination, entries)
  await Bun.write(sidecarMetadataPath(sidecar.name), `${sidecar.sha256}\n`)
  console.log(
    `✓ ${sidecar.name}-${TARGET_TRIPLE} (${Math.round((Date.now() - startedAt) / 1000)}秒)`,
  )
}

async function downloadBinary(sidecar: typeof YT_DLP_SIDECAR, temporaryDirectory: string) {
  const temporaryDownloadPath = join(temporaryDirectory, sidecar.name)
  const startedAt = Date.now()
  console.log(`[${sidecar.name}] ${sidecar.version}のダウンロード開始: ${sidecar.url}`)

  const response = await fetch(sidecar.url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`${sidecar.name}のダウンロードに失敗しました: HTTP ${response.status}`)
  }

  await Bun.write(temporaryDownloadPath, response)
  const actualHash = await sha256(temporaryDownloadPath)
  if (actualHash !== sidecar.sha256) {
    throw new Error(
      `${sidecar.name}のSHA-256が一致しません (expected ${sidecar.sha256}, got ${actualHash})`,
    )
  }

  const destination = sidecarPath(sidecar.name)
  const temporaryDestination = `${destination}.tmp`
  await Bun.write(temporaryDestination, await readFile(temporaryDownloadPath))
  await chmod(temporaryDestination, 0o755)
  await rename(temporaryDestination, destination)
  await Bun.write(sidecarMetadataPath(sidecar.name), `${sidecar.sha256}\n`)
  console.log(
    `✓ ${sidecar.name}-${TARGET_TRIPLE} (${Math.round((Date.now() - startedAt) / 1000)}秒)`,
  )
}

async function sidecarFileReady(name: string, sha256: string) {
  if (!(await nonEmptyFileExists(sidecarPath(name)))) return false
  try {
    const recordedSha256 = (await readFile(sidecarMetadataPath(name), 'utf8')).trim()
    return recordedSha256 === sha256
  } catch {
    return false
  }
}

async function sidecarReady(sidecar: Sidecar) {
  if (!(await sidecarFileReady(sidecar.name, sidecar.sha256))) return false

  if (!sidecar.runtimeDirectory) return true

  const runtimeDirectory = join(SIDECAR_DIRECTORY, sidecar.runtimeDirectory)
  if (!(await pathExists(runtimeDirectory))) return false
  if (!sidecar.runtimeFiles) return true

  return (
    await Promise.all(
      Object.keys(sidecar.runtimeFiles).map((filename) =>
        nonEmptyFileExists(join(runtimeDirectory, filename)),
      ),
    )
  ).every(Boolean)
}

async function main() {
  if (TARGET_TRIPLE !== 'aarch64-apple-darwin') {
    throw new Error(
      `現在はmacOS Apple Siliconのみ対応しています。検出されたtarget triple: ${TARGET_TRIPLE || 'unknown'}`,
    )
  }

  await mkdir(SIDECAR_DIRECTORY, { recursive: true })
  const force = process.argv.includes('--force')
  const cleanTemporaryDirectory = await mkdtemp(join(tmpdir(), 'video-notes-sidecars-'))
  try {
    await buildVisionSidecar(cleanTemporaryDirectory, force)
    await buildSpeechSidecar(cleanTemporaryDirectory, force)
    await buildFoundationModelsSidecar(cleanTemporaryDirectory, force)
    await buildAppleTranslatorSidecar(cleanTemporaryDirectory, force)
    const downloadedSidecarsReady = (await Promise.all(SIDECARS.map(sidecarReady))).every(Boolean)
    const visionSidecarReady = await nonEmptyFileExists(sidecarPath(VISION_SIDECAR_NAME))
    const speechSidecarReady = await nonEmptyFileExists(sidecarPath(SPEECH_SIDECAR_NAME))
    const foundationModelsSidecarReady = await nonEmptyFileExists(
      sidecarPath(FOUNDATION_MODELS_SIDECAR_NAME),
    )
    const ytDlpSidecarReady = await sidecarFileReady(YT_DLP_SIDECAR.name, YT_DLP_SIDECAR.sha256)
    if (
      !force &&
      downloadedSidecarsReady &&
      visionSidecarReady &&
      speechSidecarReady &&
      foundationModelsSidecarReady &&
      ytDlpSidecarReady
    ) {
      console.log(`✓ sidecarは準備済みです (${TARGET_TRIPLE})`)
      return
    }

    for (const sidecar of SIDECARS) {
      if (!force && (await sidecarReady(sidecar))) {
        console.log(`✓ ${sidecar.name}-${TARGET_TRIPLE} (準備済み、ダウンロードをスキップ)`)
        continue
      }
      console.log(`[${sidecar.name}] sidecarの準備を開始`)
      await downloadAndExtract(sidecar, cleanTemporaryDirectory)
    }

    if (!force && ytDlpSidecarReady) {
      console.log(`✓ ${YT_DLP_SIDECAR_NAME}-${TARGET_TRIPLE} (準備済み、ダウンロードをスキップ)`)
    } else {
      console.log(`[${YT_DLP_SIDECAR_NAME}] sidecarの準備を開始`)
      await downloadBinary(YT_DLP_SIDECAR, cleanTemporaryDirectory)
    }
  } finally {
    await rm(cleanTemporaryDirectory, { force: true, recursive: true })
  }

  console.log('sidecarの準備が完了しました。')
}

await main()
