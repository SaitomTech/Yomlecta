import { appLocalDataDir, join } from '@tauri-apps/api/path'
import {
  appLocalPathExists,
  ensureAppLocalDirectory,
  readAppLocalDirectory,
  removeAppLocalPath,
} from '../tauri/filesystem'
import type { ArticleContext } from '../../types/project'

function assertId(value: string, label: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`不正な${label}です。`)
}

function assertFilePart(value: string, label: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`不正な${label}です。`)
}

function assertNonnegativeIndex(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`不正な${label}です。`)
}

function projectAssetDirectory(projectId: string, assetDirectory: string) {
  assertId(projectId, 'プロジェクトID')
  if (
    !assetDirectory ||
    assetDirectory.includes('..') ||
    assetDirectory.startsWith('/') ||
    assetDirectory.includes('\\')
  ) {
    throw new Error('不正なアセットパスです。')
  }
  return `projects/${projectId}/${assetDirectory}`
}

function articleAssetDirectory(projectId: string, articleId: string, assetDirectory: string) {
  assertId(articleId, '記事ID')
  return projectAssetDirectory(projectId, `articles/${articleId}/${assetDirectory}`)
}

async function prepareRelativeDirectory(relativeDirectory: string) {
  await ensureAppLocalDirectory(relativeDirectory)
  return join(await appLocalDataDir(), relativeDirectory)
}

async function prepareProjectAssetDirectory(projectId: string, assetDirectory: string) {
  return prepareRelativeDirectory(projectAssetDirectory(projectId, assetDirectory))
}

async function prepareArticleAssetDirectory(
  projectId: string,
  articleId: string,
  assetDirectory: string,
) {
  return prepareRelativeDirectory(articleAssetDirectory(projectId, articleId, assetDirectory))
}

export async function prepareProjectVideoDirectory(projectId: string, videoId: string) {
  assertId(videoId, '動画ID')
  return prepareRelativeDirectory(projectAssetDirectory(projectId, `videos/${videoId}`))
}

export async function getProjectVideoPath(projectId: string, videoId: string, extension: string) {
  assertFilePart(extension, '拡張子')
  const directory = await prepareProjectVideoDirectory(projectId, videoId)
  return join(directory, `original.${extension}`)
}

export async function getProjectVideoThumbnailPath(projectId: string, videoId: string) {
  const directory = await prepareProjectVideoDirectory(projectId, videoId)
  return join(directory, 'thumbnail.jpg')
}

export async function removeProjectVideoThumbnail(projectId: string, videoId: string) {
  assertId(videoId, '動画ID')
  const path = `${projectAssetDirectory(projectId, `videos/${videoId}`)}/thumbnail.jpg`
  if (await appLocalPathExists(path)) await removeAppLocalPath(path)
}

export async function removeProjectVideoAssetDirectory(projectId: string, videoId: string) {
  assertId(videoId, '動画ID')
  const path = projectAssetDirectory(projectId, `videos/${videoId}`)
  if (await appLocalPathExists(path)) await removeAppLocalPath(path)
}

export async function getProjectVideoRangeThumbnailPath(
  projectId: string,
  videoId: string,
  rangeId: string,
) {
  assertId(videoId, '動画ID')
  assertId(rangeId, '範囲ID')
  const directory = await prepareRelativeDirectory(
    projectAssetDirectory(projectId, `videos/${videoId}/range-thumbnails`),
  )
  return join(directory, `${rangeId}.jpg`)
}

export async function removeProjectVideoRangeThumbnail(
  projectId: string,
  videoId: string,
  rangeId: string,
) {
  assertId(videoId, '動画ID')
  assertId(rangeId, '範囲ID')
  await removeAppLocalPath(
    `${projectAssetDirectory(projectId, `videos/${videoId}/range-thumbnails`)}/${rangeId}.jpg`,
  ).catch(() => undefined)
}

export async function prepareProjectSourceAssetDirectory(projectId: string) {
  return prepareProjectAssetDirectory(projectId, 'source')
}

/** Temporary crop assets are project-scoped because an Article does not exist yet. */
export async function getCropPreviewAssetPath(projectId: string) {
  const directory = await prepareProjectAssetDirectory(projectId, 'temp')
  return join(directory, 'crop-preview.jpg')
}

export async function prepareCropDetectionDirectory(projectId: string) {
  return prepareProjectAssetDirectory(projectId, 'temp/crop-detection')
}

export async function removeCropDetectionDirectory(projectId: string) {
  await removeAppLocalPath(projectAssetDirectory(projectId, 'temp/crop-detection')).catch(
    () => undefined,
  )
}

export async function prepareVisualClassificationDirectory(
  projectId: string,
  articleId: string,
  runId: string,
) {
  assertId(runId, '視覚分類run ID')
  return prepareArticleAssetDirectory(projectId, articleId, `temp/visual-classification/${runId}`)
}

export async function removeVisualClassificationDirectory(
  projectId: string,
  articleId: string,
  runId: string,
) {
  assertId(runId, '視覚分類run ID')
  await removeAppLocalPath(
    articleAssetDirectory(projectId, articleId, `temp/visual-classification/${runId}`),
  ).catch(() => undefined)
}

export async function removeProjectSourceAssetDirectory(projectId: string) {
  await removeAppLocalPath(projectAssetDirectory(projectId, 'source')).catch(() => undefined)
}

function slideRunDirectory(projectId: string, articleId: string, runId: string) {
  assertId(runId, 'スライド画像run ID')
  return articleAssetDirectory(projectId, articleId, `runs/slides/${runId}`)
}

export async function getSlideRunAssetPath(
  projectId: string,
  articleId: string,
  runId: string,
  slideIndex: number,
) {
  assertNonnegativeIndex(slideIndex, 'スライド番号')
  const directory = await prepareRelativeDirectory(slideRunDirectory(projectId, articleId, runId))
  return join(directory, `slide-${String(slideIndex + 1).padStart(3, '0')}.jpg`)
}

export async function removeSlideRunAssets(projectId: string, articleId: string, runId: string) {
  const path = slideRunDirectory(projectId, articleId, runId)
  if (await appLocalPathExists(path)) await removeAppLocalPath(path)
}

export async function pruneSlideAssetRuns(
  projectId: string,
  articleId: string,
  activeRunId?: string,
) {
  if (activeRunId) assertId(activeRunId, 'スライド画像run ID')
  const runsDirectory = articleAssetDirectory(projectId, articleId, 'runs/slides')
  if (await appLocalPathExists(runsDirectory)) {
    const entries = await readAppLocalDirectory(runsDirectory)
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory && entry.name !== activeRunId)
        .map((entry) => removeAppLocalPath(`${runsDirectory}/${entry.name}`)),
    )
  }

  if (activeRunId) {
    const legacyDirectory = articleAssetDirectory(projectId, articleId, 'runs/current/slides')
    if (await appLocalPathExists(legacyDirectory)) await removeAppLocalPath(legacyDirectory)
  }
}

export async function getSlidePreviewAssetPath(
  projectId: string,
  articleId: string,
  previewId: string,
  rangeKey: string,
) {
  assertId(articleId, '記事ID')
  assertId(previewId, 'プレビューID')
  assertFilePart(rangeKey, '区間ID')
  const directory = await prepareArticleAssetDirectory(
    projectId,
    articleId,
    `temp/slide-previews/${previewId}`,
  )
  return join(directory, `${rangeKey}.jpg`)
}

export async function removeSlidePreviewAssets(
  projectId: string,
  articleId: string,
  previewId: string,
) {
  assertId(articleId, '記事ID')
  assertId(previewId, 'プレビューID')
  const path = articleAssetDirectory(projectId, articleId, `temp/slide-previews/${previewId}`)
  if (await appLocalPathExists(path)) await removeAppLocalPath(path)
}

export async function getAudioAssetPath(projectId: string, articleId: string) {
  const directory = await prepareArticleAssetDirectory(projectId, articleId, 'runs/current/audio')
  return join(directory, 'source-16k.wav')
}

export async function getTranscriptionAudioChunkPath(
  projectId: string,
  articleId: string,
  provider: 'local' | 'openai',
  chunkIndex: number,
) {
  assertNonnegativeIndex(chunkIndex, '音声チャンク番号')
  const directory = await prepareArticleAssetDirectory(
    projectId,
    articleId,
    `runs/current/audio/${provider}`,
  )
  return join(
    directory,
    `chunk-${String(chunkIndex + 1).padStart(3, '0')}.${provider === 'local' ? 'wav' : 'm4a'}`,
  )
}

export async function getRawTranscriptAssetPath(projectId: string, articleId: string) {
  const directory = await prepareArticleAssetDirectory(
    projectId,
    articleId,
    'runs/current/transcript',
  )
  return join(directory, 'raw.json')
}

export async function removeArticleAssetDirectory(projectId: string, articleId: string) {
  assertId(articleId, '記事ID')
  const path = projectAssetDirectory(projectId, `articles/${articleId}`)
  if (await appLocalPathExists(path)) await removeAppLocalPath(path)
}

export async function removeArticleRunDirectories(projectId: string, articleId: string) {
  const path = articleAssetDirectory(projectId, articleId, 'runs')
  if (await appLocalPathExists(path)) await removeAppLocalPath(path)
}

export async function resetTranscriptionAudioChunks(
  projectId: string,
  articleId: string,
  provider: 'local' | 'openai',
) {
  const path = articleAssetDirectory(projectId, articleId, `runs/current/audio/${provider}`)
  if (await appLocalPathExists(path)) await removeAppLocalPath(path)
}

export async function pruneSlideAssets(projectId: string, articleId: string, slideCount: number) {
  const directory = articleAssetDirectory(projectId, articleId, 'runs/current/slides')
  if (!(await appLocalPathExists(directory))) return
  const expected = new Set(
    Array.from(
      { length: slideCount },
      (_, index) => `slide-${String(index + 1).padStart(3, '0')}.jpg`,
    ),
  )
  const entries = await readAppLocalDirectory(directory)
  await Promise.all(
    entries
      .filter(
        (entry) => entry.isFile && /^slide-\d+\.jpg$/.test(entry.name) && !expected.has(entry.name),
      )
      .map((entry) => removeAppLocalPath(`${directory}/${entry.name}`)),
  )
}

export async function cleanupProjectDerivedAssets(
  project: ArticleContext,
  detailArticleId?: string,
) {
  const activeArticle = project.article
  if (detailArticleId && detailArticleId !== activeArticle.id) return
  await pruneSlideAssets(project.project.id, activeArticle.id, activeArticle.visualSegments.length)
  const slideRunIds = new Set(
    activeArticle.visualSegments.flatMap((slide) => {
      const match = slide.image.representativeFramePath?.match(
        /[/\\]runs[/\\]slides[/\\]([a-zA-Z0-9_-]+)[/\\]slide-\d+\.jpg$/,
      )
      return match ? [match[1]] : []
    }),
  )
  if (slideRunIds.size <= 1) {
    await pruneSlideAssetRuns(
      project.project.id,
      activeArticle.id,
      slideRunIds.values().next().value,
    )
  }
  const previewDirectory = articleAssetDirectory(
    project.project.id,
    activeArticle.id,
    'temp/slide-previews',
  )
  if (await appLocalPathExists(previewDirectory)) await removeAppLocalPath(previewDirectory)
  if (activeArticle.transcription) return
  await Promise.all(
    ['runs/current/audio', 'runs/current/transcript'].map(async (directory) => {
      const path = articleAssetDirectory(project.project.id, activeArticle.id, directory)
      if (await appLocalPathExists(path)) await removeAppLocalPath(path)
    }),
  )
}
