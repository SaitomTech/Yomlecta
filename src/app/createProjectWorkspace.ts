import * as articleOperations from '../lib/project/articleOperations'
import * as projectOperations from '../lib/project/projectOperations'
import * as storage from '../lib/storage/projectStorage'
import { createEmptyProject, replaceLoadedArticle } from '../lib/project/project'
import { getLoadedArticle, articleContext } from '../lib/project/articleSelectors'
import {
  markArticleOpened,
  markArticleExported,
  updateArticleWorkflow,
} from '../lib/project/article'

import { removeProjectSourceAssetDirectory } from '../lib/storage/projectAssets'
import { downloadYoutubeVideo } from '../lib/youtube/downloader'
import type {
  SelectedVideo,
  YoutubeImportOptions,
  YoutubeImportRequest,
} from '../features/import/types'
import type { SlideDetectionOutput } from '../features/slide-detection/types'
import type {
  ArticleDraft,
  ArticleOutputLanguage,
  ArticleSections,
  ArticleSummary,
  ArticleTranslation,
  ContentProcessingResult,
  CropRegion,
  Project,
  Article,
  ArticleContext,
  PerspectiveCrop,
  ProjectStep,
  SlideOcrResult,
  SlideResultEdits,
  TranscriptBoundaryPlan,
  TranscriptionResult,
  VideoTrimRange,
} from '../types/project'

export type ArticleTarget = { projectId: string; articleId: string }

type WorkspaceDependencies = {
  storage?: Partial<typeof storage>
  projectOperations?: Partial<typeof projectOperations>
  articleOperations?: Partial<typeof articleOperations>
}

export function createProjectWorkspace(
  publish: (project: Project | null) => void,
  dependencies: WorkspaceDependencies = {},
) {
  const db = { ...storage, ...dependencies.storage }
  const projects = { ...projectOperations, ...dependencies.projectOperations }
  const articles = { ...articleOperations, ...dependencies.articleOperations }
  let project: Project | null = null
  let queue: Promise<unknown> = Promise.resolve()

  function enqueue<T>(operation: () => Promise<T>) {
    const next = queue.then(operation, operation)
    queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  function apply(next: Project | null) {
    project = next
    publish(next)
    return next
  }

  function requireProject(projectId: string) {
    if (!project || project.id !== projectId)
      throw new Error('操作対象のプロジェクトが変更されました。')
    return project
  }

  function requireArticle(target: ArticleTarget) {
    const current = requireProject(target.projectId)
    const article = getLoadedArticle(current)
    if (!article || article.id !== target.articleId)
      throw new Error('操作対象の記事が変更されました。処理を再実行してください。')
    return { project: current, article }
  }

  function applyArticle(context: ArticleContext, article: Article, markOpened = false) {
    const next = replaceLoadedArticle(
      {
        ...context.project,
        updatedAt:
          article.updatedAt > context.project.updatedAt
            ? article.updatedAt
            : context.project.updatedAt,
        lastOpenedArticleId: markOpened ? article.id : context.project.lastOpenedArticleId,
      },
      article,
    )
    apply(next)
    return next
  }

  function updateProject<T>(
    projectId: string,
    operation: (current: Project) => Promise<{ project: Project; value: T }>,
  ) {
    return enqueue(async () => {
      const result = await operation(requireProject(projectId))
      apply(result.project)
      return result.value
    })
  }

  function updateArticle(
    target: ArticleTarget,
    operation: (current: ArticleContext) => Promise<Article>,
    markOpened = false,
  ) {
    return enqueue(async () => {
      const current = requireArticle(target)
      const next = await operation(current)
      if (next !== current.article) applyArticle(current, next, markOpened)
      return next
    })
  }

  async function importYoutube<T>(
    request: YoutubeImportRequest,
    options: YoutubeImportOptions,
    work: (video: SelectedVideo) => Promise<T>,
  ) {
    const temporaryProjectId = crypto.randomUUID()
    try {
      const video = await downloadYoutubeVideo({
        projectId: temporaryProjectId,
        info: request.info,
        quality: request.quality,
        signal: options.signal,
        onProgress: options.onProgress,
      })
      return await work(video)
    } finally {
      await removeProjectSourceAssetDirectory(temporaryProjectId).catch(() => undefined)
    }
  }

  async function createFromVideo(video: SelectedVideo, fallbackTitle?: string) {
    const title = video.name.replace(/\.[^.]+$/, '').trim() || fallbackTitle || '無題のプロジェクト'
    const created = await projects.createProjectFromVideo(createEmptyProject(title), video)
    if (!getLoadedArticle(created.project)?.id)
      throw new Error('記事作成フローを開始できませんでした。')
    apply(created.project)
    return created
  }

  return {
    get project() {
      return project
    },
    get activeArticle() {
      return project ? getLoadedArticle(project) : null
    },
    getArticleWorkspace(target: ArticleTarget) {
      const article = project ? getLoadedArticle(project) : null
      return project?.id === target.projectId && article?.id === target.articleId
        ? { project, article }
        : null
    },
    createProject(title: string) {
      return enqueue(async () => {
        const next = createEmptyProject(title)
        await db.createProject(next)
        apply(next)
        return next
      })
    },
    createFromLocalVideo(video: SelectedVideo) {
      return enqueue(() => createFromVideo(video))
    },
    createFromYoutubeVideo(request: YoutubeImportRequest, options: YoutubeImportOptions) {
      return enqueue(() =>
        importYoutube(request, options, (video) => createFromVideo(video, request.info.title)),
      )
    },
    openProject(projectId: string) {
      return enqueue(async () => {
        const loaded = await db.loadProject(projectId)
        const article = getLoadedArticle(loaded)
        if (!article) {
          apply(loaded)
          return loaded
        }
        const saved = await articles.saveArticleWorkflow(
          { project: loaded, article },
          markArticleOpened(article, article.workflow.lastVisitedStep),
        )
        return applyArticle({ project: loaded, article }, saved, true)
      })
    },
    openArticle(target: ArticleTarget, preferredStep?: ProjectStep) {
      return enqueue(async () => {
        const loaded = await db.loadProject(target.projectId, target.articleId)
        const context = articleContext(loaded)
        const savedStep = preferredStep ?? context.article.workflow.lastVisitedStep
        const step = savedStep === 'export' ? 'article-review' : savedStep
        const saved = await articles.saveArticleWorkflow(
          context,
          markArticleOpened(context.article, step),
        )
        return { project: applyArticle(context, saved, true), step }
      })
    },
    openArticleDetail(target: ArticleTarget) {
      return enqueue(async () => {
        const loaded = await db.loadProject(target.projectId, target.articleId)
        apply(loaded)
        return loaded
      })
    },
    deleteProject(projectId: string) {
      return enqueue(async () => {
        await db.deleteProject(projectId)
        const cleared = project?.id === projectId
        if (cleared) apply(null)
        return cleared
      })
    },
    renameProject(projectId: string, title: string) {
      return updateProject(projectId, async (current) => ({
        project: await projects.renameProject(current, title),
        value: undefined,
      }))
    },
    addLocalVideo(projectId: string, video: SelectedVideo) {
      return updateProject(projectId, async (current) => {
        const added = await projects.addVideoToProject(current, video)
        return { project: added.project, value: added.video }
      })
    },
    addYoutubeVideo(
      projectId: string,
      request: YoutubeImportRequest,
      options: YoutubeImportOptions,
    ) {
      return enqueue(async () => {
        requireProject(projectId)
        return importYoutube(request, options, async (video) => {
          const added = await projects.addVideoToProject(requireProject(projectId), video)
          apply(added.project)
          return added.video
        })
      })
    },
    createArticles(
      projectId: string,
      videoId: string,
      ranges: Array<{ title: string; range: VideoTrimRange }>,
      crop: CropRegion,
      perspectiveCrop?: PerspectiveCrop,
    ) {
      return updateProject(projectId, async (current) => {
        const created = await projects.addArticlesToProject(
          current,
          videoId,
          ranges,
          crop,
          perspectiveCrop,
        )
        return { project: created.project, value: created.articles }
      })
    },
    deleteArticle(target: ArticleTarget) {
      return updateProject(target.projectId, async (current) => ({
        project: await db.deleteProjectArticle(current, target.articleId),
        value: undefined,
      }))
    },
    deleteVideo(projectId: string, videoId: string) {
      return updateProject(projectId, async (current) => ({
        project: await db.deleteProjectVideo(current, videoId),
        value: undefined,
      }))
    },
    visitStep(target: ArticleTarget, step: Exclude<ProjectStep, 'export'>, advance = false) {
      return updateArticle(
        target,
        (current) =>
          articles.saveArticleWorkflow(
            current,
            advance
              ? updateArticleWorkflow(current.article, step)
              : markArticleOpened(current.article, step),
          ),
        true,
      )
    },
    markExported(target: ArticleTarget) {
      return updateArticle(
        target,
        (current) => articles.saveArticleWorkflow(current, markArticleExported(current.article)),
        true,
      )
    },
    saveArticleSource: (
      target: ArticleTarget,
      range: VideoTrimRange,
      crop: CropRegion,
      perspectiveCrop?: PerspectiveCrop,
    ) =>
      updateArticle(target, (current) =>
        articles.saveArticleSource(current, range, crop, perspectiveCrop),
      ),
    saveSlideDetection: (target: ArticleTarget, output: SlideDetectionOutput) =>
      updateArticle(target, (current) => articles.saveSlideDetection(current, output)),
    saveTranscription: (target: ArticleTarget, result: TranscriptionResult) =>
      updateArticle(target, (current) => articles.saveTranscription(current, result)),
    saveOcrBatch: (
      target: ArticleTarget,
      results: Array<{ slideId: string; ocr: SlideOcrResult }>,
    ) => updateArticle(target, (current) => articles.saveOcrBatch(current, results)),
    saveTranscriptBoundaryPlan: (target: ArticleTarget, plan: TranscriptBoundaryPlan) =>
      updateArticle(target, (current) => articles.saveTranscriptBoundaryPlan(current, plan)),
    saveSlideContentBatch: (
      target: ArticleTarget,
      results: Array<{ slideId: string; result: ContentProcessingResult }>,
    ) => updateArticle(target, (current) => articles.saveSlideContentBatch(current, results)),
    saveSlideResultEdits: (target: ArticleTarget, slideId: string, edits: SlideResultEdits) =>
      updateArticle(target, (current) => articles.saveSlideResultEdits(current, slideId, edits)),
    saveArticleDraft: (target: ArticleTarget, draft: ArticleDraft) =>
      updateArticle(target, (current) => articles.saveArticleDraft(current, draft)),
    saveArticleSections: (target: ArticleTarget, sections: ArticleSections | null) =>
      updateArticle(target, (current) => articles.saveArticleSections(current, sections)),
    saveArticleTitle: (target: ArticleTarget, title: string) =>
      updateArticle(target, (current) => articles.saveArticleTitle(current, title)),
    saveArticleSummary: (target: ArticleTarget, summary: ArticleSummary) =>
      updateArticle(target, (current) => articles.saveArticleSummary(current, summary)),
    saveArticleTranslation: (target: ArticleTarget, translation: ArticleTranslation) =>
      updateArticle(target, (current) => articles.saveArticleTranslation(current, translation)),
    saveArticleOutputLanguage: (target: ArticleTarget, language: ArticleOutputLanguage) =>
      updateArticle(target, (current) => articles.saveArticleOutputLanguage(current, language)),
  }
}

export type ProjectWorkspace = ReturnType<typeof createProjectWorkspace>
