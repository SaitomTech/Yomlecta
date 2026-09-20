import { useRef, useState } from 'react'
import { ArticleReviewPage } from '../features/article/ArticleReviewPage'
import { CropTrimPage } from '../features/crop/CropTrimPage'
import { ExportPage } from '../features/export/ExportPage'
import { exportProject, type ExportResult } from '../features/export/export'
import { GenerateNotesPage } from '../features/generate-notes/GenerateNotesPage'
import { HomePage } from '../features/home/HomePage'
import { ProjectDetailPage } from '../features/project/ProjectDetailPage'
import { ProjectsPage } from '../features/project/ProjectsPage'
import { SlideDetectionPage } from '../features/slide-detection/SlideDetectionPage'
import { useProjectWorkspace } from './useProjectWorkspace'
import { canNavigateToWorkflowStep, type WorkflowStep } from '../lib/workflow'
import {
  saveArticleDraft,
  saveArticleSections,
  saveArticleSource,
  saveArticleSummary,
  saveArticleTitle,
  saveOcr,
  saveSlideContent,
  saveSlideDetection,
  saveSlideResultEdits,
  saveTranscription,
} from '../lib/project/articleOperations'
import {
  activateArticle,
  createEmptyProject,
  markProjectOpened,
  markProjectExported,
  updateProjectWorkflow,
} from '../lib/project/project'
import {
  addArticlesToProject,
  addVideoToProject,
  createProjectFromVideo,
  persistProjectWorkflow,
  renameProject,
} from '../lib/project/projectOperations'
import {
  createProject,
  deleteProject,
  deleteProjectArticle,
  deleteProjectVideo,
  loadProject,
} from '../lib/storage/projectStorage'
import { removeProjectSourceAssetDirectory } from '../lib/storage/projectAssets'
import { downloadYoutubeVideo } from '../lib/youtube/downloader'
import type { SelectedVideo } from '../features/import/types'
import type { YoutubeImportOptions, YoutubeImportRequest } from '../features/import/types'
import type { YoutubeDownloadInput } from '../lib/youtube/types'
import type {
  ArticleDraft,
  ArticleSummary,
  ContentProcessingResult,
  CropRegion,
  ArticleSections,
  MediaProject,
  PerspectiveCrop,
  ProjectStep,
  ProjectVideo,
  SlideOcrResult,
  SlideResultEdits,
  TranscriptionResult,
  VideoTrimRange,
} from '../types/project'
import type { SlideDetectionOutput } from '../features/slide-detection/types'

type Route =
  | { kind: 'home' }
  | { kind: 'projects' }
  | { kind: 'project' }
  | { kind: 'article'; articleId: string; step: ProjectStep }

function App() {
  const [route, setRoute] = useState<Route>({ kind: 'home' })
  const [generatedExport, setGeneratedExport] = useState<{
    articleId: string
    result: ExportResult
  } | null>(null)
  const exportOperationQueue = useRef<Promise<void> | null>(null)
  const navigationRequestRef = useRef(0)
  const { project, projectRef, setProjectState, clearProjectState, enqueueProjectOperation } =
    useProjectWorkspace()

  const regenerateArticleExport = (savedProject: MediaProject | null) => {
    if (!savedProject?.activeArticleId) return Promise.resolve()

    const articleId = savedProject.activeArticleId
    const previous = exportOperationQueue.current ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          const result = await exportProject(savedProject)
          setGeneratedExport({ articleId, result })
        } catch (error) {
          console.error('記事の書き出し結果を更新できませんでした。', error)
        }
      })
    exportOperationQueue.current = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  const handleCreateProject = async (title: string) => {
    const next = createEmptyProject(title)
    await createProject(next)
    setProjectState(next)
    setRoute({ kind: 'project' })
  }

  const startArticleFromImportedVideo = async (
    projectTitle: string,
    selectedVideo: SelectedVideo,
  ): Promise<ProjectVideo> => {
    const emptyProject = createEmptyProject(projectTitle)
    const created = await createProjectFromVideo(emptyProject, selectedVideo)
    setProjectState(created.project)
    const articleId = created.project.activeArticleId
    if (!articleId) throw new Error('記事作成フローを開始できませんでした。')
    setRoute({ kind: 'article', articleId, step: 'crop' })
    return created.video
  }

  const handleHomeAddLocalVideo = (video: SelectedVideo) =>
    enqueueProjectOperation(() =>
      startArticleFromImportedVideo(video.name.replace(/\.[^.]+$/, '').trim(), video),
    )

  const handleHomeAddYoutubeVideo = async (
    request: YoutubeImportRequest,
    options: YoutubeImportOptions,
  ) => {
    const temporaryProjectId = crypto.randomUUID()
    return enqueueProjectOperation(async () => {
      try {
        const video = await downloadYoutubeVideo({
          projectId: temporaryProjectId,
          info: request.info,
          quality: request.quality,
          signal: options.signal,
          onProgress: options.onProgress,
        } satisfies YoutubeDownloadInput)
        const title = video.name.replace(/\.[^.]+$/, '').trim() || request.info.title
        return await startArticleFromImportedVideo(title, video)
      } finally {
        await removeProjectSourceAssetDirectory(temporaryProjectId).catch(() => undefined)
      }
    })
  }

  const handleRenameProject = async (title: string) => {
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current) throw new Error('プロジェクトが選択されていません。')
      const saved = await renameProject(current, title)
      setProjectState(saved)
    })
  }

  const handleOpenProject = async (projectId: string) => {
    const requestId = ++navigationRequestRef.current
    await enqueueProjectOperation(async () => {
      const loaded = await loadProject(projectId)
      const next = markProjectOpened(
        loaded,
        loaded.activeArticleId ? loaded.workflow.lastVisitedStep : 'detect-slides',
      )
      const saved = await persistProjectWorkflow(next)
      setProjectState(saved)
      if (requestId === navigationRequestRef.current) setRoute({ kind: 'project' })
    })
  }

  const handleDeleteProject = async (projectId: string) => {
    await enqueueProjectOperation(async () => {
      await deleteProject(projectId)
      if (projectRef.current?.id === projectId) {
        clearProjectState()
        setRoute({ kind: 'home' })
      }
    })
  }

  const handleAddLocalVideo = async (video: SelectedVideo): Promise<ProjectVideo> => {
    return enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current) throw new Error('プロジェクトが選択されていません。')
      const added = await addVideoToProject(current, video)
      setProjectState(added.project)
      return added.video
    })
  }

  const handleAddYoutubeVideo = async (
    request: YoutubeImportRequest,
    options: YoutubeImportOptions,
  ): Promise<ProjectVideo> => {
    const temporaryProjectId = crypto.randomUUID()
    return enqueueProjectOperation(async () => {
      try {
        const video = await downloadYoutubeVideo({
          projectId: temporaryProjectId,
          info: request.info,
          quality: request.quality,
          signal: options.signal,
          onProgress: options.onProgress,
        } satisfies YoutubeDownloadInput)
        const current = projectRef.current
        if (!current) throw new Error('プロジェクトが選択されていません。')
        const added = await addVideoToProject(current, video)
        setProjectState(added.project)
        return added.video
      } finally {
        await removeProjectSourceAssetDirectory(temporaryProjectId).catch(() => undefined)
      }
    })
  }

  const handleCreateArticles = async (
    videoId: string,
    ranges: Array<{
      title: string
      range: VideoTrimRange
    }>,
    crop: CropRegion,
    perspectiveCrop?: PerspectiveCrop,
  ) => {
    return enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current) throw new Error('プロジェクトが選択されていません。')
      const created = await addArticlesToProject(current, videoId, ranges, crop, perspectiveCrop)
      setProjectState(created.project)
      return created.articles
    })
  }

  const handleOpenArticle = async (articleId: string) => {
    const requestId = ++navigationRequestRef.current
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current) return
      const next = activateArticle(current, articleId)
      const article = next.articles.find((candidate) => candidate.id === articleId)
      const opened = markProjectOpened(next, article?.workflow.lastVisitedStep ?? 'detect-slides')
      const saved = await persistProjectWorkflow(opened)
      setProjectState(saved)
      if (requestId === navigationRequestRef.current)
        setRoute({
          kind: 'article',
          articleId,
          step: article?.workflow.lastVisitedStep ?? 'detect-slides',
        })
    })
  }

  const handleDeleteArticle = async (articleId: string) => {
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current) return
      const saved = await deleteProjectArticle(current, articleId)
      setProjectState(saved)
    })
  }

  const handleDeleteVideo = async (videoId: string) => {
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current) return
      const saved = await deleteProjectVideo(current, videoId)
      setProjectState(saved)
    })
  }

  const handleOpenProjects = () => {
    navigationRequestRef.current += 1
    setRoute({ kind: 'projects' })
  }

  const handleBackToHome = () => {
    navigationRequestRef.current += 1
    setRoute({ kind: 'home' })
  }

  const handleWorkflowStep = async (nextStep: WorkflowStep) => {
    try {
      if (route.kind !== 'article' || !projectRef.current) return
      if (nextStep === 'import') return
      if (!canNavigateToWorkflowStep(projectRef.current.workflow.maxReachedStep, nextStep)) return
      if (nextStep === 'export') {
        await handleProjectStep('export')
        return
      }
      const requestId = ++navigationRequestRef.current
      const articleId = route.articleId
      const saved = await enqueueProjectOperation(async () => {
        const current = projectRef.current
        if (!current || current.activeArticleId !== articleId) return null
        const next = markProjectOpened(current, nextStep)
        const persisted = await persistProjectWorkflow(next)
        return setProjectState(persisted)
      })
      if (!saved || requestId !== navigationRequestRef.current) return
      setRoute({ kind: 'article', articleId, step: nextStep })
    } catch (error) {
      console.error('ステップを移動できませんでした。', error)
    }
  }

  const handleProjectStep = async (nextStep: ProjectStep) => {
    try {
      if (route.kind !== 'article') return
      const requestId = ++navigationRequestRef.current
      const articleId = route.articleId
      if (nextStep === 'export') {
        const saved = await enqueueProjectOperation(async () => {
          const current = projectRef.current
          if (!current || current.activeArticleId !== articleId) return null
          const next = markProjectOpened(current, nextStep)
          const persisted = await persistProjectWorkflow(next)
          return setProjectState(persisted)
        })
        if (saved) await regenerateArticleExport(saved)
        if (saved && requestId === navigationRequestRef.current)
          setRoute({ kind: 'article', articleId, step: nextStep })
        return
      }
      const saved = await enqueueProjectOperation(async () => {
        const current = projectRef.current
        if (!current || current.activeArticleId !== articleId) return null
        const next = updateProjectWorkflow(current, nextStep)
        const persisted = await persistProjectWorkflow(next)
        return setProjectState(persisted)
      })
      if (saved && requestId === navigationRequestRef.current)
        setRoute({ kind: 'article', articleId, step: nextStep })
    } catch (error) {
      console.error('次のステップへ移動できませんでした。', error)
    }
  }

  const handleExportCompleted = async () => {
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current) return
      const next = markProjectExported(current)
      const persisted = await persistProjectWorkflow(next)
      setProjectState(persisted)
    })
  }

  const handleSlideDetectionCompleted = async (output: SlideDetectionOutput) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return
      const next = await saveSlideDetection(current, output)
      if (next) setProjectState(next)
    })
  }
  const handleArticleCropCompleted = async (
    range: VideoTrimRange,
    crop: CropRegion,
    perspectiveCrop?: PerspectiveCrop,
  ) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    const saved = await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return null
      const next = await saveArticleSource(current, range, crop, perspectiveCrop)
      if (next) setProjectState(next)
      return next
    })
    if (saved && targetArticleId)
      setRoute({ kind: 'article', articleId: targetArticleId, step: 'detect-slides' })
  }
  const handleTranscriptionCompleted = async (transcription: TranscriptionResult) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return
      const next = await saveTranscription(current, transcription)
      if (next) setProjectState(next)
    })
  }
  const handleOcrSlideCompleted = async (slideId: string, ocr: SlideOcrResult) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return
      const next = await saveOcr(current, slideId, ocr)
      if (next) setProjectState(next)
    })
  }
  const handleContentSlideCompleted = async (slideId: string, result: ContentProcessingResult) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return
      const next = await saveSlideContent(current, slideId, result)
      if (next) setProjectState(next)
    })
  }
  const handleSaveSlideResultEdits = async (slideId: string, edits: SlideResultEdits) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    const saved = await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return null
      const next = await saveSlideResultEdits(current, slideId, edits)
      if (next) setProjectState(next)
      return next
    })
    await regenerateArticleExport(saved)
  }
  const handleSaveArticle = async (draft: ArticleDraft) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    const saved = await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return null
      const next = await saveArticleDraft(current, draft)
      if (next) setProjectState(next)
      return next
    })
    await regenerateArticleExport(saved)
  }
  const handleSaveArticleSections = async (sections: ArticleSections | null) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    const saved = await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return null
      const next = await saveArticleSections(current, sections)
      if (next) setProjectState(next)
      return next
    })
    await regenerateArticleExport(saved)
  }
  const handleSaveArticleTitle = async (title: string) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    const saved = await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return null
      const next = await saveArticleTitle(current, title)
      if (next) setProjectState(next)
      return next
    })
    if (!saved) throw new Error('記事が選択されていません。')
    await regenerateArticleExport(saved)
  }
  const handleSaveArticleSummary = async (summary: ArticleSummary) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    const saved = await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return null
      const next = await saveArticleSummary(current, summary)
      if (next) setProjectState(next)
      return next
    })
    await regenerateArticleExport(saved)
  }

  if (route.kind === 'home')
    return (
      <HomePage
        onOpenProjects={handleOpenProjects}
        onOpenProject={handleOpenProject}
        onAddLocalVideo={handleHomeAddLocalVideo}
        onAddYoutubeVideo={handleHomeAddYoutubeVideo}
      />
    )
  if (route.kind === 'projects')
    return (
      <ProjectsPage
        onHome={handleBackToHome}
        onCreateProject={handleCreateProject}
        onOpenProject={handleOpenProject}
      />
    )
  if (!project) return null
  if (route.kind === 'project')
    return (
      <ProjectDetailPage
        project={project}
        onHome={handleBackToHome}
        onBackToProjects={handleOpenProjects}
        onDeleteProject={() => handleDeleteProject(project.id)}
        onRenameProject={handleRenameProject}
        onAddLocalVideo={handleAddLocalVideo}
        onAddYoutubeVideo={handleAddYoutubeVideo}
        onOpenArticle={(articleId) => void handleOpenArticle(articleId)}
        onDeleteArticle={handleDeleteArticle}
        onDeleteVideo={handleDeleteVideo}
        onCreateArticles={handleCreateArticles}
      />
    )
  const articleProps = {
    maxReachedStep: project.workflow.maxReachedStep,
    onStepClick: handleWorkflowStep,
    onSaveTitle: handleSaveArticleTitle,
  }
  if (route.step === 'crop')
    return (
      <CropTrimPage
        key={route.articleId}
        project={project}
        onCompleted={handleArticleCropCompleted}
        onHome={handleBackToHome}
        onBackToProject={handleOpenProjects}
        onOpenArticle={handleOpenArticle}
        {...articleProps}
      />
    )
  if (route.step === 'detect-slides')
    return (
      <SlideDetectionPage
        key={route.articleId}
        project={project}
        onCompleted={handleSlideDetectionCompleted}
        onContinue={() => void handleProjectStep('generate-notes')}
        onHome={handleBackToHome}
        onBackToProject={handleOpenProjects}
        onOpenArticle={handleOpenArticle}
        {...articleProps}
      />
    )
  if (route.step === 'generate-notes')
    return (
      <GenerateNotesPage
        key={route.articleId}
        project={project}
        onCompleted={handleTranscriptionCompleted}
        onOcrSlideCompleted={handleOcrSlideCompleted}
        onSaveSlideResultEdits={handleSaveSlideResultEdits}
        onOpenArticleReview={() => void handleProjectStep('article-review')}
        onHome={handleBackToHome}
        onBackToProject={handleOpenProjects}
        onOpenArticle={handleOpenArticle}
        {...articleProps}
      />
    )
  if (route.step === 'article-review')
    return (
      <ArticleReviewPage
        key={route.articleId}
        project={project}
        onContentSlideCompleted={handleContentSlideCompleted}
        onSaveSections={handleSaveArticleSections}
        getCurrentProject={() => projectRef.current}
        onSave={handleSaveArticle}
        onSaveSummary={handleSaveArticleSummary}
        onExport={() => void handleProjectStep('export')}
        onHome={handleBackToHome}
        onBackToProject={handleOpenProjects}
        onOpenArticle={handleOpenArticle}
        {...articleProps}
      />
    )
  return (
    <ExportPage
      key={route.articleId}
      project={project}
      exportResult={
        generatedExport && generatedExport.articleId === project.activeArticleId
          ? generatedExport.result
          : null
      }
      onHome={handleBackToHome}
      onBackToProject={handleOpenProjects}
      onOpenArticle={handleOpenArticle}
      onGenerated={handleExportCompleted}
      {...articleProps}
    />
  )
}

export default App
