import { Command, type Child } from '@tauri-apps/plugin-shell'
import { invoke } from '@tauri-apps/api/core'

export type SidecarName =
  | 'binaries/ffmpeg'
  | 'binaries/ffprobe'
  | 'binaries/whisper-cli'
  | 'binaries/llama-server'
  | 'binaries/apple-vision-ocr'
  | 'binaries/apple-speech-transcriber'
  | 'binaries/apple-foundation-models'
  | 'binaries/apple-translator'
  | 'binaries/yt-dlp'

export function getBundledFfmpegPath() {
  return invoke<string>('get_ffmpeg_path')
}

type SidecarStreamHandlers = {
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  signal?: AbortSignal
}

type SidecarStreamResult = {
  code: number | null
  signal: number | null
  stdout: string
  stderr: string
}

type JsonLineSidecarClient = {
  request: (
    message: unknown,
    signal?: AbortSignal,
    onProgress?: (progress: unknown) => void,
  ) => Promise<unknown>
  close: () => Promise<void>
}

function parseOutputChunk(chunk: unknown) {
  return typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk as Uint8Array)
}

/** Keeps an Apple native sidecar warm while exchanging newline-delimited JSON messages. */
export async function openJsonLineSidecar(name: SidecarName, signal?: AbortSignal) {
  const command = Command.sidecar(name, [], { encoding: 'utf-8' })
  const pending = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: unknown) => void
      onProgress?: (progress: unknown) => void
    }
  >()
  let buffer = ''
  let child: Child | null = null
  let closed = false
  let onAbort: (() => void) | null = null

  const rejectPending = (error: unknown) => {
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  }

  const close = async () => {
    if (closed) return
    closed = true
    if (onAbort) signal?.removeEventListener('abort', onAbort)
    rejectPending(new Error('sidecarが終了しました'))
    if (child) await child.kill().catch(() => undefined)
  }

  command.stdout.on('data', (chunk) => {
    buffer += parseOutputChunk(chunk)
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      newlineIndex = buffer.indexOf('\n')
      if (!line) continue

      try {
        const message = JSON.parse(line) as { id?: unknown; type?: unknown }
        const id = typeof message.id === 'string' ? message.id : null
        if (!id) continue
        const entry = pending.get(id)
        if (!entry) continue
        if (message.type === 'progress') {
          entry.onProgress?.(message)
          continue
        }
        pending.delete(id)
        entry.resolve(message)
      } catch {
        // Keep stdout machine-readable; malformed lines are reported by request timeout/close.
      }
    }
  })
  command.once('close', ({ code, signal: terminationSignal }) => {
    closed = true
    if (onAbort) signal?.removeEventListener('abort', onAbort)
    rejectPending(
      new Error(
        `sidecarが終了しました (code=${code ?? 'null'}, signal=${terminationSignal ?? 'null'})`,
      ),
    )
  })
  command.once('error', (error) => {
    closed = true
    rejectPending(new Error(String(error)))
  })

  onAbort = () => {
    void close()
  }
  if (signal?.aborted) throw new DOMException('処理を中止しました。', 'AbortError')
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    child = await command.spawn()
    if (closed) await child.kill().catch(() => undefined)
  } catch (error) {
    await close()
    throw error
  }

  return {
    request(
      message: unknown,
      requestSignal?: AbortSignal,
      onProgress?: (progress: unknown) => void,
    ) {
      if (closed || !child) return Promise.reject(new Error('sidecarは利用できません'))
      if (requestSignal?.aborted) {
        return Promise.reject(new DOMException('処理を中止しました。', 'AbortError'))
      }

      const id = crypto.randomUUID()
      const request = JSON.stringify({ id, ...((message ?? {}) as Record<string, unknown>) })
      return new Promise<unknown>((resolve, reject) => {
        const abort = () => {
          pending.delete(id)
          reject(new DOMException('処理を中止しました。', 'AbortError'))
        }
        requestSignal?.addEventListener('abort', abort, { once: true })
        pending.set(id, {
          resolve: (value) => {
            requestSignal?.removeEventListener('abort', abort)
            resolve(value)
          },
          reject: (error) => {
            requestSignal?.removeEventListener('abort', abort)
            reject(error)
          },
          onProgress,
        })
        void child.write(`${request}\n`).catch((error) => {
          pending.delete(id)
          requestSignal?.removeEventListener('abort', abort)
          reject(error)
        })
      })
    },
    close,
  } satisfies JsonLineSidecarClient
}

/** Runs a sidecar while forwarding stdout/stderr chunks to the caller. */
export function executeSidecarStreaming(
  name: SidecarName,
  args: string[],
  { onStdout, onStderr, signal }: SidecarStreamHandlers = {},
) {
  const command = Command.sidecar(name, args)
  let stdout = ''
  let stderr = ''
  let child: Child | null = null
  let settled = false
  let onAbort: (() => void) | null = null
  let rejectCompletion: (reason?: unknown) => void = () => undefined

  const cleanup = () => {
    if (onAbort) signal?.removeEventListener('abort', onAbort)
    onAbort = null
  }

  const settleWithError = (error: unknown) => {
    if (settled) return
    settled = true
    cleanup()
    rejectCompletion(error)
  }

  const completion = new Promise<SidecarStreamResult>((resolve, reject) => {
    rejectCompletion = reject
    const abort = () => {
      const abortError = new DOMException('処理を中止しました。', 'AbortError')
      if (!child) {
        settleWithError(abortError)
        return
      }
      void child
        .kill()
        .catch(() => undefined)
        .finally(() => settleWithError(abortError))
    }
    onAbort = abort

    if (signal?.aborted) {
      abort()
      return
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    command.stdout.on('data', (chunk) => {
      stdout += chunk
      onStdout?.(chunk)
    })
    command.stderr.on('data', (chunk) => {
      stderr += chunk
      onStderr?.(chunk)
    })
    command.once('close', ({ code, signal: terminationSignal }) => {
      if (settled) return
      if (signal?.aborted) {
        settleWithError(new DOMException('処理を中止しました。', 'AbortError'))
        return
      }
      settled = true
      cleanup()
      resolve({ code, signal: terminationSignal, stdout, stderr })
    })
    command.once('error', settleWithError)
  })

  void command
    .spawn()
    .then((spawnedChild) => {
      child = spawnedChild
      if (signal?.aborted) void spawnedChild.kill().catch(() => undefined)
    })
    .catch((error) => {
      // A spawn failure does not always emit the shell plugin's error event.
      settleWithError(error)
    })

  return completion
}

export function executeSidecar(
  name: SidecarName,
  args: string[],
  { signal }: { signal?: AbortSignal } = {},
) {
  return signal
    ? executeSidecarStreaming(name, args, { signal })
    : Command.sidecar(name, args).execute()
}

export async function executeSidecarRaw(name: SidecarName, args: string[]) {
  const output = await Command.sidecar(name, args, { encoding: 'raw' }).execute()

  // Tauri IPC may deserialize Rust's Vec<u8> as number[] despite the plugin type being Uint8Array.
  return {
    ...output,
    stdout: output.stdout instanceof Uint8Array ? output.stdout : Uint8Array.from(output.stdout),
    stderr: output.stderr instanceof Uint8Array ? output.stderr : Uint8Array.from(output.stderr),
  }
}
