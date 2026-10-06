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
import type { AppActions, AppRoute } from './App'
import type { ProjectWorkspace } from './createProjectWorkspace'
import type { ArticleListItem } from '../types/project'

export function AppPages({
  route,
  workspace,
  actions,
}: {
  route: AppRoute
  workspace: ProjectWorkspace
  actions: AppActions
}) {
  const project = workspace.project
  const context =
    project && workspace.activeArticle ? { project, article: workspace.activeArticle } : null
  if (route.kind === 'project' && project?.id !== route.projectId) return null
  if (
    route.kind === 'article' &&
    (!project || project.id !== route.projectId || context?.article.id !== route.articleId)
  )
    return null
  if (
    route.kind === 'article-detail' &&
    (!project || project.id !== route.projectId || context?.article.id !== route.articleId)
  )
    return null
  if (route.kind === 'home')
    return (
      <HomePage
        onOpenProjects={actions.handleOpenProjects}
        onOpenArticles={actions.handleOpenArticles}
        onOpenProject={actions.handleOpenProject}
        onOpenArticle={actions.handleOpenArticleDetail}
        onOpenArticleWorkflow={actions.handleOpenArticleWorkflow}
        onAddLocalVideo={actions.handleHomeAddLocalVideo}
        onAddYoutubeVideo={actions.handleHomeAddYoutubeVideo}
      />
    )
  if (route.kind === 'projects')
    return (
      <ProjectsPage
        onCreateProject={actions.handleCreateProject}
        onOpenProject={actions.handleOpenProject}
      />
    )
  if (route.kind === 'articles')
    return (
      <ArticlesPage
        onOpenArticle={actions.handleOpenArticleDetail}
        onOpenWorkflow={actions.handleOpenArticleWorkflow}
        onOpenProject={(item) => void actions.handleOpenProject(item.projectId)}
      />
    )
  if (!project) return null
  if (route.kind === 'article-detail') {
    const article = context!.article
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
        project={context!}
        item={item}
        onBack={actions.handleOpenArticles}
        onEdit={() =>
          void actions.handleOpenArticleWorkflow(
            item,
            getArticleStatus(item) === 'done' ? 'article-review' : undefined,
          )
        }
        onGenerated={() => actions.handleExportCompleted(item.articleId)}
        onOpenProject={() => void actions.handleOpenProject(project.id)}
      />
    )
  }
  if (route.kind === 'project')
    return (
      <ProjectDetailPage
        project={project}
        onBackToProjects={actions.handleOpenProjects}
        onDeleteProject={() => actions.handleDeleteProject(project.id)}
        onRenameProject={actions.handleRenameProject}
        onAddLocalVideo={actions.handleAddLocalVideo}
        onAddYoutubeVideo={actions.handleAddYoutubeVideo}
        onOpenArticle={(articleId) => void actions.handleOpenProjectArticle(articleId)}
        onEditArticle={(articleId) => void actions.handleOpenArticle(articleId, 'article-review')}
        onDeleteArticle={actions.handleDeleteArticle}
        onDeleteVideo={actions.handleDeleteVideo}
        onCreateArticles={actions.handleCreateArticles}
      />
    )
  const articleProps = {
    maxReachedStep: context!.article.workflow.maxReachedStep,
    onStepClick: actions.handleWorkflowStep,
    onSaveTitle: actions.handleSaveArticleTitle,
  }
  if (route.step === 'crop')
    return (
      <CropTrimPage
        key={route.articleId}
        project={context!}
        onCompleted={actions.handleArticleCropCompleted}
        onBackToProject={actions.handleBackToProject}
        onOpenArticle={actions.handleOpenArticle}
        {...articleProps}
      />
    )
  if (route.step === 'detect-slides')
    return (
      <SlideDetectionPage
        key={route.articleId}
        project={context!}
        onCompleted={actions.handleSlideDetectionCompleted}
        onContinue={() => void actions.handleProjectStep('generate-notes')}
        onBackToProject={actions.handleBackToProject}
        onOpenArticle={actions.handleOpenArticle}
        {...articleProps}
      />
    )
  if (route.step === 'generate-notes')
    return (
      <GenerateNotesPage
        key={route.articleId}
        project={context!}
        onCompleted={actions.handleTranscriptionCompleted}
        onOcrSlideCompleted={actions.handleOcrSlideCompleted}
        onSaveSlideResultEdits={actions.handleSaveSlideResultEdits}
        onOpenArticleReview={() => void actions.handleProjectStep('article-review')}
        onBackToProject={actions.handleBackToProject}
        onOpenArticle={actions.handleOpenArticle}
        {...articleProps}
      />
    )
  if (route.step === 'article-review')
    return (
      <ArticleReviewPage
        key={route.articleId}
        project={context!}
        onBoundaryPlanCompleted={actions.handleBoundaryPlanCompleted}
        onContentSlideCompleted={actions.handleContentSlideCompleted}
        onSaveSections={actions.handleSaveArticleSections}
        getCurrentProject={() =>
          workspace.getArticleWorkspace({ projectId: project.id, articleId: route.articleId })
        }
        onSave={actions.handleSaveArticle}
        onSaveSummary={actions.handleSaveArticleSummary}
        onSaveTranslation={actions.handleSaveArticleTranslation}
        onSaveOutputLanguage={actions.handleSaveArticleOutputLanguage}
        onViewArticle={() =>
          void actions.handleOpenArticleDetail({
            articleId: route.articleId,
            projectId: project.id,
          })
        }
        onBackToProject={actions.handleBackToProject}
        onOpenArticle={actions.handleOpenArticle}
        {...articleProps}
      />
    )
  return null
}
