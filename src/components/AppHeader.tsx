import { Settings } from 'lucide-react'
import { useState } from 'react'
import { SettingsDialog } from './SettingsDialog'

type AppHeaderProps = {
  onHome?: () => void
  onProjects?: () => void
  onArticles?: () => void
  activeNav?: 'home' | 'projects' | 'articles'
  homeDisabled?: boolean
}

const appBrand = (
  <img
    className="h-12 w-auto max-w-[190px] object-contain"
    src="/yomlecta-logo.png"
    alt="Yomlecta"
    draggable={false}
  />
)

function HeaderNavigation({
  activeNav,
  onHome,
  onProjects,
  onArticles,
  disabled,
}: {
  activeNav: 'home' | 'projects' | 'articles'
  onHome?: () => void
  onProjects?: () => void
  onArticles?: () => void
  disabled: boolean
}) {
  const linkClass =
    'cursor-pointer px-1 py-2 text-[13px] font-semibold text-[#71807b] transition hover:text-[#1d6b50] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-45'
  const activeClass =
    'border-b-2 border-[#1d6b50] px-1 py-2 text-[13px] font-semibold text-[#174d3c]'

  return (
    <nav className="hidden items-center gap-8 min-[980px]:flex" aria-label="メインナビゲーション">
      {activeNav === 'home' ? (
        <span className={activeClass} aria-current="page">
          ホーム
        </span>
      ) : (
        <button className={linkClass} type="button" onClick={onHome} disabled={!onHome || disabled}>
          ホーム
        </button>
      )}
      {activeNav === 'projects' ? (
        <span className={activeClass} aria-current="page">
          プロジェクト
        </span>
      ) : (
        <button
          className={linkClass}
          type="button"
          onClick={onProjects}
          disabled={!onProjects || disabled}
        >
          プロジェクト
        </button>
      )}
      {activeNav === 'articles' ? (
        <span className={activeClass} aria-current="page">
          記事
        </span>
      ) : (
        <button
          className={linkClass}
          type="button"
          onClick={onArticles}
          disabled={!onArticles || disabled}
        >
          記事
        </button>
      )}
    </nav>
  )
}

export function AppHeader({
  onHome,
  onProjects,
  onArticles,
  activeNav,
  homeDisabled = false,
}: AppHeaderProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const brandContainerClass = 'inline-flex w-fit items-center justify-self-start text-left'

  const navigationDisabled = homeDisabled

  return (
    <header className="grid h-[76px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-[#d8e1dc]/75 bg-white px-[5.8vw]">
      {onHome ? (
        <button
          className={`${brandContainerClass} cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30 disabled:cursor-not-allowed disabled:opacity-45`}
          type="button"
          onClick={onHome}
          disabled={homeDisabled}
          aria-label="ホームへ戻る"
        >
          {appBrand}
        </button>
      ) : (
        <div className={brandContainerClass}>{appBrand}</div>
      )}
      {activeNav && (
        <HeaderNavigation
          activeNav={activeNav}
          onHome={onHome}
          onProjects={onProjects}
          onArticles={onArticles}
          disabled={navigationDisabled}
        />
      )}
      <div className="flex min-w-0 items-center justify-self-end gap-2">
        <button
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 py-2 text-[11px] font-semibold text-[#53615b] transition hover:bg-[#e8f2ec] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/25"
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          title="設定を表示"
          aria-label="設定を表示"
        >
          <Settings size={15} />
          <span className="hidden sm:inline">設定</span>
        </button>
      </div>
      {isSettingsOpen && (
        <SettingsDialog onClose={() => setIsSettingsOpen(false)} disabled={homeDisabled} />
      )}
    </header>
  )
}
