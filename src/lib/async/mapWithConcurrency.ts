function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('処理を中止しました。', 'AbortError')
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
  onCompleted?: (completed: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  let completed = 0
  let failure: unknown
  let failed = false

  async function worker() {
    while (!failed) {
      try {
        throwIfAborted(signal)
        const index = nextIndex
        nextIndex += 1
        if (index >= items.length) return

        results[index] = await task(items[index], index)
        completed += 1
        onCompleted?.(completed)
      } catch (error) {
        if (!failed) {
          failed = true
          failure = error
        }
        return
      }
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  if (failed) throw failure
  return results
}
