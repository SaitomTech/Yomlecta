import { createContext, useContext, useLayoutEffect } from 'react'

export type NavigationDisabledSetter = (disabled: boolean) => void

export const NavigationDisabledContext = createContext<NavigationDisabledSetter | null>(null)

export function useNavigationDisabled(disabled: boolean) {
  const setNavigationDisabled = useContext(NavigationDisabledContext)

  useLayoutEffect(() => {
    if (!setNavigationDisabled) return
    setNavigationDisabled(disabled)
    return () => setNavigationDisabled(false)
  }, [disabled, setNavigationDisabled])
}
