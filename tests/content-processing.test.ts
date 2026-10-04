import { expect, test } from 'bun:test'
import {
  createEmptyProject,
  updateProjectSlideContent,
  syncActiveArticle,
} from '../src/lib/project/project'
import { articleInputFingerprint } from '../src/features/article/article'
import { runContentProcessing } from '../src/features/content-processing/contentProcessing'
import type { ArticleGenerator } from '../src/features/content-processing/articleGenerator'
import {
  parseBoundaryResponse,
  userPromptFor,
} from '../src/features/content-processing/articleGenerator'
import { assignedArticleSlides, createBoundaryPlan } from '../src/lib/pipeline/transcriptBoundaries'
import { parseMediaProject } from '../src/schemas/project'
import type { Article, MediaProject } from '../src/types/project'

function decision(text = '') {
  return {
    move: text ? ('left_to_right' as const) : ('keep' as const),
    text,
    reason: 'test judgment',
  }
}

function workspace() {
  const project = createEmptyProject('test')
  project.slides = ['Overview. Next, the method is', 'recording temperature.'].map(
    (raw, index) => ({
      id: `s-${index}`,
      index,
      startMs: index * 1000,
      endMs: (index + 1) * 1000,
      autoKind: 'slide',
      personLayout: 'none',
      detection: { source: 'auto' },
      image: {},
      transcript: { raw, model: 'transcriber' },
    }),
  )
  project.articleBlocks = project.slides.map((slide) => ({
    id: slide.id,
    index: slide.index,
    visualSegmentIds: [slide.id],
    imageSegmentId: slide.id,
    startMs: slide.startMs,
    endMs: slide.endMs,
    transcript: slide.transcript,
  }))
  project.article = { title: 'test' }
  return project
}
function fakeGenerator(events: string[], cut?: number): ArticleGenerator {
  return {
    failureMessage: 'test',
    maxConcurrentRequests: 2,
    run: async ({ work }) => {
      await work(
        async (slide) => {
          events.push(`generate:${slide.id}:${slide.transcript?.raw}`)
          return {
            article: {
              body: slide.transcript!.raw,
              model: 'openai:gpt-6-luna',
              inputFingerprint: articleInputFingerprint(slide, 'openai:gpt-6-luna'),
            },
          }
        },
        async (prompt) => {
          const input = JSON.parse(prompt)
          events.push('boundary')
          return decision(cut === undefined ? '' : input.leftTranscript.slice(cut))
        },
      )
    },
  }
}

test('境界計画の保存が完了した後に担当発話だけを生成し、元の発話を保持する', async () => {
  let project = workspace()
  const originals = project.slides.map((slide) => slide.transcript!.raw)
  const events: string[] = []
  const cut = createBoundaryPlan(project.slides).sourceText.indexOf('Next,')
  await runContentProcessing(
    {
      project,
      modelId: 'openai:gpt-6-luna',
      onBoundaryPlanCompleted: async (plan) => {
        await Promise.resolve()
        project.article!.boundaryPlan = plan
        events.push('saved-plan')
      },
      onSlideCompleted: async (results) => {
        for (const { slideId, result } of results)
          project = updateProjectSlideContent(project, slideId, result)
      },
    },
    fakeGenerator(events, cut),
  )
  expect(events[0]).toBe('boundary')
  expect(events[1]).toBe('saved-plan')
  expect(events[2]).toBe('generate:s-0:Overview.')
  expect(events[3]).toBe('generate:s-1:Next, the method is\n\nrecording temperature.')
  expect(project.slides.map((slide) => slide.transcript!.raw)).toEqual(originals)
  expect(assignedArticleSlides(project)[1]!.transcript!.articleBody).toContain('Next,')
  const rerun: string[] = []
  await runContentProcessing(
    {
      project,
      modelId: 'openai:gpt-6-luna',
      onBoundaryPlanCompleted: async () => {
        throw new Error('must not save')
      },
      onSlideCompleted: async () => {
        throw new Error('must not generate')
      },
    },
    fakeGenerator(rerun),
  )
  expect(rerun).toEqual([])
})

test('計画の保存失敗では本文生成を開始しない', async () => {
  const project = workspace()
  const events: string[] = []
  let failure: unknown
  try {
    await runContentProcessing(
      {
        project,
        modelId: 'openai:gpt-6-luna',
        onBoundaryPlanCompleted: async () => {
          throw new Error('disk')
        },
        onSlideCompleted: async () => {
          throw new Error('must not save')
        },
      },
      fakeGenerator(events),
    )
  } catch (error) {
    failure = error
  }
  expect(failure).toBeDefined()
  expect(events).toEqual(['boundary'])
})

test('担当発話が空になったブロックはモデルを呼ばずに空本文を保存する', async () => {
  let project = workspace()
  const events: string[] = []
  await runContentProcessing(
    {
      project,
      modelId: 'openai:gpt-6-luna',
      onBoundaryPlanCompleted: async (plan) => {
        project.article!.boundaryPlan = plan
      },
      onSlideCompleted: async (results) => {
        for (const { slideId, result } of results)
          project = updateProjectSlideContent(project, slideId, result)
      },
    },
    fakeGenerator(events, 0),
  )
  expect(events.filter((event) => event.startsWith('generate:'))).toHaveLength(1)
  expect(project.slides[0]!.transcript!.articleBody).toBe('')
})

test('保存スキーマで境界計画が往復し、旧記事では計画が不要', () => {
  const project = workspace()
  project.article!.boundaryPlan = createBoundaryPlan(project.slides)
  const article: Article = {
    id: 'article-test',
    title: 'test',
    inputMedia: {
      path: '/tmp/lecture.mp4',
      name: 'lecture.mp4',
      extension: 'mp4',
      metadata: { path: '/tmp/lecture.mp4', durationMs: 2000, width: 1920, height: 1080 },
      origin: { kind: 'local-file' },
      ownership: 'managed',
      managedRelativePath: 'articles/article-test/input/original.mp4',
    },
    sourceRange: { startMs: 0, endMs: 2000 },
    settings: project.settings,
    slides: project.slides,
    articleBlocks: project.articleBlocks,
    article: project.article,
    workflow: project.workflow,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
  project.articles = [article]
  project.activeArticleId = article.id
  const snapshot = (value: MediaProject) => ({
    version: value.version,
    id: value.id,
    title: value.title,
    videos: value.videos,
    articles: syncActiveArticle(value).articles,
    activeArticleId: value.activeArticleId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  })
  expect(parseMediaProject(snapshot(project)).article?.boundaryPlan).toEqual(
    project.article!.boundaryPlan,
  )
  delete project.article!.boundaryPlan
  expect(parseMediaProject(snapshot(project)).article?.boundaryPlan).toBeUndefined()
})

test('境界応答は移動方向と原文を必須にし、本文入力には前後資料を含めない', () => {
  expect(parseBoundaryResponse('```json\n' + JSON.stringify(decision('Next,')) + '\n```')).toEqual(
    decision('Next,'),
  )
  expect(() => parseBoundaryResponse('{"body":"rewritten"}')).toThrow()
  expect(() => parseBoundaryResponse('{"candidateId":"C10"}')).toThrow()
  const prompt = userPromptFor(workspace().slides[0]!, 'en')
  expect(prompt).toContain('<RAW TRANSCRIPT>')
  expect(prompt).not.toContain('PREVIOUS')
  expect(prompt).not.toContain('NEXT')
})
