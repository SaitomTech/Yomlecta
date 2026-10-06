import { useRef, useState } from 'react'
import { AppLayout } from './AppLayout'
import { ArticleReviewPage } from '../features/article/ArticleReviewPage'
import { ArticleDetailPage } from '../features/article/ArticleDetailPage'
import { ArticlesPage } from '../features/article/ArticlesPage'
import { getArticleStatus } from '../features/article/articleList'
import { CropTrimPage } from '../features/crop/CropTrimPage'
import { GenerateNotesPage } from '../features/generate-notes/GenerateNotesPage'
import { HomePage } from '../features/home/HomePage'
import { ProjectDetailPage } from '../features/project/ProjectDetailPage'
import { ProjectsPage } from '../features/project/ProjectsPage'
import { SlideDetectionPage } from '../features/slide-detection/SlideDetectionPage'
import { useProjectWorkspace } from './useProjectWorkspace'
import { canNavigateToWorkflowStep, type WorkflowStep } from '../lib/workflow'
import {
  saveTranscriptBoundaryPlan,
  saveArticleDraft,
  saveArticleSections,
  saveArticleSource,
  saveArticleSummary,
  saveArticleOutputLanguage,
  saveArticleTitle,
  saveArticleTranslation,
  saveOcrBatch,
  saveSlideContentBatch,
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
  ArticleOutputLanguage,
  ArticleSummary,
  ArticleTranslation,
  TranscriptBoundaryPlan,
  ContentProcessingResult,
  CropRegion,
  ArticleSections,
  PerspectiveCrop,
  ProjectStep,
  ProjectVideo,
  ArticleListItem,
  SlideOcrResult,
  SlideResultEdits,
  TranscriptionResult,
  VideoTrimRange,
} from '../types/project'
import type { SlideDetectionOutput } from '../features/slide-detection/types'

type Route =
  | { kind: 'home' }
  | { kind: 'projects' }
  | { kind: 'articles' }
  | { kind: 'project' }
  | { kind: 'article-detail'; articleId: string; projectId: string }
  | { kind: 'article'; articleId: string; step: ProjectStep }

function App() {
  const [route, setRoute] = useState<Route>({ kind: 'home' })
  const navigationRequestRef = useRef(0)
  const { project, projectRef, setProjectState, clearProjectState, enqueueProjectOperation } =
    useProjectWorkspace()

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

  const handleOpenArticle = async (articleId: string, preferredStep?: ProjectStep) => {
    const requestId = ++navigationRequestRef.current
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current) return
      const loaded = await loadProject(current.id, articleId)
      const next = activateArticle(loaded, articleId)
      const article = next.articles.find((candidate) => candidate.id === articleId)
      const savedStep = preferredStep ?? article?.workflow.lastVisitedStep ?? 'detect-slides'
      const step = savedStep === 'export' ? 'article-review' : savedStep
      const opened = markProjectOpened(next, step)
      const saved = await persistProjectWorkflow(opened)
      setProjectState(saved)
      if (requestId === navigationRequestRef.current)
        setRoute({
          kind: 'article',
          articleId,
          step,
        })
    })
  }

  const handleOpenProjectArticle = async (articleId: string) => {
    const current = projectRef.current
    const article = current?.articles.find((candidate) => candidate.id === articleId)
    if (!current || !article) return

    if (getArticleStatus(article) !== 'done') {
      await handleOpenArticle(articleId)
      return
    }

    await handleOpenArticleDetail({
      articleId: article.id,
      projectId: current.id,
      title: article.title,
      projectTitle: current.title,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      lastVisitedStep: article.workflow.lastVisitedStep,
      maxReachedStep: article.workflow.maxReachedStep,
      status: getArticleStatus(article),
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

  const handleBackToProject = () => {
    if (!projectRef.current) return
    navigationRequestRef.current += 1
    setRoute({ kind: 'project' })
  }

  const handleOpenArticles = () => {
    navigationRequestRef.current += 1
    setRoute({ kind: 'articles' })
  }

  const handleOpenArticleDetail = async (item: ArticleListItem) => {
    const requestId = ++navigationRequestRef.current
    await enqueueProjectOperation(async () => {
      const loaded = await loadProject(item.projectId, item.articleId)
      const next = activateArticle(loaded, item.articleId)
      setProjectState(next)
      if (requestId === navigationRequestRef.current) {
        setRoute({ kind: 'article-detail', projectId: item.projectId, articleId: item.articleId })
      }
    })
  }

  const handleOpenArticleWorkflow = async (item: ArticleListItem, preferredStep?: ProjectStep) => {
    const requestId = ++navigationRequestRef.current
    const { step } = await enqueueProjectOperation(async () => {
      const loaded = await loadProject(item.projectId, item.articleId)
      const next = activateArticle(loaded, item.articleId)
      const article = next.articles.find((candidate) => candidate.id === item.articleId)
      const savedStep = preferredStep ?? article?.workflow.lastVisitedStep ?? 'detect-slides'
      const step = savedStep === 'export' ? 'article-review' : savedStep
      const marked = markProjectOpened(next, step)
      const saved = await persistProjectWorkflow(marked)
      setProjectState(saved)
      return { step }
    })
    if (requestId === navigationRequestRef.current) {
      setRoute({
        kind: 'article',
        articleId: item.articleId,
        step,
      })
    }
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
      if (nextStep === 'export') nextStep = 'article-review'
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

  const handleExportCompleted = async (articleId: string) => {
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || current.activeArticleId !== articleId) return
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
  const handleOcrSlideCompleted = async (
    results: Array<{ slideId: string; ocr: SlideOcrResult }>,
  ) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return
      const next = await saveOcrBatch(current, results)
      if (next) setProjectState(next)
    })
  }
  const handleBoundaryPlanCompleted = async (plan: TranscriptBoundaryPlan) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) {
        throw new Error('編集中の記事が変更されました。本文生成を再実行してください。')
      }
      const next = await saveTranscriptBoundaryPlan(current, plan)
      setProjectState(next)
    })
  }
  const handleContentSlideCompleted = async (
    results: Array<{ slideId: string; result: ContentProcessingResult }>,
  ) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return
      const next = await saveSlideContentBatch(current, results)
      if (next) setProjectState(next)
    })
  }
  const handleSaveSlideResultEdits = async (slideId: string, edits: SlideResultEdits) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return null
      const next = await saveSlideResultEdits(current, slideId, edits)
      if (next) setProjectState(next)
      return next
    })
  }
  const handleSaveArticle = async (draft: ArticleDraft) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return null
      const next = await saveArticleDraft(current, draft)
      if (next) setProjectState(next)
      return next
    })
  }
  const handleSaveArticleSections = async (sections: ArticleSections | null) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return null
      const next = await saveArticleSections(current, sections)
      if (next) setProjectState(next)
      return next
    })
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
  }
  const handleSaveArticleSummary = async (summary: ArticleSummary) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return null
      const next = await saveArticleSummary(current, summary)
      if (next) setProjectState(next)
      return next
    })
  }
  const handleSaveArticleTranslation = async (translation: ArticleTranslation) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return null
      const next = await saveArticleTranslation(current, translation)
      if (next) setProjectState(next)
      return next
    })
  }
  const handleSaveArticleOutputLanguage = async (outputLanguage: ArticleOutputLanguage) => {
    const targetArticleId = route.kind === 'article' ? route.articleId : null
    await enqueueProjectOperation(async () => {
      const current = projectRef.current
      if (!current || !targetArticleId || current.activeArticleId !== targetArticleId) return null
      const next = await saveArticleOutputLanguage(current, outputLanguage)
      if (next) setProjectState(next)
      return next
    })
  }

  const page = (() => {
    if (route.kind === 'home')
      return (
        <HomePage
          onOpenProjects={handleOpenProjects}
          onOpenArticles={handleOpenArticles}
          onOpenProject={handleOpenProject}
          onOpenArticle={handleOpenArticleDetail}
          onOpenArticleWorkflow={handleOpenArticleWorkflow}
          onAddLocalVideo={handleHomeAddLocalVideo}
          onAddYoutubeVideo={handleHomeAddYoutubeVideo}
        />
      )
    if (route.kind === 'projects')
      return (
        <ProjectsPage onCreateProject={handleCreateProject} onOpenProject={handleOpenProject} />
      )
    if (route.kind === 'articles')
      return (
        <ArticlesPage
          onOpenArticle={handleOpenArticleDetail}
          onOpenWorkflow={handleOpenArticleWorkflow}
          onOpenProject={(item) => void handleOpenProject(item.projectId)}
        />
      )
    if (!project) return null
    if (route.kind === 'article-detail') {
      const article = project.articles.find((candidate) => candidate.id === route.articleId)
      const item: ArticleListItem = {
        articleId: route.articleId,
        projectId: route.projectId,
        title: article?.title ?? '',
        projectTitle: project.title,
        createdAt: article?.createdAt ?? project.createdAt,
        updatedAt: article?.updatedAt ?? project.updatedAt,
        lastVisitedStep: article?.workflow.lastVisitedStep ?? 'crop',
        maxReachedStep: article?.workflow.maxReachedStep ?? 'crop',
        status: article ? getArticleStatus(article) : 'not-started',
      }
      return (
        <ArticleDetailPage
          key={route.articleId}
          project={project}
          item={item}
          onBack={handleOpenArticles}
          onEdit={() =>
            void handleOpenArticleWorkflow(
              item,
              getArticleStatus(item) === 'done' ? 'article-review' : undefined,
            )
          }
          onGenerated={() => handleExportCompleted(item.articleId)}
          onOpenProject={() => void handleOpenProject(project.id)}
        />
      )
    }
    if (route.kind === 'project')
      return (
        <ProjectDetailPage
          project={project}
          onBackToProjects={handleOpenProjects}
          onDeleteProject={() => handleDeleteProject(project.id)}
          onRenameProject={handleRenameProject}
          onAddLocalVideo={handleAddLocalVideo}
          onAddYoutubeVideo={handleAddYoutubeVideo}
          onOpenArticle={(articleId) => void handleOpenProjectArticle(articleId)}
          onEditArticle={(articleId) => void handleOpenArticle(articleId, 'article-review')}
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
          onBackToProject={handleBackToProject}
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
          onBackToProject={handleBackToProject}
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
          onBackToProject={handleBackToProject}
          onOpenArticle={handleOpenArticle}
          {...articleProps}
        />
      )
    if (route.step === 'article-review' || route.step === 'export')
      return (
        <ArticleReviewPage
          key={route.articleId}
          project={project}
          onBoundaryPlanCompleted={handleBoundaryPlanCompleted}
          onContentSlideCompleted={handleContentSlideCompleted}
          onSaveSections={handleSaveArticleSections}
          getCurrentProject={() => projectRef.current}
          onSave={handleSaveArticle}
          onSaveSummary={handleSaveArticleSummary}
          onSaveTranslation={handleSaveArticleTranslation}
          onSaveOutputLanguage={handleSaveArticleOutputLanguage}
          onViewArticle={() =>
            void handleOpenArticleDetail({
              articleId: route.articleId,
              projectId: project.id,
              title: project.article?.title ?? '',
              projectTitle: project.title,
              createdAt: project.createdAt,
              updatedAt: project.updatedAt,
              lastVisitedStep: project.workflow.lastVisitedStep,
              maxReachedStep: project.workflow.maxReachedStep,
              status: getArticleStatus(project),
            })
          }
          onBackToProject={handleBackToProject}
          onOpenArticle={handleOpenArticle}
          {...articleProps}
        />
      )
    return null
  })()

  if (!page) return null

  const activeNav =
    route.kind === 'home'
      ? 'home'
      : route.kind === 'articles' || route.kind === 'article-detail'
        ? 'articles'
        : 'projects'

  return (
    <AppLayout
      activeNav={activeNav}
      onHome={handleBackToHome}
      onProjects={handleOpenProjects}
      onArticles={handleOpenArticles}
    >
      {page}
    </AppLayout>
  )
}

export default App
