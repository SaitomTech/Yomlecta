import { useRef, useState } from 'react'
import { ArticleNavigationBar } from '../article/components/ArticleNavigationBar'
import type { SelectedVideo, YoutubeImportOptions, YoutubeImportRequest } from '../import/types'
import type {
  Article,
  CropRegion,
  MediaProject,
  PerspectiveCrop,
  ProjectVideo,
  VideoTrimRange,
} from '../../types/project'
import {
  VideoImportPanel,
  type VideoImportPanelHandle,
  type VideoImportSource,
} from './VideoImportPanel'
import { ProjectArticleMap } from './components/ProjectArticleMap'
import { DeleteArticleDialog } from './components/DeleteArticleDialog'
import { DeleteProjectDialog } from './components/DeleteProjectDialog'
import { DeleteVideoDialog } from './components/DeleteVideoDialog'
import { ProjectHeader } from './components/ProjectHeader'
import { SelectArticleVideoDialog } from './components/SelectArticleVideoDialog'
import { CreateArticleDialog } from './article-creator/CreateArticleDialog'
import { useProjectTitleEditor } from './hooks/useProjectTitleEditor'

export function ProjectDetailPage({
  project,
  onBackToProjects,
  onDeleteProject,
  onRenameProject,
  onAddLocalVideo,
  onAddYoutubeVideo,
  onOpenArticle,
  onEditArticle,
  onDeleteArticle,
  onDeleteVideo,
  onCreateArticles,
}: {
  project: MediaProject
  onBackToProjects: () => void
  onDeleteProject: () => Promise<void>
  onRenameProject: (title: string) => Promise<void>
  onAddLocalVideo: (video: SelectedVideo) => Promise<ProjectVideo>
  onAddYoutubeVideo: (
    request: YoutubeImportRequest,
    options: YoutubeImportOptions,
  ) => Promise<ProjectVideo>
  onOpenArticle: (articleId: string) => void
  onEditArticle: (articleId: string) => void
  onDeleteArticle: (articleId: string) => Promise<void>
  onDeleteVideo: (videoId: string) => Promise<void>
  onCreateArticles: (
    videoId: string,
    ranges: Array<{ title: string; range: VideoTrimRange }>,
    crop: CropRegion,
    perspectiveCrop?: PerspectiveCrop,
  ) => Promise<Article[]>
}) {
  const [createVideo, setCreateVideo] = useState<ProjectVideo | null>(null)
  const [showVideoPicker, setShowVideoPicker] = useState(false)
  const [prepareAfterImport, setPrepareAfterImport] = useState(false)
  const [deleteVideo, setDeleteVideo] = useState<ProjectVideo | null>(null)
  const [deleteArticle, setDeleteArticle] = useState<Article | null>(null)
  const [isDeleteProjectOpen, setIsDeleteProjectOpen] = useState(false)
  const [isDeletingProject, setIsDeletingProject] = useState(false)
  const [projectDeleteError, setProjectDeleteError] = useState<string | null>(null)
  const videoImportContainerRef = useRef<HTMLDivElement | null>(null)
  const videoImportPanelRef = useRef<VideoImportPanelHandle | null>(null)
  const titleEditor = useProjectTitleEditor({
    initialTitle: project.title,
    onSave: onRenameProject,
  })

  const startArticleCreator = (video?: ProjectVideo) => {
    if (video) {
      setShowVideoPicker(false)
      setCreateVideo(video)
      return
    }
    setShowVideoPicker(true)
  }
  const openVideoImportSource = (source: VideoImportSource) => {
    setPrepareAfterImport(true)
    const open = () => {
      videoImportContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (source === 'finder') void videoImportPanelRef.current?.openFinder()
      else videoImportPanelRef.current?.openYoutube()
    }
    window.setTimeout(open, 0)
  }
  const deleteCurrentProject = async () => {
    setIsDeletingProject(true)
    setProjectDeleteError(null)
    try {
      await onDeleteProject()
    } catch (cause) {
      setProjectDeleteError(
        cause instanceof Error ? cause.message : 'プロジェクトを削除できませんでした。',
      )
      setIsDeletingProject(false)
    }
  }

  const requestDeleteArticle = (articleId: string) => {
    const article = project.articles.find((candidate) => candidate.id === articleId)
    if (article) setDeleteArticle(article)
  }
  const requestDeleteVideo = (videoId: string) => {
    const video = project.videos.find((candidate) => candidate.id === videoId)
    if (video) setDeleteVideo(video)
  }

  return (
    <main className="min-h-[calc(100svh-76px)] bg-[#f4f7f4] font-[Avenir_Next,Hiragino_Sans,Yu_Gothic,system-ui,sans-serif] text-[#18211f]">
      <div className="mx-auto flex min-h-[56px] w-[calc(100%-48px)] max-w-[1040px] items-center md:w-[calc(100%-11.6vw)]">
        <ArticleNavigationBar onBack={onBackToProjects} label="プロジェクト一覧へ戻る" />
      </div>
      <section className="mx-auto w-[calc(100%-48px)] max-w-[1040px] pb-16 md:w-[calc(100%-11.6vw)]">
        <div className="overflow-hidden rounded-[16px] border border-[#b7cbc0] bg-white shadow-[0_18px_52px_rgba(22,54,42,0.05)]">
          <ProjectHeader
            project={project}
            isEditingTitle={titleEditor.isEditing}
            titleDraft={titleEditor.draft}
            isSavingTitle={titleEditor.isSaving}
            titleError={titleEditor.error}
            onTitleDraftChange={titleEditor.setDraft}
            onStartTitleEditing={titleEditor.startEditing}
            onTitleKeyDown={titleEditor.handleKeyDown}
            onTitleBlur={titleEditor.handleBlur}
            onTitleCompositionStart={titleEditor.handleCompositionStart}
            onTitleCompositionEnd={titleEditor.handleCompositionEnd}
            onRequestDelete={() => {
              setProjectDeleteError(null)
              setIsDeleteProjectOpen(true)
            }}
          />
          <div className="px-6 pb-8 sm:px-8 sm:pb-10">
            <ProjectArticleMap
              project={project}
              onStartArticleCreator={startArticleCreator}
              onOpenArticle={onOpenArticle}
              onEditArticle={onEditArticle}
              onDeleteArticle={requestDeleteArticle}
              onDeleteVideo={requestDeleteVideo}
            />
            <div ref={videoImportContainerRef} className="mt-8 pt-6">
              <VideoImportPanel
                ref={videoImportPanelRef}
                onAddLocalVideo={onAddLocalVideo}
                onAddYoutubeVideo={onAddYoutubeVideo}
                onVideoAdded={(video) => {
                  if (!prepareAfterImport) return
                  setPrepareAfterImport(false)
                  setCreateVideo(video)
                }}
                continueToPreparation={prepareAfterImport}
              />
            </div>
          </div>
        </div>
        {showVideoPicker && (
          <SelectArticleVideoDialog
            project={project}
            onClose={() => {
              setPrepareAfterImport(false)
              setShowVideoPicker(false)
            }}
            onSelect={(video) => {
              setShowVideoPicker(false)
              setCreateVideo(video)
            }}
            onOpenVideos={(source) => {
              setShowVideoPicker(false)
              openVideoImportSource(source)
            }}
          />
        )}
        {createVideo && (
          <CreateArticleDialog
            projectId={project.id}
            video={createVideo}
            onClose={() => setCreateVideo(null)}
            onSubmit={(ranges, crop, perspectiveCrop) =>
              onCreateArticles(createVideo.id, ranges, crop, perspectiveCrop)
            }
          />
        )}
        {deleteVideo && (
          <DeleteVideoDialog
            video={deleteVideo}
            onClose={() => setDeleteVideo(null)}
            onConfirm={() => onDeleteVideo(deleteVideo.id)}
          />
        )}
        {deleteArticle && (
          <DeleteArticleDialog
            article={deleteArticle}
            onClose={() => setDeleteArticle(null)}
            onConfirm={() => onDeleteArticle(deleteArticle.id)}
          />
        )}
        <DeleteProjectDialog
          open={isDeleteProjectOpen}
          title={project.title}
          busy={isDeletingProject}
          error={projectDeleteError}
          onClose={() => setIsDeleteProjectOpen(false)}
          onConfirm={() => void deleteCurrentProject()}
        />
      </section>
    </main>
  )
}
