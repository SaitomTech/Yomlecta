import type { SlideData, SlideDetectionResult } from '../../types/project'

export type SlideDetectionStage =
  | 'preparing'
  | 'sampling'
  | 'comparing'
  | 'extracting'
  | 'saving'
  | 'completed'

export type SlideDetectionOutput = {
  result: SlideDetectionResult
  slides: SlideData[]
}

export type PendingSlideDetectionOutput = SlideDetectionOutput & {
  assetRunId: string
}
