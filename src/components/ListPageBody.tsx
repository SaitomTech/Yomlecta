import type { ReactNode } from 'react'

export function ListPageBody({
  isEmpty,
  loading,
  error,
  loadingContent,
  errorContent,
  emptyContent,
  children,
}: {
  isEmpty: boolean
  loading: boolean
  error: boolean
  loadingContent: ReactNode
  errorContent: ReactNode
  emptyContent: ReactNode
  children: ReactNode
}) {
  if (isEmpty && loading) return loadingContent
  if (isEmpty && error) return errorContent
  if (isEmpty) return emptyContent
  return children
}
