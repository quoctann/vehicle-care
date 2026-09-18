import { useEffect } from 'react'
import { useTheme } from 'next-themes'

const THEME_COLORS = {
  light: '#f9f9fb',
  dark: '#141416',
} as const

export function ThemeColorSync() {
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    meta?.setAttribute('content', resolvedTheme === 'dark' ? THEME_COLORS.dark : THEME_COLORS.light)
  }, [resolvedTheme])

  return null
}
