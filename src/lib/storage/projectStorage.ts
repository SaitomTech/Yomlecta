import { parseMediaProject } from '../../schemas/project'
import type {
  Article,
  ArticleData,
  MediaProject,
  ProjectVideo,
  SlideData,
  SlideDetectionResult,
  SlideOcrResult,
  TranscriptionResult,
  ProjectListEntry,
} from '../../types/project'
import {
  appLocalPathExists,
  ensureAppLocalDirectory,
  fileExists,
  renameAppLocalPath,
  writeAppLocalTextFile,
} from '../tauri/filesystem'
import {
  PROJECT_TRASH_DIRECTORY,
  beginAssetTrashTransaction,
  finishAssetTrashTransaction,
  projectDirectory,
  recoverAssetTrash,
  recoverProjectTrash,
  removeIfPresent,
  restoreAssetTrashTransaction,
} from './projectAssetTransactions'
import { invokeDb } from '../tauri/db'

const invoke = invokeDb

let storageInitialization: Promise<void> | null = null
const projectRevisions = new Map<string, number>()
const articleRevisions = new Map<string, number>()
const documentRevisions = new Map<string, number>()
const slideRevisions = new Map<string, number>()
const ocrRevisions = new Map<string, number>()

type RevisionMap = Record<string, number>
type LoadedProjectPayload = {
  project: unknown
  revision: number
  articleRevisions?: RevisionMap
  documentRevisions?: RevisionMap
  slideRevisions?: RevisionMap
  ocrRevisions?: RevisionMap
}

function applyRevisionSnapshot(projectId: string, loaded: LoadedProjectPayload) {
  projectRevisions.set(projectId, loaded.revision)
  for (const [key, map] of [
    [articleRevisions, loaded.articleRevisions],
    [documentRevisions, loaded.documentRevisions],
    [slideRevisions, loaded.slideRevisions],
    [ocrRevisions, loaded.ocrRevisions],
  ] as const) {
    for (const [id, revision] of Object.entries(map ?? {})) key.set(id, revision)
  }
}

async function initializeProjectStorage() {
  if (storageInitialization) return storageInitialization
  // The Rust setup hook opens SQLite and applies migrations before this webview is interactive.
  const initialization = (async () => {
    await ensureAppLocalDirectory('projects')
    await recoverProjectTrash()
    await recoverAssetTrash()
  })()
  storageInitialization = initialization.catch((error) => {
    storageInitialization = null
    throw error
  })
  return storageInitialization
}

export async function createProject(project: MediaProject) {
  await initializeProjectStorage()
  await invoke('db_create_project', {
    projectId: project.id,
    title: project.title,
    version: project.version,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  })
  projectRevisions.set(project.id, 0)
  return project
}

export async function updateProject(project: MediaProject) {
  await initializeProjectStorage()
  const result = await invoke<{ revision: number }>('db_update_project', {
    projectId: project.id,
    title: project.title,
    activeArticleId: project.activeArticleId ?? null,
    updatedAt: project.updatedAt,
    expectedRevision: projectRevisions.get(project.id),
  })
  projectRevisions.set(project.id, result.revision)
  return project
}

export async function updateArticleTitle(project: MediaProject, article: Article) {
  await initializeProjectStorage()
  const result = await invoke<{
    projectRevision: number
    articleRevision: number
    documentRevision: number
  }>('db_update_article_title', {
    projectId: project.id,
    articleId: article.id,
    title: article.title,
    updatedAt: article.updatedAt,
    expectedProjectRevision: projectRevisions.get(project.id),
    expectedArticleRevision: articleRevisions.get(article.id),
    expectedDocumentRevision: documentRevisions.get(article.id),
  })
  projectRevisions.set(project.id, result.projectRevision)
  articleRevisions.set(article.id, result.articleRevision)
  documentRevisions.set(article.id, result.documentRevision)
  return result
}

export async function updateArticleWorkflow(project: MediaProject, article: Article) {
  await initializeProjectStorage()
  const result = await invoke<{
    projectRevision: number
    articleRevision: number
  }>('db_update_article_workflow', {
    projectId: project.id,
    articleId: article.id,
    activeArticleId: project.activeArticleId ?? null,
    workflow: article.workflow,
    updatedAt: article.updatedAt,
    expectedProjectRevision: projectRevisions.get(project.id),
    expectedArticleRevision: articleRevisions.get(article.id),
  })
  projectRevisions.set(project.id, result.projectRevision)
  articleRevisions.set(article.id, result.articleRevision)
  return result
}

export async function updateArticleContent(
  project: MediaProject,
  article: Article,
  slides: SlideData[],
) {
  await initializeProjectStorage()
  const expectedSlideRevisions = Object.fromEntries(
    slides.map((slide) => [slide.id, slideRevisions.get(slide.id) ?? 0]),
  )
  const result = await invoke<{
    projectRevision: number
    articleRevision: number
    documentRevision: number
    slideRevisions: Array<{ id: string; revision: number }>
  }>('db_update_article_content', {
    projectId: project.id,
    projectUpdatedAt: project.updatedAt,
    article,
    slides,
    expectedSlideRevisions,
    expectedProjectRevision: projectRevisions.get(project.id),
    expectedArticleRevision: articleRevisions.get(article.id),
    expectedDocumentRevision: documentRevisions.get(article.id),
  })
  projectRevisions.set(project.id, result.projectRevision)
  articleRevisions.set(article.id, result.articleRevision)
  documentRevisions.set(article.id, result.documentRevision)
  for (const revision of result.slideRevisions) slideRevisions.set(revision.id, revision.revision)
  return result
}

export async function createVideoAndUpdateProject(project: MediaProject, video: ProjectVideo) {
  await initializeProjectStorage()
  const result = await invoke<{ projectRevision: number }>('db_create_video_and_update_project', {
    projectId: project.id,
    video,
    updatedAt: project.updatedAt,
    expectedProjectRevision: projectRevisions.get(project.id),
  })
  projectRevisions.set(project.id, result.projectRevision)
  return result
}

export async function createProjectBundle(
  project: MediaProject,
  video: ProjectVideo,
  article: Article,
) {
  await initializeProjectStorage()
  await invoke('db_create_project_bundle', { project, video, article })
  projectRevisions.set(project.id, 0)
  articleRevisions.set(article.id, 0)
  documentRevisions.set(article.id, 0)
}

export async function createArticles(project: MediaProject, articles: Article[]) {
  await initializeProjectStorage()
  const result = await invoke<{ projectRevision: number }>('db_create_articles', {
    projectId: project.id,
    articles,
    updatedAt: project.updatedAt,
    expectedProjectRevision: projectRevisions.get(project.id),
  })
  projectRevisions.set(project.id, result.projectRevision)
  for (const article of articles) {
    articleRevisions.set(article.id, 0)
    documentRevisions.set(article.id, 0)
  }
  return result
}

export async function updateArticleSource(
  project: MediaProject,
  article: Article,
  options: { expectedDocumentRevision?: number } = {},
) {
  await initializeProjectStorage()
  const result = await invoke<{
    projectRevision: number
    articleRevision: number
    documentRevision: number
    removedSlideIds: string[]
  }>('db_update_article_source', {
    projectId: project.id,
    articleId: article.id,
    sourceRange: article.sourceRange,
    crop: article.crop ?? null,
    perspectiveCrop: article.perspectiveCrop ?? null,
    workflow: article.workflow,
    updatedAt: article.updatedAt,
    expectedProjectRevision: projectRevisions.get(project.id),
    expectedArticleRevision: articleRevisions.get(article.id),
    expectedDocumentRevision: options.expectedDocumentRevision ?? documentRevisions.get(article.id),
  })
  projectRevisions.set(project.id, result.projectRevision)
  articleRevisions.set(article.id, result.articleRevision)
  documentRevisions.set(article.id, result.documentRevision)
  for (const slideId of result.removedSlideIds) {
    slideRevisions.delete(slideId)
    ocrRevisions.delete(slideId)
  }
  return result
}

function runId() {
  return crypto.randomUUID()
}

export async function commitSlideDetection(
  project: MediaProject,
  detectionResult: SlideDetectionResult,
  slides: SlideData[],
) {
  await initializeProjectStorage()
  const articleId = project.activeArticleId
  if (!articleId) throw new Error('記事が選択されていません。')
  const article = project.articles.find((candidate) => candidate.id === articleId)
  if (!article) throw new Error('記事が見つかりません。')
  const result = await invoke<{
    projectRevision: number
    articleRevision: number
    slideRevisions?: Array<{ id: string; revision: number }>
  }>('db_commit_slide_detection', {
    articleId,
    runId: runId(),
    result: detectionResult,
    slides,
    article,
    projectTitle: project.title,
    activeArticleId: project.activeArticleId,
    projectUpdatedAt: project.updatedAt,
    expectedProjectRevision: projectRevisions.get(project.id),
    expectedRevision: articleRevisions.get(articleId),
  })
  projectRevisions.set(project.id, result.projectRevision)
  articleRevisions.set(articleId, result.articleRevision)
  for (const revision of result.slideRevisions ?? [])
    slideRevisions.set(revision.id, revision.revision)
  return result
}

export async function commitTranscription(
  project: MediaProject,
  transcription: TranscriptionResult,
  slides: SlideData[],
) {
  await initializeProjectStorage()
  const articleId = project.activeArticleId
  if (!articleId) throw new Error('記事が選択されていません。')
  const article = project.articles.find((candidate) => candidate.id === articleId)
  if (!article) throw new Error('記事が見つかりません。')
  const result = await invoke<{
    projectRevision: number
    articleRevision: number
    slideRevisions?: Array<{ id: string; revision: number }>
  }>('db_commit_transcription', {
    articleId,
    runId: runId(),
    transcription,
    slides,
    article,
    projectTitle: project.title,
    activeArticleId: project.activeArticleId,
    projectUpdatedAt: project.updatedAt,
    expectedProjectRevision: projectRevisions.get(project.id),
    expectedRevision: articleRevisions.get(articleId),
  })
  projectRevisions.set(project.id, result.projectRevision)
  articleRevisions.set(articleId, result.articleRevision)
  for (const revision of result.slideRevisions ?? [])
    slideRevisions.set(revision.id, revision.revision)
  return result
}

export async function commitOcr(
  project: MediaProject,
  slideId: string,
  ocr: SlideOcrResult,
  transcript: NonNullable<SlideData['transcript']> | undefined,
) {
  await initializeProjectStorage()
  const articleId = project.activeArticleId
  if (!articleId) throw new Error('記事が選択されていません。')
  const article = project.articles.find((candidate) => candidate.id === articleId)
  if (!article) throw new Error('記事が見つかりません。')
  const result = await invoke<{
    projectRevision: number
    articleRevision: number
    slideId: string
    slideRevision: number
    ocrId: string
    ocrRevision: number
  }>('db_commit_ocr', {
    articleId,
    slideId,
    runId: runId(),
    ocrResultId: runId(),
    ocr,
    transcript: transcript ?? null,
    article,
    projectTitle: project.title,
    activeArticleId: project.activeArticleId,
    projectUpdatedAt: project.updatedAt,
    expectedProjectRevision: projectRevisions.get(project.id),
    expectedRevision: articleRevisions.get(articleId),
    expectedSlideRevision: slideRevisions.get(slideId),
  })
  projectRevisions.set(project.id, result.projectRevision)
  articleRevisions.set(articleId, result.articleRevision)
  slideRevisions.set(result.slideId, result.slideRevision)
  ocrRevisions.set(result.slideId, result.ocrRevision)
  return result
}

export async function commitSlideContent(
  project: MediaProject,
  slideId: string,
  contentResult: unknown,
  transcript: NonNullable<SlideData['transcript']>,
) {
  await initializeProjectStorage()
  const articleId = project.activeArticleId
  if (!articleId) throw new Error('記事が選択されていません。')
  const article = project.articles.find((candidate) => candidate.id === articleId)
  if (!article) throw new Error('記事が見つかりません。')
  const result = await invoke<{
    projectRevision: number
    articleRevision: number
    slideId: string
    revision: number
  }>('db_commit_slide_content', {
    articleId,
    slideId,
    runId: runId(),
    result: contentResult,
    transcript,
    article,
    projectTitle: project.title,
    activeArticleId: project.activeArticleId,
    projectUpdatedAt: project.updatedAt,
    expectedProjectRevision: projectRevisions.get(project.id),
    expectedArticleRevision: articleRevisions.get(articleId),
    expectedRevision: slideRevisions.get(slideId),
  })
  projectRevisions.set(project.id, result.projectRevision)
  articleRevisions.set(articleId, result.articleRevision)
  slideRevisions.set(result.slideId, result.revision)
  return result
}

export async function updateSlideResults(
  project: MediaProject,
  slideId: string,
  transcript: NonNullable<SlideData['transcript']> | undefined,
  ocr: SlideOcrResult | undefined,
) {
  await initializeProjectStorage()
  const articleId = project.activeArticleId
  if (!articleId) throw new Error('記事が選択されていません。')
  const article = project.articles.find((candidate) => candidate.id === articleId)
  if (!article) throw new Error('記事が見つかりません。')
  const result = await invoke<{
    projectRevision: number
    articleRevision: number
    slideId: string
    slideRevision: number
    ocr?: { ocrId: string; revision: number }
  }>('db_update_slide_results', {
    articleId,
    slideId,
    transcript: transcript ?? null,
    ocrText: ocr?.rawText ?? null,
    article,
    projectTitle: project.title,
    activeArticleId: project.activeArticleId,
    projectUpdatedAt: project.updatedAt,
    expectedProjectRevision: projectRevisions.get(project.id),
    expectedArticleRevision: articleRevisions.get(articleId),
    expectedSlideRevision: slideRevisions.get(slideId),
    expectedOcrRevision: ocr ? ocrRevisions.get(slideId) : null,
  })
  projectRevisions.set(project.id, result.projectRevision)
  articleRevisions.set(articleId, result.articleRevision)
  slideRevisions.set(result.slideId, result.slideRevision)
  if (result.ocr) ocrRevisions.set(result.slideId, result.ocr.revision)
  return result
}

export async function updateDocumentAndArticle(
  project: MediaProject,
  article: Article,
  articleData: ArticleData | undefined,
  options: { runKind?: 'summary_generation' | 'chapter_generation' } = {},
) {
  await initializeProjectStorage()
  const result = await invoke<{
    projectRevision: number
    articleRevision: number
    documentRevision: number
  }>('db_update_document_and_article', {
    projectId: project.id,
    projectUpdatedAt: project.updatedAt,
    article,
    articleData: articleData ?? null,
    ...(options.runKind ? { runId: runId(), runKind: options.runKind } : {}),
    expectedProjectRevision: projectRevisions.get(project.id),
    expectedArticleRevision: articleRevisions.get(article.id),
    expectedDocumentRevision: documentRevisions.get(article.id),
  })
  projectRevisions.set(project.id, result.projectRevision)
  articleRevisions.set(article.id, result.articleRevision)
  documentRevisions.set(article.id, result.documentRevision)
  return result
}

export async function checkStorageReference(
  referenceType: 'project' | 'article' | 'video',
  projectId: string,
  assetId?: string,
) {
  return invoke<{ referenced: boolean }>('db_check_storage_reference', {
    referenceType,
    projectId,
    assetId: assetId ?? null,
  })
}

export async function loadProject(projectId: string) {
  await initializeProjectStorage()
  const loaded = await invoke<LoadedProjectPayload>('db_load_project', {
    projectId,
  })
  const project = parseMediaProject(loaded.project)
  applyRevisionSnapshot(projectId, loaded)
  return project
}

export async function listProjects() {
  await initializeProjectStorage()
  const persistedProjects = await invoke<ProjectListEntry[]>('db_list_projects')
  const projects = await Promise.all(
    persistedProjects.map(async (entry): Promise<ProjectListEntry> => {
      if (entry.kind === 'invalid') return entry
      const sourceExists = entry.summary.sourcePath
        ? await fileExists(entry.summary.sourcePath)
        : true
      return {
        ...entry,
        summary: {
          ...entry.summary,
          health: sourceExists ? entry.summary.health : 'needs-repair',
        },
      }
    }),
  )
  return projects.sort((first, second) => {
    const a = first.kind === 'project' ? first.summary.lastOpenedAt : ''
    const b = second.kind === 'project' ? second.summary.lastOpenedAt : ''
    return b.localeCompare(a)
  })
}

export async function deleteProjectArticle(project: MediaProject, articleId: string) {
  await initializeProjectStorage()
  const transaction = await beginAssetTrashTransaction(project.id, 'articles', articleId)
  try {
    await invoke('db_delete_article', { projectId: project.id, articleId })
    await finishAssetTrashTransaction(transaction)
    return loadProject(project.id)
  } catch (error) {
    const reference = await checkStorageReference('article', project.id, articleId).catch(
      () => null,
    )
    if (reference?.referenced === true) {
      await restoreAssetTrashTransaction(transaction).catch((restoreError) => {
        throw new AggregateError([error, restoreError], '記事削除のロールバックに失敗しました。')
      })
      await finishAssetTrashTransaction(transaction)
    } else if (reference?.referenced === false) {
      await finishAssetTrashTransaction(transaction)
    }
    throw error
  }
}

export async function deleteProjectVideo(project: MediaProject, videoId: string) {
  await initializeProjectStorage()
  const transaction = await beginAssetTrashTransaction(project.id, 'videos', videoId)
  try {
    await invoke('db_delete_video', { projectId: project.id, videoId })
    await finishAssetTrashTransaction(transaction)
    return loadProject(project.id)
  } catch (error) {
    const reference = await checkStorageReference('video', project.id, videoId).catch(() => null)
    if (reference?.referenced === true) {
      await restoreAssetTrashTransaction(transaction).catch((restoreError) => {
        throw new AggregateError([error, restoreError], '動画削除のロールバックに失敗しました。')
      })
      await finishAssetTrashTransaction(transaction)
    } else if (reference?.referenced === false) {
      await finishAssetTrashTransaction(transaction)
    }
    throw error
  }
}

export async function deleteProject(projectId: string) {
  await initializeProjectStorage()
  const sourcePath = projectDirectory(projectId)
  const hasAssets = await appLocalPathExists(sourcePath)
  const trashPath = `${PROJECT_TRASH_DIRECTORY}/${projectId}`
  try {
    if (hasAssets) {
      await ensureAppLocalDirectory(PROJECT_TRASH_DIRECTORY)
      await renameAppLocalPath(sourcePath, trashPath)
      await writeAppLocalTextFile(
        `${trashPath}/operation.json`,
        `${JSON.stringify({ projectId, state: 'moved' })}\n`,
      )
    }
    await invoke('db_delete_project', { projectId })
  } catch (error) {
    const reference = await checkStorageReference('project', projectId).catch(() => null)
    if (hasAssets && reference?.referenced === true) {
      await ensureAppLocalDirectory('projects')
      await renameAppLocalPath(trashPath, sourcePath).catch((restoreError) => {
        throw new AggregateError(
          [error, restoreError],
          'プロジェクト削除のロールバックに失敗しました。',
        )
      })
      await removeIfPresent(`${sourcePath}/operation.json`).catch(() => undefined)
    } else if (hasAssets && reference?.referenced === false) {
      await removeIfPresent(trashPath)
    }
    throw error
  }
  if (hasAssets) {
    try {
      await removeIfPresent(trashPath)
    } catch (error) {
      console.warn('削除済みプロジェクトのasset領域を削除できませんでした。', error)
    }
  }
  projectRevisions.delete(projectId)
}
