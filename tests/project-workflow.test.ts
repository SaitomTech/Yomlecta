import { expect, test } from 'bun:test'
import { createArticleFixture, withArticle, blockViews } from './fixtures/article'
import { createEmptyProject, replaceLoadedArticle } from '../src/lib/project/project'
import {
  articleContext,
  articleMetadata,
  getLoadedArticle,
} from '../src/lib/project/articleSelectors'
import {
  markArticleOpened,
  markArticleExported,
  updateArticleWorkflow,
  updateArticleDraft,
  updateArticleTitle,
  updateArticleSummary,
  updateArticleSourceSettings,
  updateArticleSlideContent,
  updateArticleSlideDetection,
  updateArticleSlideOcr,
  updateArticleTranscription,
  updateArticleSlideResultEdits,
} from '../src/lib/project/article'
import { parseProject, parseLoadedProjectPayload } from '../src/schemas/project'
import { articleExportInputKey } from '../src/features/export/exportInput'
import { normalizeTrimRange } from '../src/lib/project/videoRange'
import { getActiveArticleSourceContext } from '../src/lib/project/articleSource'
import { createArticleFromRange } from '../src/lib/project/projectMedia'
import {
  canNavigateToWorkflowStep,
  getFurthestWorkflowStep,
  isWorkflowStepReached,
  WORKFLOW_STEPS,
} from '../src/lib/workflow'
import {
  articleTranslationInputFingerprint,
  getCurrentArticleTranslation,
  TRANSLATION_LANGUAGES,
  normalizeLanguage,
} from '../src/features/article/translation'
import { hasAllSpeechArticleBodies, articleSlidesWithSpeech } from '../src/features/article/article'
import { PROJECT_VERSION, type ArticleTranslation } from '../src/types/project'

const summary = {
  overview: 'overview',
  mainMessage: 'message',
  keyPoints: ['point'],
  keywords: ['keyword'],
  model: 'article-model',
  inputFingerprint: 'summary-fingerprint',
}

test('workflow keeps reached steps when visiting and continuing from earlier steps', () => {
  const completed = updateArticleWorkflow(createArticleFixture().article, 'export')
  const visited = markArticleOpened(completed, 'generate-notes')
  const continued = updateArticleWorkflow(visited, 'generate-notes')
  expect(visited.workflow.lastVisitedStep).toBe('generate-notes')
  expect(continued.workflow.maxReachedStep).toBe('export')
  expect(isWorkflowStepReached(continued.workflow.maxReachedStep, 'export')).toBe(true)
  expect(getFurthestWorkflowStep('article-review', 'generate-notes')).toBe('article-review')
  expect(canNavigateToWorkflowStep('export', 'generate-notes')).toBe(true)
  expect(canNavigateToWorkflowStep('generate-notes', 'export')).toBe(false)
})

test('export completion records reachability and survives revisiting and reload', () => {
  const context = createArticleFixture()
  const exported = markArticleExported(context.article)
  expect(exported.workflow.lastVisitedStep).toBe('article-review')
  expect(exported.workflow.maxReachedStep).toBe('export')
  expect(exported.workflow.lastExportedAt).toBeDefined()
  const restored = articleContext(
    parseProject(withArticle(context, markArticleOpened(exported, 'generate-notes')).project),
  )
  expect(restored.article.workflow.lastVisitedStep).toBe('generate-notes')
  expect(restored.article.workflow.maxReachedStep).toBe('export')
  expect(restored.article.workflow.lastExportedAt).toBe(exported.workflow.lastExportedAt)
})

test('no-op OCR and body results preserve article reference and completion', () => {
  const context = createArticleFixture()
  const article = markArticleExported(context.article)
  const ocr = article.visualSegments[0].ocr!
  expect(updateArticleSlideOcr(article, 'slide-1', ocr)).toBe(article)
  const block = article.blocks[0].transcript!
  expect(
    updateArticleSlideContent(article, 'slide-1', {
      article: {
        body: block.articleBody!,
        model: block.articleModel!,
        inputFingerprint: block.articleInputFingerprint!,
      },
    }),
  ).toBe(article)
})

test('changed OCR resets processing reachability without copying or clearing block speech', () => {
  const article = markArticleExported(createArticleFixture().article)
  const changed = updateArticleSlideOcr(article, 'slide-1', {
    ...article.visualSegments[0].ocr!,
    rawText: 'new OCR',
  })
  expect(changed.workflow.maxReachedStep).toBe('generate-notes')
  expect(changed.blocks).toBe(article.blocks)
  expect(changed.visualSegments[0].ocr?.rawText).toBe('new OCR')
  expect('transcript' in changed.visualSegments[0]).toBe(false)
})

test('changed generated content updates only the block and advances to review', () => {
  const article = markArticleExported(createArticleFixture().article)
  const changed = updateArticleSlideContent(article, 'slide-1', {
    article: { body: 'new body', model: 'article-model', inputFingerprint: 'new-input' },
  })
  expect(changed.blocks[0].transcript?.articleBody).toBe('new body')
  expect(changed.visualSegments).toBe(article.visualSegments)
  expect(changed.workflow.maxReachedStep).toBe('article-review')
  expect(blockViews(withArticle(createArticleFixture(), changed))[0].transcript?.articleBody).toBe(
    'new body',
  )
})

test('manual body editing preserves completion, sections and summary through reload', () => {
  const context = createArticleFixture()
  const sections = {
    model: 'manual',
    inputFingerprint: 'manual',
    sections: [{ id: 'section', heading: 'Heading', slideIds: ['slide-1'] }],
  }
  const article = { ...markArticleExported(context.article), document: { summary, sections } }
  const changed = updateArticleDraft(article, {
    title: article.title,
    bodies: { 'slide-1': 'edited body' },
  })
  expect(changed.workflow.maxReachedStep).toBe('export')
  expect(changed.blocks[0].transcript?.articleBody).toBe('edited body')
  expect(changed.visualSegments).toBe(article.visualSegments)
  const restored = articleContext(parseProject(withArticle(context, changed).project)).article
  expect(restored.document?.sections).toEqual(sections)
  expect(restored.document?.summary).toEqual(summary)
  expect(restored.blocks[0].transcript?.articleBody).toBe('edited body')
})

test('title has one owner and both metadata and export observe the edited title', () => {
  const context = createArticleFixture()
  const changed = updateArticleTitle(context.article, 'renamed')
  expect(changed.document).toBe(context.article.document)
  expect(changed.title).toBe('renamed')
  expect(updateArticleTitle(changed, 'renamed')).toBe(changed)
  expect(() => updateArticleTitle(changed, ' ')).toThrow()
  const next = withArticle(context, changed)
  expect(articleMetadata(next.project.articles[0]).title).toBe('renamed')
  expect(JSON.parse(articleExportInputKey(next)).title).toBe('renamed')
  expect('title' in changed.document!).toBe(false)
  const withSummary = updateArticleSummary(changed, summary)
  expect(withSummary.title).toBe('renamed')
  expect('title' in withSummary.document!).toBe(false)
})

test('empty draft title keeps the article title and unknown block IDs are rejected', () => {
  const article = createArticleFixture().article
  expect(updateArticleDraft(article, { title: '', bodies: {} })).toBe(article)
  expect(() => updateArticleDraft(article, { title: '', bodies: { missing: 'body' } })).toThrow()
})

test('changing range invalidates only the target article and preserves other metadata', () => {
  const context = createArticleFixture()
  const other = { ...context.article, id: 'other', title: 'Other' }
  const project = {
    ...context.project,
    articles: [
      ...context.project.articles,
      { kind: 'metadata' as const, metadata: articleMetadata({ kind: 'loaded', article: other }) },
    ],
  }
  const changed = updateArticleSourceSettings(
    context.article,
    { startMs: 2000, endMs: 8000 },
    { x: 0, y: 0, width: 1920, height: 1080 },
  )
  const next = replaceLoadedArticle(project, changed)
  expect(changed.visualSegments).toEqual([])
  expect(changed.blocks).toEqual([])
  expect(changed.transcription).toBeUndefined()
  expect(changed.document).toBeUndefined()
  expect(changed.workflow.lastVisitedStep).toBe('detect-slides')
  expect(next.articles[1]).toBe(project.articles[1])
})

test('range normalization clamps invalid edges and rejects invalid durations', () => {
  expect(normalizeTrimRange({ startMs: -1000, endMs: 20000 }, 10000)).toEqual({
    startMs: 0,
    endMs: 10000,
  })
  expect(normalizeTrimRange({ startMs: 9800, endMs: 9900 }, 10000)).toEqual({
    startMs: 9500,
    endMs: 10000,
  })
  expect(() => normalizeTrimRange({ startMs: 0, endMs: 1 }, 0)).toThrow()
})

test('new article references original video and resolves the article-local range and crop', async () => {
  const context = createArticleFixture()
  const video = context.project.videos[0]
  const article = await createArticleFromRange(
    context.project,
    video.id,
    'candidate',
    { startMs: 1000, endMs: 4000 },
    { x: 20, y: 30, width: 1000, height: 600 },
  )
  expect(article.inputMedia.path).toBe(video.media.path)
  expect(article.inputMedia.preparation).toBe('reference')
  expect(article.workflow.lastVisitedStep).toBe('crop')
  const source = getActiveArticleSourceContext({ project: context.project, article })
  expect(source.usesOriginalVideo).toBe(true)
  expect(source.source.path).toBe(video.media.path)
  expect(source.range).toEqual(article.sourceRange)
  expect(source.crop).toEqual(article.crop!)
})

test('transcription assigns speech to blocks and keeps visual segments free of speech', () => {
  const context = createArticleFixture()
  const changed = updateArticleTranscription(context.article, {
    ...context.article.transcription!,
    inputFingerprint: 'changed',
    segments: [{ id: 't1', startMs: 0, endMs: 10000, text: 'new speech' }],
  })
  expect(changed.blocks[0].transcript?.raw).toBe('new speech')
  expect(changed.visualSegments).toBe(context.article.visualSegments)
  expect(changed.workflow.maxReachedStep).toBe('generate-notes')
  expect(updateArticleTranscription(changed, changed.transcription!)).toBe(changed)
})

test('slide detection rebuilds blocks and restores transcription assignment', () => {
  const context = createArticleFixture()
  const article = {
    ...context.article,
    transcription: {
      ...context.article.transcription!,
      segments: [{ id: 't', startMs: 0, endMs: 10000, text: 'speech' }],
    },
  }
  const changed = updateArticleSlideDetection(article, article.slideDetection!, [
    { ...article.visualSegments[0], endMs: 9000 },
  ])
  expect(changed.blocks[0].transcript?.raw).toBe('speech')
  expect(changed.blocks[0].endMs).toBe(9000)
  expect('transcript' in changed.visualSegments[0]).toBe(false)
})

test('manual result edits update OCR on the image segment and speech on the block', () => {
  const article = createArticleFixture().article
  const changed = updateArticleSlideResultEdits(article, 'slide-1', {
    ocrText: 'edited OCR',
    transcriptRaw: 'edited speech',
    articleBody: 'edited body',
  })
  expect(changed.visualSegments[0].ocr?.rawText).toBe('edited OCR')
  expect(changed.blocks[0].transcript?.raw).toBe('edited speech')
  expect(changed.blocks[0].transcript?.articleBody).toBe('edited body')
})

test('empty projects and metadata-only articles require no placeholder editor state', () => {
  const empty = parseProject(createEmptyProject('Empty'))
  expect(getLoadedArticle(empty)).toBeNull()
  expect('source' in empty).toBe(false)
  expect('workflow' in empty).toBe(false)
  const context = createArticleFixture()
  const metadata = articleMetadata(context.project.articles[0])
  const project = parseProject({ ...context.project, articles: [{ kind: 'metadata', metadata }] })
  expect(getLoadedArticle(project)).toBeNull()
  expect('visualSegments' in metadata).toBe(false)
})

test('project parser rejects stale versions, unknown fields, duplicate and invalid entries', () => {
  const context = createArticleFixture()
  expect(parseProject(context.project).version).toBe(PROJECT_VERSION)
  expect(() => parseProject({ ...context.project, version: PROJECT_VERSION - 1 })).toThrow()
  expect(() => parseProject({ ...context.project, source: {} })).toThrow()
  expect(() =>
    parseProject({
      ...context.project,
      articles: [context.project.articles[0], context.project.articles[0]],
    }),
  ).toThrow()
  expect(() =>
    parseProject({
      ...context.project,
      articles: [
        {
          kind: 'loaded',
          article: { ...context.article, sourceRange: { startMs: 5000, endMs: 5000 } },
        },
      ],
    }),
  ).toThrow()
  expect(() => parseProject({ ...context.project, lastOpenedArticleId: 'missing' })).toThrow()
  expect(() =>
    parseProject({
      ...context.project,
      articles: [{ kind: 'loaded', article: { ...context.article, sourceVideoId: 'missing' } }],
    }),
  ).toThrow()
})

test('active article is the stored detail reference, and switching demotes old detail', () => {
  const context = createArticleFixture()
  expect(getLoadedArticle(context.project)).toBe(context.article)
  const other = { ...context.article, id: 'other' }
  const project = {
    ...context.project,
    articles: [
      ...context.project.articles,
      { kind: 'metadata' as const, metadata: articleMetadata({ kind: 'loaded', article: other }) },
    ],
  }
  const next = replaceLoadedArticle(project, other)
  expect(next.articles[0].kind).toBe('metadata')
  expect(getLoadedArticle(next)).toBe(other)
  expect(next.articles.filter((entry) => entry.kind === 'loaded')).toHaveLength(1)
})

test('article translation supports Japanese and English only', () => {
  expect(TRANSLATION_LANGUAGES.map((language) => language.id)).toEqual(['ja', 'en'])
  expect(normalizeLanguage('ja-JP')).toBe('ja')
  expect(normalizeLanguage('en-US')).toBe('en')
  expect(normalizeLanguage('fr')).toBeUndefined()
})

test('silent blocks do not require generated article bodies', () => {
  const context = createArticleFixture()
  const silent = {
    ...context.article.blocks[0],
    id: 'silent',
    index: 1,
    transcript: { raw: '', model: 'test' },
  }
  const next = withArticle(context, {
    ...context.article,
    blocks: [...context.article.blocks, silent],
  })
  expect(articleSlidesWithSpeech(next)).toHaveLength(1)
  expect(hasAllSpeechArticleBodies(next)).toBe(true)
})

test('translation becomes stale when the canonical block body changes', () => {
  const context = createArticleFixture()
  const translation: ArticleTranslation = {
    sourceLanguage: 'ja',
    targetLanguage: 'en',
    engine: 'apple-translation',
    model: 'Apple Translation',
    inputFingerprint: articleTranslationInputFingerprint(context, 'ja', 'en'),
    generatedAt: context.article.updatedAt,
    title: 'Article',
    bodies: { 'slide-1': 'Body' },
  }
  const translated = withArticle(context, {
    ...context.article,
    document: { translations: { en: translation } },
  })
  expect(getCurrentArticleTranslation(translated, 'en', 'ja')).toBe(translation)
  const changed = withArticle(
    translated,
    updateArticleDraft(translated.article, {
      title: translated.article.title,
      bodies: { 'slide-1': 'changed body' },
    }),
  )
  expect(getCurrentArticleTranslation(changed, 'en', 'ja')).toBeUndefined()
})

test('workflow has four editable steps and preserves the legacy completion marker', () => {
  expect(WORKFLOW_STEPS).toHaveLength(4)
  expect(canNavigateToWorkflowStep('export', 'article-review')).toBe(true)
})

test('export input changes with body regeneration and title, but not workflow bookkeeping', () => {
  const context = createArticleFixture()
  const original = articleExportInputKey(context)
  expect(articleExportInputKey(withArticle(context, markArticleExported(context.article)))).toBe(
    original,
  )
  expect(
    articleExportInputKey(withArticle(context, updateArticleTitle(context.article, 'new'))),
  ).not.toBe(original)
  expect(
    articleExportInputKey(
      withArticle(
        context,
        updateArticleDraft(context.article, {
          title: context.article.title,
          bodies: { 'slide-1': 'new' },
        }),
      ),
    ),
  ).not.toBe(original)
})

test('load payload rejects mismatched detail and malformed revisions before acceptance', () => {
  const context = createArticleFixture()
  const payload = {
    project: context.project,
    loadedArticleId: context.article.id,
    revisions: {
      revision: 2,
      articleRevisions: { [context.article.id]: 3 },
      documentRevisions: { [context.article.id]: 0 },
      slideRevisions: { [context.article.visualSegments[0].id]: 0 },
      ocrRevisions: {},
    },
  }
  expect(
    parseLoadedProjectPayload(payload, context.project.id, context.article.id).loadedArticleId,
  ).toBe(context.article.id)
  expect(() => parseLoadedProjectPayload(payload, 'wrong')).toThrow()
  expect(() =>
    parseLoadedProjectPayload(
      { ...payload, revisions: { ...payload.revisions, documentRevisions: {} } },
      context.project.id,
    ),
  ).toThrow()
  expect(() => parseLoadedProjectPayload(payload, context.project.id, 'wrong')).toThrow()
  expect(() =>
    parseLoadedProjectPayload({ ...payload, loadedArticleId: null }, context.project.id),
  ).toThrow()
  expect(() =>
    parseLoadedProjectPayload(
      { ...payload, revisions: { ...payload.revisions, revision: -1 } },
      context.project.id,
    ),
  ).toThrow()
  expect(() =>
    parseLoadedProjectPayload({ ...payload, revisions: undefined }, context.project.id),
  ).toThrow()
})

test('prepared article source edits normalize against original video dimensions and duration', () => {
  const context = createArticleFixture()
  const original = context.project.videos[0].media.metadata
  const prepared = {
    ...context.article,
    inputMedia: {
      ...context.article.inputMedia,
      preparation: 'prepared' as const,
      metadata: { ...original, durationMs: 2000, width: 640, height: 360 },
    },
  }
  const changed = updateArticleSourceSettings(
    prepared,
    { startMs: 3000, endMs: 7000 },
    { x: 500, y: 200, width: 1000, height: 600 },
    undefined,
    { sourceMetadata: original },
  )
  expect(changed.sourceRange).toEqual({ startMs: 3000, endMs: 7000 })
  expect(changed.crop).toEqual({ x: 500, y: 200, width: 1000, height: 600 })
})
