import { useState, type ReactNode } from 'react'
import { AppHeader } from '../components/AppHeader'
import { NavigationDisabledContext } from './navigationDisabled'

export function AppLayout({
  activeNav,
  onHome,
  onProjects,
  onArticles,
  children,
}: {
  activeNav: 'home' | 'projects' | 'articles'
  onHome?: () => void
  onProjects?: () => void
  onArticles?: () => void
  children: ReactNode
}) {
  const [navigationDisabled, setNavigationDisabled] = useState(false)

  return (
    <NavigationDisabledContext.Provider value={setNavigationDisabled}>
      <AppHeader
        activeNav={activeNav}
        onHome={onHome}
        onProjects={onProjects}
        onArticles={onArticles}
        homeDisabled={navigationDisabled}
      />
      {children}
    </NavigationDisabledContext.Provider>
  )
}
