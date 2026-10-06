import { expect, test } from 'bun:test'
import { createArticleFixture, editArticle, withArticle, blockViews } from './fixtures/article'
import { updateArticleSlideContent } from '../src/lib/project/article'
import { articleContext } from '../src/lib/project/articleSelectors'
const editContent = editArticle(updateArticleSlideContent)

import {
  articleInputFingerprint,
  articleSectionsInputFingerprint,
} from '../src/features/article/article'
import {
  runArticleContentProcessing,
  type ArticleContentProcessingStage,
} from '../src/features/content-processing/articleContentProcessing'
import { runContentProcessing } from '../src/features/content-processing/contentProcessing'
import type { ArticleGenerator } from '../src/features/content-processing/articleGenerator'
import {
  parseBoundaryResponse,
  userPromptFor,
} from '../src/features/content-processing/articleGenerator'
import { assignedArticleSlides, createBoundaryPlan } from '../src/lib/pipeline/transcriptBoundaries'
import { parseProject } from '../src/schemas/project'
import type { ArticleContext } from '../src/types/project'

function decision(text = '') {
  return {
    move: text ? ('left_to_right' as const) : ('keep' as const),
    text,
    reason: 'test judgment',
  }
}

function workspace() {
  const context = createArticleFixture()
  const visualSegments = ['Overview. Next, the method is', 'recording temperature.'].map(
    (_raw, index) => ({
      id: `s-${index}`,
      index,
      startMs: index * 1000,
      endMs: (index + 1) * 1000,
      autoKind: 'slide' as const,
      personLayout: 'none' as const,
      detection: { source: 'auto' as const },
      image: {},
    }),
  )
  const blocks = visualSegments.map((segment, index) => ({
    id: segment.id,
    index,
    visualSegmentIds: [segment.id],
    imageSegmentId: segment.id,
    startMs: segment.startMs,
    endMs: segment.endMs,
    transcript: {
      raw: ['Overview. Next, the method is', 'recording temperature.'][index],
      model: 'transcriber',
    },
  }))
  return withArticle(context, { ...context.article, visualSegments, blocks })
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
  const originals = project.article.blocks.map((slide) => slide.transcript!.raw)
  const events: string[] = []
  const cut = createBoundaryPlan(blockViews(project)).sourceText.indexOf('Next,')
  await runContentProcessing(
    {
      project,
      modelId: 'openai:gpt-6-luna',
      onBoundaryPlanCompleted: async (plan) => {
        await Promise.resolve()
        project.article.document!.boundaryPlan = plan
        events.push('saved-plan')
      },
      onSlideCompleted: async (results) => {
        for (const { slideId, result } of results) project = editContent(project, slideId, result)
      },
    },
    fakeGenerator(events, cut),
  )
  expect(events[0]).toBe('boundary')
  expect(events[1]).toBe('saved-plan')
  expect(events[2]).toBe('generate:s-0:Overview.')
  expect(events[3]).toBe('generate:s-1:Next, the method is\n\nrecording temperature.')
  expect(project.article.blocks.map((slide) => slide.transcript!.raw)).toEqual(originals)
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
        project.article.document!.boundaryPlan = plan
      },
      onSlideCompleted: async (results) => {
        for (const { slideId, result } of results) project = editContent(project, slideId, result)
      },
    },
    fakeGenerator(events, 0),
  )
  expect(events.filter((event) => event.startsWith('generate:'))).toHaveLength(1)
  expect(project.article.blocks[0]!.transcript!.articleBody).toBe('')
})

test('保存スキーマで境界計画が往復し、計画がない原稿も読める', () => {
  const context = workspace()
  context.article.document!.boundaryPlan = createBoundaryPlan(blockViews(context))
  expect(articleContext(parseProject(context.project)).article.document?.boundaryPlan).toEqual(
    context.article.document!.boundaryPlan,
  )
  delete context.article.document!.boundaryPlan
  expect(
    articleContext(parseProject(context.project)).article.document?.boundaryPlan,
  ).toBeUndefined()
})

test('境界応答は移動方向と原文を必須にし、本文入力には前後資料を含めない', () => {
  expect(parseBoundaryResponse('```json\n' + JSON.stringify(decision('Next,')) + '\n```')).toEqual(
    decision('Next,'),
  )
  expect(() => parseBoundaryResponse('{"body":"rewritten"}')).toThrow()
  expect(() => parseBoundaryResponse('{"candidateId":"C10"}')).toThrow()
  const prompt = userPromptFor(blockViews(workspace())[0]!, 'en')
  expect(prompt).toContain('<RAW TRANSCRIPT>')
  expect(prompt).not.toContain('PREVIOUS')
  expect(prompt).not.toContain('NEXT')
})

function combinedProcessing() {
  let project = workspace()
  const events: string[] = []
  const stages: ArticleContentProcessingStage[] = []
  const controller = new AbortController()
  const input = {
    project,
    includeSummary: false,
    onSummaryCompleted: async (
      summary: NonNullable<ArticleContext['article']['document']>['summary'],
    ) => {
      project.article.document!.summary = summary
      events.push('saved-summary')
    },
    modelId: 'openai:gpt-6-luna' as const,
    signal: controller.signal,
    getCurrentProject: () => project,
    onStage: (stage: ArticleContentProcessingStage) => stages.push(stage),
    onBoundaryPlanCompleted: async (plan: ReturnType<typeof createBoundaryPlan>) => {
      project.article.document!.boundaryPlan = plan
    },
    onSlideCompleted: async (
      results: Parameters<
        import('../src/features/content-processing/contentProcessing').ContentProcessingSlideCompleted
      >[0],
    ) => {
      for (const { slideId, result } of results) project = editContent(project, slideId, result)
      events.push('saved-bodies')
    },
    onSectionsCompleted: async (
      sections: NonNullable<ArticleContext['article']['document']>['sections'],
    ) => {
      project.article.document!.sections = sections
      events.push('saved-sections')
    },
  }
  const runners = {
    generateSummary: async (
      args: Parameters<
        typeof import('../src/features/article/summaryGenerator').runArticleSummaryGeneration
      >[0],
    ) => {
      events.push('summary')
      expect(args.project).toBe(project)
      expect(events).toContain('saved-sections')
      expect(args.signal).toBe(controller.signal)
      expect(args.modelId).toBe(input.modelId)
      args.onPreparationProgress(0.5)
      args.onReady()
      return {
        model: args.modelId,
        inputFingerprint: 'test',
        overview: 'Overview',
        mainMessage: 'Message',
        keyPoints: ['Point'],
        keywords: ['Keyword'],
      }
    },
    processContent: (args: Parameters<typeof runContentProcessing>[0]) =>
      runContentProcessing(args, fakeGenerator(events)),
    generateSections: async (
      args: Parameters<
        typeof import('../src/features/article/sectionGenerator').runArticleSectionGeneration
      >[0],
    ) => {
      events.push('sections')
      expect(events).toContain('saved-bodies')
      expect(args.project).toBe(project)
      expect(args.project.article.blocks.every((slide) => slide.transcript?.articleBody)).toBe(true)
      expect(args.signal).toBe(controller.signal)
      args.onPreparationProgress(0.5)
      args.onReady()
      return {
        model: args.modelId,
        inputFingerprint: articleSectionsInputFingerprint(project, args.modelId),
        sections: [{ id: 'section-1', heading: 'Overview', slideIds: ['s-0', 's-1'] }],
      }
    },
  }
  return { input, runners, events, stages, controller, currentProject: () => project }
}

test('本文の保存後に最新の本文でセクションを生成し、同じステータスへ段階を通知する', async () => {
  const run = combinedProcessing()
  await runArticleContentProcessing(run.input, run.runners)
  expect(run.events.slice(-3)).toEqual(['saved-bodies', 'sections', 'saved-sections'])
  expect(run.stages.slice(-2)).toEqual(['preparing-sections', 'generating-sections'])
  expect(run.currentProject().article.document?.sections?.sections).toHaveLength(1)
  const before = [...run.events]
  await runArticleContentProcessing({ ...run.input, project: run.currentProject() }, run.runners)
  expect(run.events).toEqual(before)
})

test('セクション生成の失敗後は保存済み本文を再利用して再試行できる', async () => {
  const run = combinedProcessing()
  expect(
    runArticleContentProcessing(run.input, {
      ...run.runners,
      generateSections: async () => {
        throw new Error('sections failed')
      },
    }),
  ).rejects.toThrow('sections failed')
  expect(run.currentProject().article.blocks.every((slide) => slide.transcript?.articleBody)).toBe(
    true,
  )
  const generatedBodies = run.events.filter((event) => event.startsWith('generate:')).length
  await runArticleContentProcessing({ ...run.input, project: run.currentProject() }, run.runners)
  expect(run.events.filter((event) => event.startsWith('generate:'))).toHaveLength(generatedBodies)
  expect(run.events.at(-1)).toBe('saved-sections')
})

test('本文生成後に停止するとセクション生成を開始しない', async () => {
  const run = combinedProcessing()
  expect(
    runArticleContentProcessing(run.input, {
      ...run.runners,
      processContent: async (input) => {
        await run.runners.processContent(input)
        run.controller.abort()
      },
    }),
  ).rejects.toThrow('処理を中止しました。')
  expect(run.events).not.toContain('sections')
})

test('セクション生成中の停止では構成を保存しない', async () => {
  const run = combinedProcessing()
  expect(
    runArticleContentProcessing(run.input, {
      ...run.runners,
      generateSections: async (input) => {
        const result = await run.runners.generateSections(input)
        run.controller.abort()
        return result
      },
    }),
  ).rejects.toThrow('処理を中止しました。')
  expect(run.events).not.toContain('saved-sections')
})

test('要約が有効なら本文・セクション構成の保存後に同じモデルで要約を生成する', async () => {
  const run = combinedProcessing()
  await runArticleContentProcessing({ ...run.input, includeSummary: true }, run.runners)
  expect(run.events.slice(-5)).toEqual([
    'saved-bodies',
    'sections',
    'saved-sections',
    'summary',
    'saved-summary',
  ])
  expect(run.stages.slice(-2)).toEqual(['preparing-summary', 'generating-summary'])
  expect(run.currentProject().article.document?.summary?.overview).toBe('Overview')
})

test('要約が無効なら既存の要約を保持し、要約モデルを呼ばない', async () => {
  const run = combinedProcessing()
  const summary = {
    model: 'manual',
    inputFingerprint: 'old',
    overview: 'Edited',
    mainMessage: 'Message',
    keyPoints: ['Point'],
    keywords: ['Keyword'],
  }
  run.currentProject().article.document!.summary = summary
  await runArticleContentProcessing(run.input, run.runners)
  expect(run.events).not.toContain('summary')
  expect(run.currentProject().article.document?.summary).toEqual(summary)
})

test('要約に失敗しても保存済み本文・構成を再利用して再試行できる', async () => {
  const run = combinedProcessing()
  expect(
    runArticleContentProcessing(
      { ...run.input, includeSummary: true },
      {
        ...run.runners,
        generateSummary: async () => {
          throw new Error('summary failed')
        },
      },
    ),
  ).rejects.toThrow('summary failed')
  const generatedBodies = run.events.filter((event) => event.startsWith('generate:')).length
  const generatedSections = run.events.filter((event) => event === 'sections').length
  await runArticleContentProcessing(
    { ...run.input, project: run.currentProject(), includeSummary: true },
    run.runners,
  )
  expect(run.events.filter((event) => event.startsWith('generate:'))).toHaveLength(generatedBodies)
  expect(run.events.filter((event) => event === 'sections')).toHaveLength(generatedSections)
  expect(run.events.at(-1)).toBe('saved-summary')
})

test('要約生成中の停止では要約を保存せず、保存済み本文・構成を保持する', async () => {
  const run = combinedProcessing()
  expect(
    runArticleContentProcessing(
      { ...run.input, includeSummary: true },
      {
        ...run.runners,
        generateSummary: async (input) => {
          const summary = await run.runners.generateSummary(input)
          run.controller.abort()
          return summary
        },
      },
    ),
  ).rejects.toThrow('処理を中止しました。')
  expect(run.events).not.toContain('saved-summary')
  expect(run.currentProject().article.document?.sections?.sections).toHaveLength(1)
  expect(run.currentProject().article.blocks.every((slide) => slide.transcript?.articleBody)).toBe(
    true,
  )
})
