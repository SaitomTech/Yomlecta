import { useCallback, useEffect, useRef, useState } from 'react'
import { getErrorDetail } from '../lib/errors'
import type { PageInfo, PagedResult } from '../types/project'

type CursorPageRequest = {
  pageSize: number
  pageToken?: string
}

type CursorNavigation = {
  filterKey: string
  page: number
  pageTokens: Array<string | undefined>
}

export function useCursorPagination<T>({
  pageSize,
  filterKey,
  loadPage,
  errorMessage,
}: {
  pageSize: number
  filterKey: string
  loadPage: (options: CursorPageRequest) => Promise<PagedResult<T>>
  errorMessage: string
}) {
  const [items, setItems] = useState<T[]>([])
  const [navigation, setNavigation] = useState<CursorNavigation>(() => ({
    filterKey,
    page: 1,
    pageTokens: [],
  }))
  const [pageInfo, setPageInfo] = useState<PageInfo>({
    pageSize,
    total: 0,
    hasNextPage: false,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const requestId = useRef(0)
  const loadedFilterKey = useRef<string | null>(null)
  const nextPageToken = useRef<string | null>(null)

  const page = navigation.filterKey === filterKey ? navigation.page : 1
  const pageToken = navigation.filterKey === filterKey ? navigation.pageTokens[page - 1] : undefined

  useEffect(() => {
    const currentRequestId = ++requestId.current
    loadedFilterKey.current = null
    nextPageToken.current = null
    setLoading(true)
    setError(null)

    void loadPage({ pageSize, pageToken })
      .then((result) => {
        if (currentRequestId !== requestId.current) return
        setItems(result.items)
        setPageInfo(result.pageInfo)
        setNavigation((current) =>
          current.filterKey === filterKey ? current : { filterKey, page: 1, pageTokens: [] },
        )
        loadedFilterKey.current = filterKey
        nextPageToken.current = result.nextPageToken
      })
      .catch((cause) => {
        if (currentRequestId !== requestId.current) return
        setItems([])
        setPageInfo({ pageSize, total: 0, hasNextPage: false })
        setError(getErrorDetail(cause, errorMessage))
      })
      .finally(() => {
        if (currentRequestId === requestId.current) setLoading(false)
      })

    return () => {
      if (requestId.current === currentRequestId) requestId.current += 1
    }
  }, [errorMessage, filterKey, loadPage, page, pageSize, pageToken, refreshVersion])

  const goNext = useCallback(() => {
    const token = nextPageToken.current
    if (!token || loading || loadedFilterKey.current !== filterKey) return
    setLoading(true)
    setNavigation((current) => {
      const currentNavigation =
        current.filterKey === filterKey ? current : { filterKey, page: 1, pageTokens: [] }
      const pageTokens = [...currentNavigation.pageTokens]
      pageTokens[currentNavigation.page] = token
      return {
        filterKey,
        page: currentNavigation.page + 1,
        pageTokens,
      }
    })
  }, [filterKey, loading])

  const goPrevious = useCallback(() => {
    if (page <= 1 || loading || loadedFilterKey.current !== filterKey) return
    setLoading(true)
    setNavigation((current) => ({
      filterKey,
      page: page - 1,
      pageTokens: current.filterKey === filterKey ? current.pageTokens : [],
    }))
  }, [filterKey, loading, page])

  const reload = useCallback(() => {
    setLoading(true)
    setRefreshVersion((version) => version + 1)
  }, [])

  const resetAndReload = useCallback(() => {
    setLoading(true)
    setNavigation({ filterKey, page: 1, pageTokens: [] })
    setRefreshVersion((version) => version + 1)
  }, [filterKey])

  return {
    items,
    page,
    pageInfo,
    loading,
    error,
    isPageCurrent: loadedFilterKey.current === filterKey,
    goNext,
    goPrevious,
    reload,
    resetAndReload,
  }
}
