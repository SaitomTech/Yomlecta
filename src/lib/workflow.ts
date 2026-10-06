export type WorkflowStep =
  | 'import'
  | 'crop'
  | 'detect-slides'
  | 'generate-notes'
  | 'article-review'
  | 'export'

export const WORKFLOW_STEPS: Array<{ id: WorkflowStep; label: string }> = [
  { id: 'crop', label: '時間範囲と表示領域を設定' },
  { id: 'detect-slides', label: 'スライド区間を検出' },
  { id: 'generate-notes', label: '文字起こしとOCR' },
  { id: 'article-review', label: '記事の生成・編集' },
]

export function getWorkflowStepIndex(step: WorkflowStep) {
  // Legacy completion marker remains readable, but is no longer a visible step.
  if (step === 'export') return WORKFLOW_STEPS.length
  return WORKFLOW_STEPS.findIndex((workflowStep) => workflowStep.id === step)
}

export function getFurthestWorkflowStep<T extends WorkflowStep>(first: T, second: T): T {
  return getWorkflowStepIndex(first) >= getWorkflowStepIndex(second) ? first : second
}

export function isWorkflowStepReached(maxReachedStep: WorkflowStep, step: WorkflowStep) {
  return getWorkflowStepIndex(step) <= getWorkflowStepIndex(maxReachedStep)
}

export function canNavigateToWorkflowStep(maxReachedStep: WorkflowStep, step: WorkflowStep) {
  return step !== 'import' && step !== 'export' && isWorkflowStepReached(maxReachedStep, step)
}
