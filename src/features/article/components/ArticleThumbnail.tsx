import { convertFileSrc } from '@tauri-apps/api/core'
import { FileText } from 'lucide-react'
import { useState } from 'react'
import type { Article } from '../../../types/project'

export function getArticleThumbnail(article: Article) {
  return {
    thumbnailPath:
      [...article.slides]
        .sort((a, b) => a.index - b.index)
        .find((slide) => slide.image.representativeFramePath)?.image.representativeFramePath ??
      article.inputMedia.thumbnailPath,
    thumbnailUrl:
      article.inputMedia.origin?.kind === 'youtube'
        ? article.inputMedia.origin.thumbnailUrl
        : undefined,
  }
}

export function ArticleThumbnail({
  thumbnailPath,
  thumbnailUrl,
}: {
  thumbnailPath?: string | null
  thumbnailUrl?: string | null
}) {
  const [failedSources, setFailedSources] = useState<string[]>([])
  const source = [thumbnailPath ? convertFileSrc(thumbnailPath) : null, thumbnailUrl].find(
    (candidate) => candidate && !failedSources.includes(candidate),
  )

  return (
    <div className="grid aspect-video w-20 shrink-0 place-items-center overflow-hidden rounded-[7px] border border-[#d8e1dc] bg-[#e8f2ec] sm:w-24">
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
