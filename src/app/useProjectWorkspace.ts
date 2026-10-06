import { useState } from 'react'
import type { MediaProject } from '../types/project'
import { createProjectWorkspace } from './createProjectWorkspace'

export function useProjectWorkspace() {
  const [project, setProject] = useState<MediaProject | null>(null)
  const [workspace] = useState(() => createProjectWorkspace(setProject))
  return { ...workspace, project }
}
