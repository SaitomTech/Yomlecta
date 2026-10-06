import { expect, test } from 'bun:test'
import { createProjectWorkspace } from '../src/app/createProjectWorkspace'
import { createEmptyProject } from '../src/lib/project/project'
import type { Article, MediaProject } from '../src/types/project'

function articleProject(projectId: string, articleId: string): MediaProject {
  const project = { ...createEmptyProject('test'), id: projectId }
  const article: Article = {
    id: articleId,
    title: 'article',
    inputMedia: {
      ...project.source,
      ownership: 'managed',
      managedRelativePath: 'videos/video/original.mp4',
      preparedFromVideoId: 'video',
      preparation: 'reference',
      preparedAt: project.createdAt,
    },
    sourceRange: { startMs: 0, endMs: 1000 },
    settings: project.settings,
    slides: [],
    articleBlocks: [],
    workflow: project.workflow,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
  return { ...project, activeArticleId: articleId, articles: [article] }
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
  const published: Array<MediaProject | null> = []
  const workspace = createProjectWorkspace((project) => published.push(project), {
    storage: { loadProject: async () => articleProject('project', 'article') },
    articleOperations: {
      saveArticleTitle: async (project, title) => {
        inputs.push(project.title)
        if (title === 'first') await firstSave.promise
        return { ...project, title }
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
  expect(inputs).toEqual(['test'])
  expect(workspace.project?.title).toBe('test')
  firstSave.resolve()
  await Promise.all([first, second])
  expect(inputs).toEqual(['test', 'first'])
  expect(workspace.project?.title).toBe('second')
  expect(published).toHaveLength(3)
})

test('failed save preserves state and allows the next queued operation', async () => {
  const published: Array<MediaProject | null> = []
  const workspace = createProjectWorkspace((project) => published.push(project), {
    storage: { loadProject: async () => articleProject('project', 'article') },
    articleOperations: {
      saveArticleTitle: async (project, title) => {
        if (title === 'fail') throw new Error('save failed')
        return { ...project, title }
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
  expect(workspace.project?.title).toBe('success')
})

test('an old callback queued after loading another article is rejected before saving', async () => {
  let saves = 0
  const workspace = createProjectWorkspace(() => {}, {
    storage: { loadProject: async (projectId, articleId) => articleProject(projectId, articleId!) },
    articleOperations: {
      saveArticleTitle: async (project) => {
        saves++
        return project
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
  expect(workspace.getArticleWorkspace(second)).toBe(workspace.project)
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
      articleOperations: { saveArticleTitle: async () => null },
    },
  )
  const target = { projectId: 'project', articleId: 'article' }
  await workspace.openArticleDetail(target)
  const before = workspace.project
  expect(await workspace.saveArticleTitle(target, 'same')).toBe(before!)
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
        const project = articleProject(target.projectId, target.articleId)
        project.articles[0].workflow = {
          ...project.workflow,
          lastVisitedStep: 'export',
          maxReachedStep: 'export',
        }
        return project
      },
    },
    projectOperations: {
      persistProjectWorkflow: async (project) => {
        visits++
        return project
      },
    },
  })
  await workspace.openArticleDetail(target)
  expect(workspace.project?.workflow.lastVisitedStep).toBe('export')
  expect(visits).toBe(0)
  const opened = await workspace.openArticle(target)
  expect(opened.step).toBe('article-review')
  expect(workspace.project?.workflow.lastVisitedStep).toBe('article-review')
  expect(visits).toBe(1)
})
