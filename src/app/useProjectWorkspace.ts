import { useState } from 'react'
import type { Project } from '../types/project'
import { createProjectWorkspace } from './createProjectWorkspace'

export function useProjectWorkspace() {
  const [project, setProject] = useState<Project | null>(null)
  const [workspace] = useState(() => createProjectWorkspace(setProject))
  return { ...workspace, project }
}
