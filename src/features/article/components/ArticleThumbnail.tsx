import { convertFileSrc } from '@tauri-apps/api/core'
import { FileText } from 'lucide-react'
import { useState } from 'react'
import type { ArticleMetadata } from '../../../types/project'

export function getArticleThumbnail(article: ArticleMetadata) {
  return { thumbnailPath: article.thumbnailPath, thumbnailUrl: article.thumbnailUrl }
}

export function ArticleThumbnail({
  thumbnailPath,
  thumbnailUrl,
  size = 'default',
}: {
  thumbnailPath?: string | null
  thumbnailUrl?: string | null
  size?: 'default' | 'large'
}) {
  const [failedSources, setFailedSources] = useState<string[]>([])
  const source = [thumbnailPath ? convertFileSrc(thumbnailPath) : null, thumbnailUrl].find(
    (candidate) => candidate && !failedSources.includes(candidate),
  )

  return (
    <div
      className={`grid aspect-video shrink-0 place-items-center overflow-hidden rounded-[7px] border border-[#d8e1dc] bg-[#e8f2ec] ${size === 'large' ? 'w-28 sm:w-40' : 'w-20 sm:w-24'}`}
    >
      {source ? (
        <img
          className="h-full w-full object-cover"
          src={source}
          alt=""
          loading="lazy"
          onError={() => setFailedSources((current) => [...current, source])}
        />
      ) : (
        <FileText className="text-[#8da79a]" size={20} strokeWidth={1.6} />
      )}
    </div>
  )
}
