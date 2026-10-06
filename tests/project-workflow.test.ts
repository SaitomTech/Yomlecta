import { expect, test } from 'bun:test'
import { parseMediaProject } from '../src/schemas/project'
import {
  createEmptyProject,
  markProjectOpened,
  markProjectExported,
  syncActiveArticle,
  updateProjectArticleDraft,
  updateProjectArticleTitle,
  updateProjectArticleSummary,
  updateProjectArticleSourceSettings,
  updateProjectSlideContent,
  updateProjectSlideDetection,
  updateProjectSlideOcr,
  updateProjectTranscription,
  updateProjectWorkflow,
} from '../src/lib/project/project'
import { normalizeTrimRange } from '../src/lib/project/videoRange'
import { getActiveArticleSourceContext } from '../src/lib/project/articleSource'
import { createArticleFromRange } from '../src/lib/project/projectMedia'
import {
  canNavigateToWorkflowStep,
  getFurthestWorkflowStep,
  isWorkflowStepReached,
} from '../src/lib/workflow'
import type { Article, MediaProject, ProjectVideo, SlideData } from '../src/types/project'
import { PROJECT_VERSION } from '../src/types/project'
import {
  TRANSLATION_LANGUAGES,
  articleTranslationInputFingerprint,
  getCurrentArticleTranslation,
  normalizeLanguage,
} from '../src/features/article/translation'
import { articleGenerationLanguageInstruction } from '../src/features/article/articleLanguage'
import { articleSlidesWithSpeech, hasAllSpeechArticleBodies } from '../src/features/article/article'

const NOW = '2026-09-15T00:00:00.000Z'

function projectSnapshot(project: MediaProject) {
  return {
    version: PROJECT_VERSION,
    id: project.id,
    title: project.title,
    videos: project.videos,
    articles: project.articles,
    ...(project.activeArticleId ? { activeArticleId: project.activeArticleId } : {}),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

function createArticleWorkspace() {
  const base = createEmptyProject('workflow')
  const videoId = 'video-1'
  const articleId = 'article-1'
  const sourcePath = '/tmp/lecture.mp4'
  const videoMedia = {
    path: sourcePath,
    name: 'lecture.mp4',
    extension: 'mp4' as const,
    metadata: { path: sourcePath, durationMs: 10_000, width: 1_920, height: 1_080 },
    origin: { kind: 'local-file' as const },
    ownership: 'managed' as const,
    managedRelativePath: `videos/${videoId}/original.mp4`,
    thumbnailPath: '/tmp/lecture.jpg',
  }
  const video: ProjectVideo = {
    id: videoId,
    title: 'lecture',
    media: videoMedia,
    createdAt: NOW,
    updatedAt: NOW,
  }
  const inputMedia = {
    ...videoMedia,
    managedRelativePath: `articles/${articleId}/input/original.mp4`,
    preparedFromVideoId: videoId,
    preparation: 'copy' as const,
    preparedAt: NOW,
  }
  const slide: SlideData = {
    id: 'slide-1',
    index: 0,
    startMs: 0,
    endMs: 10_000,
    autoKind: 'slide',
    personLayout: 'none',
    detection: { source: 'auto' },
    image: { representativeFramePath: '/tmp/slide.jpg' },
    ocr: { rawText: 'OCR', model: 'ocr-model', inputFingerprint: 'ocr-fingerprint' },
    transcript: {
      raw: 'transcript',
      model: 'transcription-model',
      articleBody: 'body',
      articleModel: 'article-model',
      articleInputFingerprint: 'article-fingerprint',
    },
  }
  const article: Article = {
    id: articleId,
    title: 'article',
    sourceVideoId: videoId,
    inputMedia,
    sourceRange: { startMs: 0, endMs: 10_000 },
    settings: base.settings,
    slides: [slide],
    articleBlocks: [
      {
        id: slide.id,
        index: 0,
        visualSegmentIds: [slide.id],
        imageSegmentId: slide.id,
        startMs: slide.startMs,
        endMs: slide.endMs,
        transcript: slide.transcript,
      },
    ],
    slideDetection: {
      sampleIntervalMs: 500,
      threshold: 12,
      framesAnalyzed: 20,
      boundaries: [],
      detectedAt: NOW,
    },
    transcription: {
      model: 'transcription-model',
      provider: 'local',
      audioPath: '/tmp/audio.wav',
      segments: [],
      transcribedAt: NOW,
      inputFingerprint: 'transcription-fingerprint',
    },
    article: { title: 'article' },
    workflow: {
      lastVisitedStep: 'article-review',
      maxReachedStep: 'article-review',
      lastOpenedAt: NOW,
    },
    createdAt: NOW,
    updatedAt: NOW,
  }
  return {
    ...base,
    videos: [video],
    articles: [article],
    activeArticleId: articleId,
    source: inputMedia,
    slides: [slide],
    articleBlocks: article.articleBlocks,
    slideDetection: article.slideDetection,
    transcription: article.transcription,
    article: article.article,
    workflow: article.workflow,
  }
}

test('workflow keeps a previously reached step available after navigating back', () => {
  const initial = createEmptyProject('workflow')
  const completed = updateProjectWorkflow(initial, 'export')
  const revisited = markProjectOpened(completed, 'generate-notes')

  expect(revisited.workflow.lastVisitedStep).toBe('generate-notes')
  expect(revisited.workflow.maxReachedStep).toBe('export')
  expect(isWorkflowStepReached(revisited.workflow.maxReachedStep, 'export')).toBe(true)
})

test('workflow progress never moves backwards when continuing from an earlier step', () => {
  const completed = updateProjectWorkflow(createEmptyProject('workflow'), 'export')
  const continued = updateProjectWorkflow(completed, 'generate-notes')

  expect(continued.workflow.lastVisitedStep).toBe('generate-notes')
  expect(continued.workflow.maxReachedStep).toBe('export')
  expect(getFurthestWorkflowStep('article-review', 'generate-notes')).toBe('article-review')
  expect(canNavigateToWorkflowStep('export', 'generate-notes')).toBe(true)
  expect(canNavigateToWorkflowStep('generate-notes', 'export')).toBe(false)
})

test('export completion records reachability separately from the last visited step', () => {
  const exported = markProjectExported(createArticleWorkspace())
  const revisited = markProjectOpened(exported, 'generate-notes')

  expect(exported.workflow.maxReachedStep).toBe('export')
  expect(exported.workflow.lastVisitedStep).toBe('export')
  expect(exported.workflow.lastExportedAt).toBeTruthy()
  expect(revisited.workflow.maxReachedStep).toBe('export')
  expect(revisited.workflow.lastVisitedStep).toBe('generate-notes')
})

test('persisted workflow restores both the last visited and furthest reached steps', () => {
  const exported = markProjectExported(createArticleWorkspace())
  const revisited = markProjectOpened(exported, 'generate-notes')
  const restored = parseMediaProject(projectSnapshot(syncActiveArticle(revisited)))

  expect(restored.workflow.lastVisitedStep).toBe('generate-notes')
  expect(restored.workflow.maxReachedStep).toBe('export')
})

test('same OCR output is a no-op, while changed OCR preserves generated notes', () => {
  const exported = markProjectExported(createArticleWorkspace())
  const savedOcr = exported.slides[0].ocr
  if (!savedOcr) throw new Error('テスト用OCRがありません。')

  const same = updateProjectSlideOcr(exported, 'slide-1', savedOcr)
  expect(same).toBe(exported)
  expect(same.slides[0].transcript?.articleBody).toBe('body')

  const changed = updateProjectSlideOcr(exported, 'slide-1', {
    ...savedOcr,
    rawText: 'changed OCR',
  })
  expect(changed.workflow.maxReachedStep).toBe('generate-notes')
  expect(changed.workflow.lastVisitedStep).toBe('generate-notes')
  expect(changed.slides[0].transcript?.articleBody).toBe('body')
  expect(canNavigateToWorkflowStep(changed.workflow.maxReachedStep, 'article-review')).toBe(false)
  expect(canNavigateToWorkflowStep(changed.workflow.maxReachedStep, 'export')).toBe(false)
})

test('changed transcription preserves generated notes', () => {
  const exported = markProjectExported(createArticleWorkspace())
  const transcription = exported.transcription
  if (!transcription) throw new Error('テスト用文字起こし結果がありません。')

  const same = updateProjectTranscription(exported, transcription)
  expect(same).toBe(exported)

  const changed = updateProjectTranscription(exported, {
    ...transcription,
    inputFingerprint: 'transcription-fingerprint-v2',
  })
  expect(changed.slides[0].transcript?.articleBody).toBe('body')
  expect(changed.workflow.maxReachedStep).toBe('generate-notes')
  expect(changed.workflow.lastVisitedStep).toBe('generate-notes')
  expect(canNavigateToWorkflowStep(changed.workflow.maxReachedStep, 'export')).toBe(false)
})

test('unchanged article drafts do not invalidate the export, but edits do', () => {
  const exported = markProjectExported(createArticleWorkspace())
  const same = updateProjectArticleDraft(exported, {
    title: 'article',
    bodies: { 'slide-1': 'body' },
  })
  expect(same).toBe(exported)

  const changed = updateProjectArticleDraft(exported, {
    title: 'article',
    bodies: { 'slide-1': 'edited body' },
  })
  expect(changed.workflow.maxReachedStep).toBe('export')
  expect(changed.workflow.lastVisitedStep).toBe('article-review')
  expect(changed.slides[0].transcript?.articleBody).toBe('edited body')
})

test('workflow article title is kept as the generated article title', () => {
  const project = createArticleWorkspace()
  const activeArticle = project.articles[0]
  if (!activeArticle) throw new Error('テスト用記事がありません。')
  const withDifferentGeneratedTitle = {
    ...project,
    article: { title: 'generated title' },
    articles: [
      {
        ...activeArticle,
        title: 'workflow title',
        article: { title: 'generated title' },
      },
    ],
  }

  const draft = updateProjectArticleDraft(withDifferentGeneratedTitle, {
    title: '',
    bodies: { 'slide-1': 'body' },
  })
  expect(draft.article?.title).toBe('workflow title')
  expect(draft.articles[0]?.title).toBe('workflow title')

  const summary = updateProjectArticleSummary(withDifferentGeneratedTitle, {
    overview: 'overview',
    mainMessage: 'message',
    keyPoints: ['point'],
    keywords: ['keyword'],
    model: 'article-model',
    inputFingerprint: 'summary-fingerprint',
  })
  expect(summary.article?.title).toBe('workflow title')
  expect(syncActiveArticle(withDifferentGeneratedTitle).articles[0]?.title).toBe('workflow title')
})

test('article title updates the workflow title and generated title together', () => {
  const project = createArticleWorkspace()
  const renamed = updateProjectArticleTitle(project, 'renamed article')

  expect(renamed.articles[0]?.title).toBe('renamed article')
  expect(renamed.article?.title).toBe('renamed article')
  expect(renamed.workflow).toEqual(project.workflow)
})

test('changed slide detection invalidates downstream steps', () => {
  const exported = markProjectExported(createArticleWorkspace())
  const detection = exported.slideDetection
  if (!detection) throw new Error('テスト用スライド検出結果がありません。')

  const changed = updateProjectSlideDetection(
    exported,
    { ...detection, threshold: detection.threshold + 1 },
    exported.slides,
  )
  expect(changed.workflow.maxReachedStep).toBe('generate-notes')
  expect(changed.workflow.lastVisitedStep).toBe('detect-slides')
})

test('changed article generation invalidates the result step', () => {
  const exported = markProjectExported(createArticleWorkspace())
  const changed = updateProjectSlideContent(exported, 'slide-1', {
    article: {
      body: 'regenerated body',
      model: 'article-model-v2',
      inputFingerprint: 'article-fingerprint-v2',
    },
  })

  expect(changed.workflow.maxReachedStep).toBe('article-review')
  expect(changed.workflow.lastVisitedStep).toBe('generate-notes')
  expect(changed.slides[0].transcript?.articleBody).toBe('regenerated body')
  expect(canNavigateToWorkflowStep(changed.workflow.maxReachedStep, 'article-review')).toBe(true)
  expect(canNavigateToWorkflowStep(changed.workflow.maxReachedStep, 'export')).toBe(false)
})

test('range normalization clamps invalid edges and preserves a near-full selection', () => {
  expect(normalizeTrimRange({ startMs: -1_000, endMs: 20_000 }, 10_000)).toEqual({
    startMs: 0,
    endMs: 10_000,
  })
  expect(normalizeTrimRange({ startMs: 9_800, endMs: 9_900 }, 10_000)).toEqual({
    startMs: 9_500,
    endMs: 10_000,
  })
  expect(() => normalizeTrimRange({ startMs: 0, endMs: 1 }, 0)).toThrow()
})

test('new article candidates reference the original project video without creating a copy', async () => {
  const project = createArticleWorkspace()
  const video = project.videos[0]
  if (!video) throw new Error('テスト用動画がありません。')
  const article = await createArticleFromRange(
    project,
    video.id,
    'candidate',
    { startMs: 1_000, endMs: 4_000 },
    { x: 20, y: 30, width: 1_000, height: 600 },
  )

  expect(article.inputMedia.path).toBe(video.media.path)
  expect(article.inputMedia.preparation).toBe('reference')
  expect(article.sourceRange).toEqual({ startMs: 1_000, endMs: 4_000 })
  expect(article.workflow.lastVisitedStep).toBe('crop')
  const next = {
    ...project,
    articles: [article],
    activeArticleId: article.id,
    source: article.inputMedia,
    sourceRange: article.sourceRange,
    crop: article.crop,
    workflow: article.workflow,
    settings: article.settings,
    slides: article.slides,
  }
  const context = getActiveArticleSourceContext(next)
  expect(context.usesOriginalVideo).toBe(true)
  expect(context.source.path).toBe(video.media.path)
  expect(context.range).toEqual(article.sourceRange)
})

test('changing one article range invalidates only that article outputs', () => {
  const project = createArticleWorkspace()
  const article = project.articles[0]
  if (!article) throw new Error('テスト用記事がありません。')
  const changed = updateProjectArticleSourceSettings(
    project,
    { startMs: 2_000, endMs: 8_000 },
    { x: 0, y: 0, width: 1_920, height: 1_080 },
  )
  expect(changed.articles).toHaveLength(1)
  expect(changed.articles[0]?.sourceRange).toEqual({ startMs: 2_000, endMs: 8_000 })
  expect(changed.articles[0]?.slides).toEqual([])
  expect(changed.articles[0]?.slideDetection).toBeUndefined()
  expect(changed.articles[0]?.workflow.lastVisitedStep).toBe('detect-slides')
})

test('project parser accepts the current persisted shape and rejects stale or unknown data', () => {
  const workspace = createArticleWorkspace()
  const persisted = projectSnapshot(workspace)
  expect(parseMediaProject(persisted).version).toBe(PROJECT_VERSION)
  expect(() => parseMediaProject({ ...persisted, version: PROJECT_VERSION - 1 })).toThrow()
  expect(() => parseMediaProject({ ...persisted, unexpected: true })).toThrow()
  expect(() =>
    parseMediaProject({
      ...persisted,
      videos: [
        {
          ...persisted.videos[0],
          media: { ...persisted.videos[0].media, unexpected: true },
        },
      ],
    }),
  ).toThrow()
  expect(() =>
    parseMediaProject({
      ...persisted,
      articles: [
        {
          ...persisted.articles[0],
          sourceRange: { startMs: 5_000, endMs: 5_000 },
        },
      ],
    }),
  ).toThrow()
})

test('article translation is limited to Japanese and English', () => {
  expect(TRANSLATION_LANGUAGES.map((language) => language.id)).toEqual(['ja', 'en'])
  expect(normalizeLanguage('ja-JP')).toBe('ja')
  expect(normalizeLanguage('en-US')).toBe('en')
  expect(normalizeLanguage('english')).toBe('en')
  expect(normalizeLanguage('japanese')).toBe('ja')
  expect(normalizeLanguage('fr-FR')).toBeUndefined()
  expect(articleGenerationLanguageInstruction('english')).toContain('必ず英語')
  expect(articleGenerationLanguageInstruction('english')).toContain('日本語へ翻訳しない')
})

test('silent visual segments do not require generated article bodies', () => {
  const project = createArticleWorkspace()
  const sourceSlide = project.slides[0]
  const silentSlide: SlideData = {
    ...sourceSlide,
    id: 'slide-silent',
    index: 1,
    startMs: sourceSlide.endMs,
    endMs: sourceSlide.endMs + 5_000,
    transcript: { raw: '', model: sourceSlide.transcript?.model ?? 'test' },
  }
  const withSilence: MediaProject = {
    ...project,
    slides: [sourceSlide, silentSlide],
    articleBlocks: [
      {
        id: sourceSlide.id,
        index: 0,
        visualSegmentIds: [sourceSlide.id],
        imageSegmentId: sourceSlide.id,
        startMs: sourceSlide.startMs,
        endMs: sourceSlide.endMs,
        transcript: sourceSlide.transcript,
      },
      {
        id: silentSlide.id,
        index: 1,
        visualSegmentIds: [silentSlide.id],
        imageSegmentId: silentSlide.id,
        startMs: silentSlide.startMs,
        endMs: silentSlide.endMs,
        transcript: silentSlide.transcript,
      },
    ],
  }

  expect(articleSlidesWithSpeech(withSilence).map((slide) => slide.id)).toEqual([sourceSlide.id])
  expect(hasAllSpeechArticleBodies(withSilence)).toBe(true)
})

test('article translation becomes stale when its source body changes', () => {
  const project = createArticleWorkspace()
  const inputFingerprint = articleTranslationInputFingerprint(project, 'ja', 'en')
  const translated: MediaProject = {
    ...project,
    article: {
      ...project.article,
      title: project.article?.title ?? 'article',
      translations: {
        en: {
          sourceLanguage: 'ja',
          targetLanguage: 'en',
          engine: 'apple-translation' as const,
          model: 'Apple Translation',
          inputFingerprint,
          generatedAt: NOW,
          title: 'Article',
          bodies: { 'slide-1': 'Body' },
        },
      },
    },
  }

  expect(getCurrentArticleTranslation(translated, 'en', 'ja')?.title).toBe('Article')

  const changed = {
    ...translated,
    slides: translated.slides.map((slide) => ({
      ...slide,
      transcript: slide.transcript
        ? { ...slide.transcript, articleBody: 'changed body' }
        : undefined,
    })),
  }
  expect(getCurrentArticleTranslation(changed, 'en', 'ja')).toBeUndefined()
})

test('body edits preserve independently generated sections and summary after reload', () => {
  const project = createArticleWorkspace()
  project.article = {
    ...project.article,
    title: 'article',
    summary: {
      overview: 'Saved overview',
      mainMessage: 'Saved message',
      keyPoints: ['Saved point'],
      keywords: ['Saved keyword'],
      model: 'article-model',
      inputFingerprint: 'original-body',
    },
    sections: {
      model: 'article-model',
      inputFingerprint: 'original-body',
      sections: [{ id: 'section-1', heading: 'Saved heading', slideIds: ['slide-1'] }],
    },
  }
  const changed = updateProjectArticleDraft(project, {
    title: 'article',
    bodies: { 'slide-1': 'Edited body' },
  })
  const restored = parseMediaProject(projectSnapshot(syncActiveArticle(changed)))
  expect(restored.article?.summary).toEqual(project.article.summary)
  expect(restored.article?.sections).toEqual(project.article.sections)
  expect(restored.slides[0].transcript?.articleBody).toBe('Edited body')
  expect(articleTranslationInputFingerprint(restored, 'ja', 'en')).toContain('Saved heading')
  expect(articleTranslationInputFingerprint(restored, 'ja', 'en')).toContain('Saved overview')
})
