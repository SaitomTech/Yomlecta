import type { Article, ArticleListItem, ArticleListStatus } from '../../types/project'

export type { ArticleListStatus } from '../../types/project'

export function getArticleStatus(
  article: Pick<Article, 'workflow'> | Pick<ArticleListItem, 'lastVisitedStep' | 'maxReachedStep'>,
): ArticleListStatus {
  const workflow = 'workflow' in article ? article.workflow : article
  if (workflow.lastVisitedStep === 'export' || workflow.maxReachedStep === 'export') return 'done'
  if (workflow.lastVisitedStep === 'crop') return 'not-started'
  return 'working'
}

export function getArticleStatusLabel(status: ArticleListStatus) {
  if (status === 'done') return '作成完了'
  if (status === 'not-started') return '未着手'
  return '作業中'
}

export function getArticleActionLabel(status: ArticleListStatus) {
  if (status === 'done') return '記事を見る'
  if (status === 'not-started') return '作成を開始'
  return '作成を再開'
}

export function formatArticleDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}
