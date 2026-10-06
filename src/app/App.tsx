import { useRef, useState } from 'react'
import { AppLayout } from './AppLayout'
import { AppPages } from './AppPages'
import { useProjectWorkspace } from './useProjectWorkspace'
import type { ArticleTarget, ProjectWorkspace } from './createProjectWorkspace'
import { getArticleStatus } from '../features/article/articleList'
import { canNavigateToWorkflowStep, type WorkflowStep } from '../lib/workflow'
import type {
  SelectedVideo,
  YoutubeImportOptions,
  YoutubeImportRequest,
} from '../features/import/types'
import type { SlideDetectionOutput } from '../features/slide-detection/types'
import type {
  ArticleDraft,
  ArticleListItem,
  ArticleOutputLanguage,
  ArticleSections,
  ArticleSummary,
  ArticleTranslation,
  ContentProcessingResult,
  CropRegion,
  PerspectiveCrop,
  ProjectStep,
  SlideOcrResult,
  SlideResultEdits,
  TranscriptBoundaryPlan,
  TranscriptionResult,
  VideoTrimRange,
} from '../types/project'

type ArticleWorkflowStep = Exclude<ProjectStep, 'export'>
export type AppRoute =
  | { kind: 'home' }
  | { kind: 'projects' }
  | { kind: 'articles' }
  | { kind: 'project'; projectId: string }
  | { kind: 'article-detail'; articleId: string; projectId: string }
  | { kind: 'article'; articleId: string; projectId: string; step: ArticleWorkflowStep }

function useAppActions(workspace: ProjectWorkspace) {
  const [route, setRoute] = useState<AppRoute>({ kind: 'home' })
  const navigationRequestRef = useRef(0)
  const project = workspace.project

  const currentProjectId = () => {
    if (!project) throw new Error('プロジェクトが選択されていません。')
    return project.id
  }
  const articleTarget = (): ArticleTarget => {
    if (route.kind !== 'article') throw new Error('記事が選択されていません。')
    return { projectId: route.projectId, articleId: route.articleId }
  }
  const navigate = (next: AppRoute) => {
    navigationRequestRef.current += 1
    setRoute(next)
  }
  const finishNavigation = (requestId: number, next: AppRoute) => {
    if (requestId === navigationRequestRef.current) setRoute(next)
  }

  const handleCreateProject = async (title: string) => {
    const requestId = ++navigationRequestRef.current
    const created = await workspace.createProject(title)
    finishNavigation(requestId, { kind: 'project', projectId: created.id })
  }
  const handleHomeAddLocalVideo = async (video: SelectedVideo) => {
    const requestId = ++navigationRequestRef.current
    const created = await workspace.createFromLocalVideo(video)
    finishNavigation(requestId, {
      kind: 'article',
      projectId: created.project.id,
      articleId: created.project.activeArticleId!,
      step: 'crop',
    })
    return created.video
  }
  const handleHomeAddYoutubeVideo = async (
    request: YoutubeImportRequest,
    options: YoutubeImportOptions,
  ) => {
    const requestId = ++navigationRequestRef.current
    const created = await workspace.createFromYoutubeVideo(request, options)
    finishNavigation(requestId, {
      kind: 'article',
      projectId: created.project.id,
      articleId: created.project.activeArticleId!,
      step: 'crop',
    })
    return created.video
  }
  const handleOpenProject = async (projectId: string) => {
    const requestId = ++navigationRequestRef.current
    await workspace.openProject(projectId)
    finishNavigation(requestId, { kind: 'project', projectId })
  }
  const handleDeleteProject = async (projectId: string) => {
    const requestId = ++navigationRequestRef.current
    if (await workspace.deleteProject(projectId)) finishNavigation(requestId, { kind: 'home' })
  }
  const handleOpenArticleWorkflow = async (target: ArticleTarget, preferredStep?: ProjectStep) => {
    const requestId = ++navigationRequestRef.current
    const opened = await workspace.openArticle(target, preferredStep)
    finishNavigation(requestId, { kind: 'article', ...target, step: opened.step })
  }
  const handleOpenArticle = (articleId: string, preferredStep?: ProjectStep) =>
    handleOpenArticleWorkflow({ projectId: currentProjectId(), articleId }, preferredStep)
  const handleOpenArticleDetail = async (
    target: Pick<ArticleListItem, 'projectId' | 'articleId'>,
  ) => {
    const requestId = ++navigationRequestRef.current
    await workspace.openArticleDetail(target)
    finishNavigation(requestId, { kind: 'article-detail', ...target })
  }
  const handleOpenProjectArticle = async (articleId: string) => {
    const article = project?.articles.find((candidate) => candidate.id === articleId)
    if (!project || !article) return
    const target = { projectId: project.id, articleId }
    if (getArticleStatus(article) === 'done') await handleOpenArticleDetail(target)
    else await handleOpenArticleWorkflow(target)
  }
  const changeStep = async (nextStep: ArticleWorkflowStep, advance: boolean) => {
    const target = articleTarget()
    const requestId = ++navigationRequestRef.current
    await workspace.visitStep(target, nextStep, advance)
    finishNavigation(requestId, { kind: 'article', ...target, step: nextStep })
  }
  const handleWorkflowStep = async (step: WorkflowStep) => {
    try {
      if (route.kind !== 'article' || !project || step === 'import' || step === 'export') return
      if (!canNavigateToWorkflowStep(project.workflow.maxReachedStep, step)) return
      await changeStep(step, false)
    } catch (error) {
      console.error('ステップを移動できませんでした。', error)
    }
  }
  const handleProjectStep = async (step: ArticleWorkflowStep) => {
    try {
      await changeStep(step, true)
    } catch (error) {
      console.error('次のステップへ移動できませんでした。', error)
    }
  }
  const handleArticleCropCompleted = async (
    range: VideoTrimRange,
    crop: CropRegion,
    perspectiveCrop?: PerspectiveCrop,
  ) => {
    const target = articleTarget()
    const requestId = ++navigationRequestRef.current
    await workspace.saveArticleSource(target, range, crop, perspectiveCrop)
    finishNavigation(requestId, { kind: 'article', ...target, step: 'detect-slides' })
  }

  const actions = {
    handleCreateProject,
    handleHomeAddLocalVideo,
    handleHomeAddYoutubeVideo,
    handleOpenProject,
    handleDeleteProject,
    handleOpenArticle,
    handleOpenArticleWorkflow,
    handleOpenArticleDetail,
    handleOpenProjectArticle,
    handleWorkflowStep,
    handleProjectStep,
    handleArticleCropCompleted,
    handleOpenProjects: () => navigate({ kind: 'projects' }),
    handleOpenArticles: () => navigate({ kind: 'articles' }),
    handleBackToHome: () => navigate({ kind: 'home' }),
    handleBackToProject: () => {
      if (project) navigate({ kind: 'project', projectId: project.id })
    },
    handleRenameProject: (title: string) => workspace.renameProject(currentProjectId(), title),
    handleAddLocalVideo: (video: SelectedVideo) =>
      workspace.addLocalVideo(currentProjectId(), video),
    handleAddYoutubeVideo: (request: YoutubeImportRequest, options: YoutubeImportOptions) =>
      workspace.addYoutubeVideo(currentProjectId(), request, options),
    handleCreateArticles: (
      videoId: string,
      ranges: Array<{ title: string; range: VideoTrimRange }>,
      crop: CropRegion,
      perspectiveCrop?: PerspectiveCrop,
    ) => workspace.createArticles(currentProjectId(), videoId, ranges, crop, perspectiveCrop),
    handleDeleteArticle: (articleId: string) =>
      workspace.deleteArticle({ projectId: currentProjectId(), articleId }),
    handleDeleteVideo: (videoId: string) => workspace.deleteVideo(currentProjectId(), videoId),
    handleExportCompleted: async (articleId: string) => {
      await workspace.markExported({ projectId: currentProjectId(), articleId })
    },
    handleSlideDetectionCompleted: async (output: SlideDetectionOutput) => {
      await workspace.saveSlideDetection(articleTarget(), output)
    },
    handleTranscriptionCompleted: async (result: TranscriptionResult) => {
      await workspace.saveTranscription(articleTarget(), result)
    },
    handleOcrSlideCompleted: async (results: Array<{ slideId: string; ocr: SlideOcrResult }>) => {
      await workspace.saveOcrBatch(articleTarget(), results)
    },
    handleBoundaryPlanCompleted: async (plan: TranscriptBoundaryPlan) => {
      await workspace.saveTranscriptBoundaryPlan(articleTarget(), plan)
    },
    handleContentSlideCompleted: async (
      results: Array<{ slideId: string; result: ContentProcessingResult }>,
    ) => {
      await workspace.saveSlideContentBatch(articleTarget(), results)
    },
    handleSaveSlideResultEdits: async (slideId: string, edits: SlideResultEdits) => {
      await workspace.saveSlideResultEdits(articleTarget(), slideId, edits)
    },
    handleSaveArticle: async (draft: ArticleDraft) => {
      await workspace.saveArticleDraft(articleTarget(), draft)
    },
    handleSaveArticleSections: async (sections: ArticleSections | null) => {
      await workspace.saveArticleSections(articleTarget(), sections)
    },
    handleSaveArticleTitle: async (title: string) => {
      await workspace.saveArticleTitle(articleTarget(), title)
    },
    handleSaveArticleSummary: async (summary: ArticleSummary) => {
      await workspace.saveArticleSummary(articleTarget(), summary)
    },
    handleSaveArticleTranslation: async (translation: ArticleTranslation) => {
      await workspace.saveArticleTranslation(articleTarget(), translation)
    },
    handleSaveArticleOutputLanguage: async (language: ArticleOutputLanguage) => {
      await workspace.saveArticleOutputLanguage(articleTarget(), language)
    },
  }
  return { route, actions }
}

export type AppActions = ReturnType<typeof useAppActions>['actions']

function App() {
  const workspace = useProjectWorkspace()
  const { route, actions } = useAppActions(workspace)
  const activeNav =
    route.kind === 'home'
      ? 'home'
      : route.kind === 'articles' || route.kind === 'article-detail'
        ? 'articles'
        : 'projects'
  return (
    <AppLayout
      activeNav={activeNav}
      onHome={actions.handleBackToHome}
      onProjects={actions.handleOpenProjects}
      onArticles={actions.handleOpenArticles}
    >
      <AppPages route={route} workspace={workspace} actions={actions} />
    </AppLayout>
  )
}

export default App
