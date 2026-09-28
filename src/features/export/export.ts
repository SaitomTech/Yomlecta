import { convertFileSrc } from '@tauri-apps/api/core'
import { appLocalDataDir, dirname, join } from '@tauri-apps/api/path'
import { open, save } from '@tauri-apps/plugin-dialog'
import {
  copyFile,
  ensureDirectory,
  fileExists,
  getFileFingerprint,
  readTextFile,
  removeAbsolutePath,
  writeTextFile,
} from '../../lib/tauri/filesystem'
import { hasCurrentArticleSections, hasCurrentArticleSummary } from '../article/article'
import {
  getActiveArticle,
  getActiveMediaSource,
  effectiveVisualKind,
  type ArticleSection,
  type ArticleOutputLanguage,
  type ArticleSummary,
  type ArticleTranslation,
  type ArticleTranslationSummary,
  type MediaProject,
} from '../../types/project'
import { getActiveArticleDuration } from '../../lib/project/articleSource'
import { articleBlockViews } from '../../lib/pipeline/articleBlocks'
import {
  getArticleSourceLanguage,
  getCurrentTranslationForOutputLanguage,
  getArticleOutputLanguage,
  isArticleOutputLanguageAvailable,
} from '../article/outputLanguage'
import { renderHtml, renderMarkdown, renderTxt } from './renderers'

export const EXPORT_OPTIONS = [
  { format: 'html', label: 'HTML', filename: 'index.html' },
  { format: 'markdown', label: 'Markdown', filename: 'notes.md' },
  { format: 'txt', label: 'TXT', filename: 'notes.txt' },
] as const

export type ExportFormat = (typeof EXPORT_OPTIONS)[number]['format']

export type ExportProgress = {
  stage: 'copying-images' | 'writing-files'
  completed: number
  total: number
}

export type ExportFile = {
  format: ExportFormat
  filename: string
  path: string
}

export type ExportAsset = {
  filename: string
  path: string
}

export type ExportResult = {
  files: ExportFile[]
  assets: ExportAsset[]
  previewHtml: string
}

export type ExportSection = {
  id: string
  index: number
  startMs: number
  endMs: number
  imagePath: string
  sourceImagePath: string
  ocrText: string
  transcriptRaw: string
  body: string
  translations: Array<{ language: string; body: string; heading?: string }>
}

export type ExportTranslation = {
  language: string
  title: string
  summary?: ArticleTranslationSummary
}

export type ExportDocument = {
  title: string
  sourceLanguage: string
  sourceName: string
  durationMs: number
  summary?: ArticleSummary | ArticleTranslationSummary
  translations: ExportTranslation[]
  articleSections?: ArticleSection[]
  sections: ExportSection[]
}

const EXPORT_RENDERERS: Record<ExportFormat, (document: ExportDocument) => string> = {
  html: renderHtml,
  markdown: renderMarkdown,
  txt: renderTxt,
}

type ExportAssetFingerprint = {
  sourcePath: string
  size: number
  mtimeMs: number | null
}

type ExportAssetManifest = Record<string, ExportAssetFingerprint>

function isExportAssetFingerprint(value: unknown): value is ExportAssetFingerprint {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ExportAssetFingerprint>
  return (
    typeof candidate.sourcePath === 'string' &&
    typeof candidate.size === 'number' &&
    (typeof candidate.mtimeMs === 'number' || candidate.mtimeMs === null)
  )
}

async function readExportAssetManifest(path: string): Promise<ExportAssetManifest> {
  try {
    const parsed = JSON.parse(await readTextFile(path)) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, ExportAssetFingerprint] =>
        isExportAssetFingerprint(entry[1]),
      ),
    )
  } catch {
    return {}
  }
}

function sameExportAssetFingerprint(
  first: ExportAssetFingerprint | undefined,
  second: ExportAssetFingerprint,
) {
  return (
    first?.sourcePath === second.sourcePath &&
    first.size === second.size &&
    first.mtimeMs === second.mtimeMs
  )
}

export function staleExportAssetFilenames(
  previousFilenames: Iterable<string>,
  nextFilenames: ReadonlySet<string>,
) {
  return [...previousFilenames].filter(
    (filename) => /^slide-\d+\.jpg$/.test(filename) && !nextFilenames.has(filename),
  )
}

async function removeStaleExportAssets(
  assetsDirectory: string,
  previousManifest: ExportAssetManifest,
  nextManifest: ExportAssetManifest,
) {
  const staleFilenames = staleExportAssetFilenames(
    Object.keys(previousManifest),
    new Set(Object.keys(nextManifest)),
  )
  await Promise.all(
    staleFilenames.map(async (filename) => {
      const path = await join(assetsDirectory, filename)
      if (await fileExists(path)) await removeAbsolutePath(path)
    }),
  )
}

function defaultArticleTitle(project: MediaProject) {
  return (
    getActiveArticle(project)?.title.trim() ||
    project.article?.title?.trim() ||
    project.source.name.replace(/\.[^.]+$/, '')
  )
}

function imageFilename(index: number) {
  return `slide-${String(index + 1).padStart(3, '0')}.jpg`
}

function translatedValue(
  original: string,
  translated: string | undefined,
  translation: ArticleTranslation | undefined,
  language: string,
) {
  if (!translation || language === translation.sourceLanguage) return original
  if (language === translation.targetLanguage) return translated ?? ''
  return original
}

function translatedSummary(
  summary: ArticleSummary | undefined,
  translation: ArticleTranslation | undefined,
  language: string,
) {
  if (!translation || language === translation.sourceLanguage) return summary
  return language === translation.targetLanguage ? translation.summary : summary
}

function buildExportDocument(
  project: MediaProject,
  imagePathFor: (sourceImagePath: string, index: number) => string,
): ExportDocument {
  const articleSlides = articleBlockViews(project.slides, project.articleBlocks)
  if (articleSlides.length === 0) {
    throw new Error('書き出すSlideがありません。先にスライド検出を実行してください。')
  }

  const missingImageSlide = articleSlides.find(
    (slide) => effectiveVisualKind(slide) !== 'non-slide' && !slide.image.representativeFramePath,
  )
  if (missingImageSlide) {
    throw new Error(
      `Slide ${missingImageSlide.index + 1}の代表画像がありません。スライド検出をもう一度実行してください。`,
    )
  }

  const source = getActiveMediaSource(project)
  const requestedLanguage = getArticleOutputLanguage(project)
  const translation = getCurrentTranslationForOutputLanguage(project, requestedLanguage)
  const sourceLanguage = getArticleSourceLanguage(project, translation)
  const bilingual = requestedLanguage === 'both' && Boolean(translation)
  const primaryLanguage: ArticleOutputLanguage = bilingual
    ? 'ja'
    : requestedLanguage === 'both'
      ? sourceLanguage === 'en'
        ? 'en'
        : 'ja'
      : requestedLanguage
  const outputLanguage = isArticleOutputLanguageAvailable(project, primaryLanguage, translation)
    ? primaryLanguage
    : sourceLanguage
  const secondaryLanguage = bilingual ? 'en' : undefined
  const currentSummary =
    project.article?.summary && hasCurrentArticleSummary(project, project.article.summary.model)
      ? project.article.summary
      : undefined
  const currentSections =
    project.article?.sections &&
    project.article.sections.sections.length > 0 &&
    (project.article.sections.model === 'manual' ||
      hasCurrentArticleSections(project, project.article.sections.model))
      ? project.article.sections.sections
      : undefined
  const translatedSectionById = new Map(
    (translation?.sections ?? []).map((section) => [section.id, section]),
  )
  const getHeading = (section: ArticleSection, language: string) =>
    translatedValue(
      section.heading,
      translatedSectionById.get(section.id)?.heading,
      translation,
      language,
    )
  const sections = articleSlides.map((slide) => ({
    id: slide.id,
    index: slide.index,
    startMs: slide.startMs,
    endMs: slide.endMs,
    imagePath: slide.image.representativeFramePath
      ? imagePathFor(slide.image.representativeFramePath, slide.index)
      : '',
    sourceImagePath: slide.image.representativeFramePath ?? '',
    ocrText: slide.ocr?.rawText ?? '',
    transcriptRaw: slide.transcript?.raw ?? '',
    body: translatedValue(
      slide.transcript?.articleBody ?? '',
      translation?.bodies[slide.id],
      translation,
      outputLanguage,
    ),
    translations:
      bilingual && secondaryLanguage
        ? [
            {
              language: secondaryLanguage,
              body: translatedValue(
                slide.transcript?.articleBody ?? '',
                translation?.bodies[slide.id],
                translation,
                secondaryLanguage,
              ),
              heading:
                currentSections
                  ?.map((section) =>
                    section.slideIds.includes(slide.id)
                      ? getHeading(section, secondaryLanguage)
                      : undefined,
                  )
                  .find((heading) => heading !== undefined) ?? undefined,
            },
          ]
        : [],
  }))
  const secondarySummary =
    bilingual && translation && secondaryLanguage
      ? translatedSummary(currentSummary, translation, secondaryLanguage)
      : undefined

  return {
    sourceLanguage: outputLanguage,
    sourceName: source.name,
    durationMs: getActiveArticleDuration(project),
    title: translatedValue(
      defaultArticleTitle(project),
      translation?.title,
      translation,
      outputLanguage,
    ),
    summary: translatedSummary(currentSummary, translation, outputLanguage),
    translations:
      bilingual && translation && secondaryLanguage
        ? [
            {
              language: secondaryLanguage,
              title: translatedValue(
                defaultArticleTitle(project),
                translation.title,
                translation,
                secondaryLanguage,
              ),
              ...(secondarySummary ? { summary: secondarySummary } : {}),
            },
          ]
        : [],
    articleSections: currentSections?.map((section) => ({
      ...section,
      heading: getHeading(section, outputLanguage),
    })),
    sections,
  }
}

async function getExportDirectory(projectId: string, articleId?: string) {
  return articleId
    ? join(await appLocalDataDir(), 'projects', projectId, 'articles', articleId, 'exports')
    : join(await appLocalDataDir(), 'projects', projectId, 'exports')
}

export async function exportProject(
  project: MediaProject,
  onProgress?: (progress: ExportProgress) => void,
): Promise<ExportResult> {
  const destination = await getExportDirectory(project.id, project.activeArticleId)
  const document = buildExportDocument(
    project,
    (_sourceImagePath, index) => `./assets/${imageFilename(index)}`,
  )
  const imageSections = document.sections.filter((section) => section.sourceImagePath)
  const total = imageSections.length + EXPORT_OPTIONS.length
  let completed = 0
  const report = (stage: ExportProgress['stage']) => onProgress?.({ stage, completed, total })

  await ensureDirectory(destination)

  const assetsDirectory = await join(destination, 'assets')
  await ensureDirectory(assetsDirectory)
  const assetManifestPath = await join(destination, '.asset-manifest.json')
  const [previousAssetManifest, assets] = await Promise.all([
    readExportAssetManifest(assetManifestPath),
    Promise.all(
      imageSections.map(async (section) => ({
        filename: imageFilename(section.index),
        path: await join(assetsDirectory, imageFilename(section.index)),
      })),
    ),
  ])

  report('copying-images')
  const nextAssetManifest: ExportAssetManifest = {}
  await Promise.all(
    imageSections.map(async (section, sectionIndex) => {
      const filename = assets[sectionIndex].filename
      const destinationPath = assets[sectionIndex].path
      const sourceFingerprint = {
        sourcePath: section.sourceImagePath,
        ...(await getFileFingerprint(section.sourceImagePath)),
      }
      nextAssetManifest[filename] = sourceFingerprint
      if (
        !sameExportAssetFingerprint(previousAssetManifest[filename], sourceFingerprint) ||
        !(await fileExists(destinationPath))
      ) {
        await copyFile(section.sourceImagePath, destinationPath)
      }
      completed += 1
      report('copying-images')
    }),
  )
  await removeStaleExportAssets(assetsDirectory, previousAssetManifest, nextAssetManifest)
  await writeTextFile(assetManifestPath, JSON.stringify(nextAssetManifest))

  report('writing-files')
  const files = await Promise.all(
    EXPORT_OPTIONS.map(async (file) => ({
      format: file.format,
      filename: file.filename,
      path: await join(destination, file.filename),
    })),
  )
  await Promise.all(
    files.map(async (file) => {
      await writeTextFile(file.path, EXPORT_RENDERERS[file.format](document))
      completed += 1
      report('writing-files')
    }),
  )

  const previewDocument = buildExportDocument(project, (sourceImagePath) =>
    convertFileSrc(sourceImagePath),
  )

  return {
    files,
    assets,
    previewHtml: renderHtml(previewDocument),
  }
}

async function copyExportAssets(assets: ExportAsset[], destinationDirectory: string) {
  await ensureDirectory(destinationDirectory)
  await Promise.all(
    assets.map(async (asset) =>
      copyFile(asset.path, await join(destinationDirectory, asset.filename)),
    ),
  )
}

export async function downloadExportFile(file: ExportFile, assets: ExportAsset[]) {
  const destination = await save({
    defaultPath: file.filename,
    title: `${file.filename}を保存`,
  })
  if (!destination) return false

  await copyFile(file.path, destination)
  if (file.format === 'html' || file.format === 'markdown') {
    await copyExportAssets(assets, await join(await dirname(destination), 'assets'))
  }
  return true
}

export async function downloadAllExportFiles(files: ExportFile[], assets: ExportAsset[]) {
  const selected = await open({
    multiple: false,
    directory: true,
    title: '書き出し結果の保存先フォルダを選択',
  })
  if (typeof selected !== 'string') return false

  await Promise.all(
    files.map(async (file) => copyFile(file.path, await join(selected, file.filename))),
  )
  await copyExportAssets(assets, await join(selected, 'assets'))
  return true
}
