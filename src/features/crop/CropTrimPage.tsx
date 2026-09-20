import { ArrowRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AppHeader } from '../../components/AppHeader'
import { ArticleContextRow } from '../../components/ArticleContextRow'
import { WorkflowBar } from '../../components/WorkflowBar'
import { WorkflowPanelHeader } from '../../components/WorkflowPanelHeader'
import type { WorkflowStep } from '../../lib/workflow'
import type { CropRegion, MediaProject, PerspectiveCrop, VideoTrimRange } from '../../types/project'
import { ArticleNavigationBar } from '../article/components/ArticleNavigationBar'
import { CropSettingsPanel } from '../project/article-creator/CropSettingsPanel'
import { RangeEditor } from '../project/article-creator/RangeEditor'
import { useArticleRangeEditor } from '../project/article-creator/useArticleRangeEditor'

type CropTrimPageProps = {
  project: MediaProject
  onCompleted: (
    range: VideoTrimRange,
    crop: CropRegion,
    perspectiveCrop?: PerspectiveCrop,
  ) => void | Promise<void>
  onHome: () => void
  onArticles: () => void
  onBackToProject: () => void
  onOpenArticle: (articleId: string) => void | Promise<void>
  onSaveTitle: (title: string) => void | Promise<void>
  maxReachedStep: WorkflowStep
  onStepClick: (step: WorkflowStep) => void
}

export function CropTrimPage({
  project,
  onCompleted,
  onHome,
  onArticles,
  onBackToProject,
  onOpenArticle,
  onSaveTitle,
  maxReachedStep,
  onStepClick,
}: CropTrimPageProps) {
  const article = project.articles.find((candidate) => candidate.id === project.activeArticleId)
  const video = useMemo(
    () =>
      project.videos.find((candidate) => candidate.id === article?.sourceVideoId) ??
      project.videos[0] ??
      null,
    [article?.sourceVideoId, project.videos],
  )

  if (!article || !video) return null

  return (
    <CropTrimEditor
      article={article}
      project={project}
      video={video}
      onCompleted={onCompleted}
      onHome={onHome}
      onArticles={onArticles}
      onBackToProject={onBackToProject}
      onOpenArticle={onOpenArticle}
      onSaveTitle={onSaveTitle}
      maxReachedStep={maxReachedStep}
      onStepClick={onStepClick}
    />
  )
}

function CropTrimEditor({
  project,
  article,
  video,
  onCompleted,
  onHome,
  onArticles,
  onBackToProject,
  onOpenArticle,
  onSaveTitle,
  maxReachedStep,
  onStepClick,
}: CropTrimPageProps & {
  article: NonNullable<CropTrimPageProps['project']['articles'][number]>
  video: NonNullable<CropTrimPageProps['project']['videos'][number]>
}) {
  const [isCropPreviewOpen, setIsCropPreviewOpen] = useState(true)
  const editor = useArticleRangeEditor({
    projectId: project.id,
    video,
    initialRange: article.sourceRange,
    initialTitle: article.title,
    initialCrop: article.crop,
    initialPerspectiveCrop: article.perspectiveCrop,
    autoCropOnOpen: !article.crop,
    onSubmit: async (ranges, crop, perspectiveCrop) => {
      const selected = ranges[0]
      if (!selected) return
      await onCompleted(selected.range, crop, perspectiveCrop)
    },
  })

  return (
    <main className="flex min-h-svh flex-col bg-[#f4f7f4] font-[Avenir_Next,Hiragino_Sans,Yu_Gothic,system-ui,sans-serif] text-[#18211f]">
      <AppHeader
        activeNav="projects"
        onHome={onHome}
        onArticles={onArticles}
        homeDisabled={editor.busy || editor.isDetecting}
      />
      <div className="mx-auto flex min-h-[56px] w-[calc(100%-48px)] max-w-[1040px] items-center md:w-[calc(100%-11.6vw)]">
        <ArticleNavigationBar
          onBack={onBackToProject}
          disabled={editor.busy || editor.isDetecting}
        />
      </div>
      <ArticleContextRow
        project={project}
        sourceName={video.media.name}
        onSelect={onOpenArticle}
        onSaveTitle={onSaveTitle}
        disabled={editor.busy || editor.isDetecting}
      />

      <section className="mx-auto flex w-[calc(100%-48px)] max-w-[1040px] flex-1 flex-col pb-12 md:w-[calc(100%-11.6vw)]">
        <WorkflowBar
          activeStep="crop"
          maxReachedStep={maxReachedStep}
          onStepClick={onStepClick}
          disabled={editor.busy || editor.isDetecting}
        />
        <div className="overflow-hidden rounded-[18px] border border-[#b7cbc0] bg-[#fbfcfa] shadow-[0_18px_52px_rgba(22,54,42,0.07)]">
          <WorkflowPanelHeader
            eyebrow="01 / CROP & TRIM"
            title="時間範囲と表示領域を設定"
            description="記事にする時間範囲と、スライドの切り出し領域を設定します。"
          />

          <div
            className={`grid min-h-0 gap-4 lg:gap-0 ${isCropPreviewOpen ? 'lg:grid-cols-[minmax(0,1fr)_300px]' : 'lg:grid-cols-1'}`}
          >
            <RangeEditor
              video={video}
              editor={editor}
              onOpenCropPreview={!isCropPreviewOpen ? () => setIsCropPreviewOpen(true) : undefined}
            />
            {isCropPreviewOpen && (
              <CropSettingsPanel
                projectId={project.id}
                video={video}
                editor={editor}
                onClose={() => setIsCropPreviewOpen(false)}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#d8e1dc] px-5 py-4 md:px-7">
            <button
              className="inline-flex items-center gap-2 rounded-[9px] bg-[#1d6b50] px-4 py-3 text-xs font-semibold text-[#f3faf6] shadow-[0_7px_16px_rgba(29,107,80,0.17)] transition hover:bg-[#174d3c] disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              disabled={editor.busy || editor.isDetecting || editor.rows.length === 0}
              onClick={() => void editor.submit()}
            >
              {editor.busy ? '保存中…' : 'スライド区間を検出へ'}
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
        {editor.error && (
          <p className="mt-3 rounded-[8px] border border-[#d6a18f] bg-[#fff8f5] px-3 py-2 text-xs text-[#a4573e]">
            {editor.error}
          </p>
        )}
      </section>
    </main>
  )
}
