import { useState } from 'react'
import type { ArticleMetadata } from '../../../types/project'
import { ConfirmDialog } from './ConfirmDialog'
export function DeleteArticleDialog({
  article,
  onClose,
  onConfirm,
}: {
  article: ArticleMetadata
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '記事を削除できませんでした。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <ConfirmDialog
      open
      eyebrow="Delete article"
      title="記事を削除"
      subject={`「${article.title}」を削除しますか？`}
      description="この記事の作成データと生成結果が削除されます。元動画は削除されません。"
      error={error}
      busy={busy}
      dialogTitleId="delete-article-title"
      closeLabel="記事削除を閉じる"
      onClose={onClose}
      onConfirm={() => void confirm()}
    />
  )
}
