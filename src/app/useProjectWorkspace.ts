import { useCallback, useRef, useState } from 'react'
import type { MediaProject } from '../types/project'

export function useProjectWorkspace() {
  const [project, setProject] = useState<MediaProject | null>(null)
  const projectRef = useRef<MediaProject | null>(null)
  const projectOperationQueue = useRef<Promise<unknown> | null>(null)

  const setProjectState = useCallback((nextProject: MediaProject) => {
    projectRef.current = nextProject
    setProject(nextProject)
    return nextProject
  }, [])

  const clearProjectState = useCallback(() => {
    projectRef.current = null
    setProject(null)
  }, [])

  const enqueueProjectOperation = useCallback(<T>(operation: () => Promise<T>) => {
    const previous = projectOperationQueue.current ?? Promise.resolve()
    const next = previous.then(operation, operation)
    projectOperationQueue.current = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }, [])

  return {
    project,
    projectRef,
    setProjectState,
    clearProjectState,
    enqueueProjectOperation,
  }
}
