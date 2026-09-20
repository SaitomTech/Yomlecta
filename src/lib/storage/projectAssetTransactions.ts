import {
  appLocalPathExists,
  ensureAppLocalDirectory,
  readAppLocalDirectory,
  readAppLocalTextFile,
  removeAppLocalPath,
  renameAppLocalPath,
  writeAppLocalTextFile,
} from '../tauri/filesystem'
import { invokeDb } from '../tauri/db'

export const PROJECT_TRASH_DIRECTORY = 'project-trash'
export type AssetCollection = 'articles' | 'videos'
export type AssetTrashTransaction = {
  operationRoot: string
  sourcePath: string
  trashPath: string
  moved: boolean
}
type AssetTrashJournal = {
  operationId: string
  collection: AssetCollection
  assetId: string
  state: 'pending' | 'moved'
}

export function assertProjectId(projectId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error('不正なプロジェクトIDです。')
}

function assertAssetId(assetId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(assetId)) throw new Error('不正なアセットIDです。')
}

export function projectDirectory(projectId: string) {
  assertProjectId(projectId)
  return `projects/${projectId}`
}

function assetPath(projectId: string, collection: AssetCollection, assetId: string) {
  assertAssetId(assetId)
  return `${projectDirectory(projectId)}/${collection}/${assetId}`
}

function isSafeStoragePath(path: string) {
  return (
    path === 'projects' ||
    path === PROJECT_TRASH_DIRECTORY ||
    path.startsWith('projects/') ||
    path.startsWith(`${PROJECT_TRASH_DIRECTORY}/`)
  )
}

export async function removeIfPresent(path: string) {
  if (!isSafeStoragePath(path)) throw new Error('不正なストレージパスです。')
  if (await appLocalPathExists(path)) await removeAppLocalPath(path)
}

export async function recoverProjectTrash() {
  if (!(await appLocalPathExists(PROJECT_TRASH_DIRECTORY))) return
  const entries = await readAppLocalDirectory(PROJECT_TRASH_DIRECTORY)
  for (const entry of entries.filter((candidate) => candidate.isDirectory)) {
    try {
      assertProjectId(entry.name)
    } catch {
      continue
    }
    const trashPath = `${PROJECT_TRASH_DIRECTORY}/${entry.name}`
    const sourcePath = projectDirectory(entry.name)
    let reference: boolean | null = null
    try {
      reference = (
        await invokeDb<{ referenced: boolean }>('db_check_storage_reference', {
          referenceType: 'project',
          projectId: entry.name,
          assetId: null,
        })
      ).referenced
    } catch {
      // A database failure is not evidence that the project was deleted.
      reference = null
    }
    try {
      if (reference === true && !(await appLocalPathExists(sourcePath))) {
        await ensureAppLocalDirectory('projects')
        await renameAppLocalPath(trashPath, sourcePath)
        await removeIfPresent(`${sourcePath}/operation.json`)
      } else if (reference === false) {
        await removeIfPresent(trashPath)
      }
    } catch (error) {
      console.warn('プロジェクト退避を復旧できませんでした。', error)
    }
  }
}

export async function recoverAssetTrash() {
  const projects = await readAppLocalDirectory('projects')
  for (const projectEntry of projects.filter((entry) => entry.isDirectory)) {
    try {
      assertProjectId(projectEntry.name)
    } catch {
      continue
    }
    const trashRoot = `${projectDirectory(projectEntry.name)}/.trash`
    if (!(await appLocalPathExists(trashRoot))) continue
    let operations
    try {
      operations = await readAppLocalDirectory(trashRoot)
    } catch {
      continue
    }
    for (const operation of operations.filter((entry) => entry.isDirectory)) {
      const operationRoot = `${trashRoot}/${operation.name}`
      const journalPath = `${operationRoot}/operation.json`
      let journal: AssetTrashJournal
      try {
        const parsed: unknown = JSON.parse(await readAppLocalTextFile(journalPath))
        if (!parsed || typeof parsed !== 'object') throw new Error('journal is not an object')
        const candidate = parsed as Partial<AssetTrashJournal>
        if (
          candidate.operationId !== operation.name ||
          (candidate.collection !== 'articles' && candidate.collection !== 'videos') ||
          typeof candidate.assetId !== 'string' ||
          (candidate.state !== 'pending' && candidate.state !== 'moved')
        )
          throw new Error('journal fields are invalid')
        assertAssetId(candidate.assetId)
        journal = candidate as AssetTrashJournal
      } catch (error) {
        console.warn('不正なasset退避journalを復旧できません。', error)
        continue
      }

      const sourcePath = assetPath(projectEntry.name, journal.collection, journal.assetId)
      const trashPath = `${operationRoot}/${journal.collection}/${journal.assetId}`
      let stillReferenced: boolean | null = null
      try {
        stillReferenced = (
          await invokeDb<{ referenced: boolean }>('db_check_storage_reference', {
            referenceType: journal.collection === 'articles' ? 'article' : 'video',
            projectId: projectEntry.name,
            assetId: journal.assetId,
          })
        ).referenced
      } catch {
        stillReferenced = null
      }

      try {
        if (
          stillReferenced === true &&
          (await appLocalPathExists(trashPath)) &&
          !(await appLocalPathExists(sourcePath))
        ) {
          await ensureAppLocalDirectory(sourcePath.slice(0, sourcePath.lastIndexOf('/')))
          await renameAppLocalPath(trashPath, sourcePath)
        }
        if (stillReferenced === false) await removeIfPresent(operationRoot)
        // Unknown database state: preserve the journal and both paths for the
        // next startup instead of guessing that the row was deleted.
      } catch (error) {
        console.warn('asset退避を復旧できませんでした。', error)
      }
    }
  }
}

export async function beginAssetTrashTransaction(
  projectId: string,
  collection: AssetCollection,
  assetId: string,
): Promise<AssetTrashTransaction> {
  assertProjectId(projectId)
  assertAssetId(assetId)
  const operationId = crypto.randomUUID()
  const operationRoot = `${projectDirectory(projectId)}/.trash/${operationId}`
  const sourcePath = assetPath(projectId, collection, assetId)
  const trashPath = `${operationRoot}/${collection}/${assetId}`
  const transaction = { operationRoot, sourcePath, trashPath, moved: false }
  try {
    await ensureAppLocalDirectory(operationRoot)
    await writeAppLocalTextFile(
      `${operationRoot}/operation.json`,
      `${JSON.stringify({ operationId, collection, assetId, state: 'pending' } satisfies AssetTrashJournal)}\n`,
    )
    transaction.moved = await appLocalPathExists(sourcePath)
    if (transaction.moved) {
      await ensureAppLocalDirectory(`${operationRoot}/${collection}`)
      await renameAppLocalPath(sourcePath, trashPath)
      await writeAppLocalTextFile(
        `${operationRoot}/operation.json`,
        `${JSON.stringify({ operationId, collection, assetId, state: 'moved' } satisfies AssetTrashJournal)}\n`,
      )
    }
    return transaction
  } catch (error) {
    try {
      await restoreAssetTrashTransaction(transaction)
    } catch (restoreError) {
      // Keep the journal and the trash path when recovery is uncertain.  A
      // later startup can inspect the database reference and retry safely.
      throw new AggregateError([error, restoreError], 'アセット退避の復旧に失敗しました。')
    }
    await finishAssetTrashTransaction(transaction)
    throw error
  }
}

export async function restoreAssetTrashTransaction(transaction: AssetTrashTransaction) {
  if (!transaction.moved || !(await appLocalPathExists(transaction.trashPath))) return
  if (await appLocalPathExists(transaction.sourcePath)) {
    // Both paths exist.  Do not guess which copy is authoritative.
    throw new Error('元パスと退避パスの両方が存在するため復元を保留しました。')
  }
  const parent = transaction.sourcePath.slice(0, transaction.sourcePath.lastIndexOf('/'))
  await ensureAppLocalDirectory(parent)
  await renameAppLocalPath(transaction.trashPath, transaction.sourcePath)
}

export async function finishAssetTrashTransaction(transaction: AssetTrashTransaction) {
  await removeIfPresent(transaction.operationRoot).catch((error) => {
    console.warn('削除済みアセットの一時退避領域を削除できませんでした。', error)
  })
}
