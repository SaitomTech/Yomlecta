import { Settings } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
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
}: {
  activeNav: 'home' | 'projects' | 'articles'
  onHome?: () => void
  onProjects?: () => void
  onArticles?: () => void
}) {
  const linkClass =
    'cursor-pointer px-1 py-2 text-[13px] font-semibold transition hover:text-[#1d6b50] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30'
  const items = [
    { id: 'home', label: 'ホーム', onClick: onHome },
    { id: 'projects', label: 'プロジェクト', onClick: onProjects },
    { id: 'articles', label: '記事', onClick: onArticles },
  ] as const

  return (
    <nav className="hidden items-center gap-8 min-[980px]:flex" aria-label="メインナビゲーション">
      {items.map(({ id, label, onClick }) => (
        <button
          key={id}
          className={`${linkClass} ${activeNav === id ? 'border-b-2 border-[#1d6b50] text-[#174d3c]' : 'text-[#71807b]'}`}
          type="button"
          onClick={onClick}
          aria-current={activeNav === id ? 'page' : undefined}
        >
          {label}
        </button>
      ))}
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
  const activateHome = () => {
    if (!homeDisabled) onHome?.()
  }
  const handleBrandKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    activateHome()
  }

  return (
    <header className="grid h-[76px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-[#d8e1dc]/75 bg-white px-[5.8vw]">
      <div
        className={`${brandContainerClass} ${onHome ? 'cursor-pointer' : ''} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d6b50]/30`}
        role={onHome ? 'button' : undefined}
        tabIndex={onHome ? 0 : undefined}
        onClick={onHome ? activateHome : undefined}
        onKeyDown={onHome ? handleBrandKeyDown : undefined}
        aria-label={onHome ? 'ホームへ戻る' : undefined}
        aria-disabled={onHome && homeDisabled ? true : undefined}
      >
        {appBrand}
      </div>
      {activeNav && (
        <HeaderNavigation
          activeNav={activeNav}
          onHome={onHome}
          onProjects={onProjects}
          onArticles={onArticles}
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
