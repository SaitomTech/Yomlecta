import { expect, test } from 'bun:test'
import { createProjectWorkspace } from '../src/app/createProjectWorkspace'
import { createArticleFixture } from './fixtures/article'
import type { Project } from '../src/types/project'

function articleProject(projectId: string, articleId: string): Project {
  const context = createArticleFixture(projectId, articleId)
  return { ...context.project, title: 'test' }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('queued article updates use the latest successful state', async () => {
  const firstSave = deferred()
  const inputs: string[] = []
  const published: Array<Project | null> = []
  const workspace = createProjectWorkspace((project) => published.push(project), {
    storage: { loadProject: async () => articleProject('project', 'article') },
    articleOperations: {
      saveArticleTitle: async (context, title) => {
        inputs.push(context.article.title)
        if (title === 'first') await firstSave.promise
        return { ...context.article, title }
      },
    },
  })
  await workspace.openArticleDetail({ projectId: 'project', articleId: 'article' })
  const first = workspace.saveArticleTitle({ projectId: 'project', articleId: 'article' }, 'first')
  const second = workspace.saveArticleTitle(
    { projectId: 'project', articleId: 'article' },
    'second',
  )
  await Promise.resolve()
  expect(inputs).toEqual(['article'])
  expect(workspace.project?.title).toBe('test')
  firstSave.resolve()
  await Promise.all([first, second])
  expect(inputs).toEqual(['article', 'first'])
  expect(workspace.activeArticle?.title).toBe('second')
  expect(published).toHaveLength(3)
})

test('failed save preserves state and allows the next queued operation', async () => {
  const published: Array<Project | null> = []
  const workspace = createProjectWorkspace((project) => published.push(project), {
    storage: { loadProject: async () => articleProject('project', 'article') },
    articleOperations: {
      saveArticleTitle: async (context, title) => {
        if (title === 'fail') throw new Error('save failed')
        return { ...context.article, title }
      },
    },
  })
  const target = { projectId: 'project', articleId: 'article' }
  await workspace.openArticleDetail(target)
  const before = workspace.project
  expect(await workspace.saveArticleTitle(target, 'fail').catch((error) => error.message)).toBe(
    'save failed',
  )
  expect(workspace.project).toBe(before)
  expect(published).toHaveLength(1)
  await workspace.saveArticleTitle(target, 'success')
  expect(workspace.activeArticle?.title).toBe('success')
})

test('an old callback queued after loading another article is rejected before saving', async () => {
  let saves = 0
  const workspace = createProjectWorkspace(() => {}, {
    storage: { loadProject: async (projectId, articleId) => articleProject(projectId, articleId!) },
    articleOperations: {
      saveArticleTitle: async (context) => {
        saves++
        return context.article
      },
    },
  })
  const first = { projectId: 'project', articleId: 'first' }
  const second = { projectId: 'project', articleId: 'second' }
  await workspace.openArticleDetail(first)
  const loading = workspace.openArticleDetail(second)
  const saving = workspace.saveArticleTitle(first, 'stale')
  await loading
  expect(await saving.catch((error) => error.message)).toBe(
    '操作対象の記事が変更されました。処理を再実行してください。',
  )
  expect(saves).toBe(0)
  expect(workspace.getArticleWorkspace(first)).toBeNull()
  expect(workspace.getArticleWorkspace(second)?.article).toBe(workspace.activeArticle!)
  expect(
    await workspace
      .saveArticleTitle({ ...second, projectId: 'other' }, 'stale')
      .catch((error) => error.message),
  ).toBe('操作対象のプロジェクトが変更されました。')
})

test('unchanged saves return current state without publishing again', async () => {
  let publishes = 0
  const workspace = createProjectWorkspace(
    () => {
      publishes++
    },
    {
      storage: { loadProject: async () => articleProject('project', 'article') },
      articleOperations: { saveArticleTitle: async (context) => context.article },
    },
  )
  const target = { projectId: 'project', articleId: 'article' }
  await workspace.openArticleDetail(target)
  const before = workspace.project
  expect(await workspace.saveArticleTitle(target, 'same')).toBe(workspace.activeArticle!)
  expect(workspace.project).toBe(before)
  expect(publishes).toBe(1)
})

test('empty project creation waits for previous operations and only publishes after persistence', async () => {
  const loading = deferred()
  let creates = 0
  const workspace = createProjectWorkspace(() => {}, {
    storage: {
      loadProject: async () => {
        await loading.promise
        return articleProject('old', 'article')
      },
      createProject: async (project) => {
        creates++
        return project
      },
    },
  })
  const opening = workspace.openArticleDetail({ projectId: 'old', articleId: 'article' })
  const creating = workspace.createProject('new')
  await Promise.resolve()
  expect(creates).toBe(0)
  expect(workspace.project).toBeNull()
  loading.resolve()
  await opening
  const created = await creating
  expect(creates).toBe(1)
  expect(workspace.project).toBe(created)
  expect(created.title).toBe('new')
})

test('workflow opening normalizes the saved export marker while detail opening preserves it', async () => {
  let visits = 0
  const target = { projectId: 'project', articleId: 'article' }
  const workspace = createProjectWorkspace(() => {}, {
    storage: {
      loadProject: async () => {
        const article = createArticleFixture(target.projectId, target.articleId).article
        article.workflow = {
          ...article.workflow,
          lastVisitedStep: 'export',
          maxReachedStep: 'export',
        }
        return {
          ...createArticleFixture(target.projectId, target.articleId).project,
          articles: [{ kind: 'loaded', article }],
        }
      },
    },
    articleOperations: {
      saveArticleWorkflow: async (_context, article) => {
        visits++
        return article
      },
    },
  })
  await workspace.openArticleDetail(target)
  expect(workspace.activeArticle?.workflow.lastVisitedStep).toBe('export')
  expect(visits).toBe(0)
  const opened = await workspace.openArticle(target)
  expect(opened.step).toBe('article-review')
  expect(workspace.activeArticle?.workflow.lastVisitedStep).toBe('article-review')
  expect(visits).toBe(1)
})

test('detail edits preserve the resume article, while opening a workflow changes it', async () => {
  const context = createArticleFixture('project', 'detail')
  const previous = { ...context.article, id: 'resume' }
  const project: Project = {
    ...context.project,
    lastOpenedArticleId: previous.id,
    articles: [
      ...context.project.articles,
      {
        kind: 'metadata',
        metadata: {
          id: previous.id,
          title: previous.title,
          sourceRange: previous.sourceRange,
          sourceVideoId: previous.sourceVideoId,
          workflow: previous.workflow,
          createdAt: previous.createdAt,
          updatedAt: previous.updatedAt,
        },
      },
    ],
  }
  const workspace = createProjectWorkspace(() => {}, {
    storage: { loadProject: async () => project },
    articleOperations: {
      saveArticleTitle: async (context, title) => ({ ...context.article, title }),
      saveArticleWorkflow: async (_context, article) => article,
    },
  })
  const target = { projectId: project.id, articleId: context.article.id }
  await workspace.openArticleDetail(target)
  await workspace.saveArticleTitle(target, 'edited')
  expect(workspace.project?.lastOpenedArticleId).toBe('resume')
  await workspace.openArticle(target)
  expect(workspace.project?.lastOpenedArticleId).toBe('detail')
})

test('opening and visiting an older article preserve the newer project update time', async () => {
  const context = createArticleFixture()
  context.project.updatedAt = '2026-10-06T00:00:00.000Z'
  const workspace = createProjectWorkspace(() => {}, {
    storage: { loadProject: async () => context.project },
    articleOperations: { saveArticleWorkflow: async (_context, article) => article },
  })
  const target = { projectId: context.project.id, articleId: context.article.id }
  await workspace.openProject(target.projectId)
  expect(workspace.project?.updatedAt).toBe(context.project.updatedAt)
  expect(workspace.activeArticle?.updatedAt).toBe(context.article.updatedAt)
  await workspace.openArticle(target)
  expect(workspace.project?.updatedAt).toBe(context.project.updatedAt)
  await workspace.visitStep(target, 'detect-slides')
  expect(workspace.project?.updatedAt).toBe(context.project.updatedAt)
})
