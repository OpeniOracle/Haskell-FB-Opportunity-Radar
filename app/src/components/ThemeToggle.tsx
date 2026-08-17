import { useEffect, useState } from 'react'
import { Icon } from '@/components/Icon'

type ThemeChoice = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'radar.theme'
const ORDER: ThemeChoice[] = ['system', 'light', 'dark']

const LABEL: Record<ThemeChoice, string> = {
  system: 'Theme: system',
  light: 'Theme: light',
  dark: 'Theme: dark',
}

function readStored(): ThemeChoice {
  if (typeof window === 'undefined') return 'system'
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}

/**
 * Three-state theme control: system, light, dark.
 *
 * "System" is the default and is a real state, not the absence of one — the
 * tokens file leaves `data-theme` unset so `prefers-color-scheme` decides, and
 * sets it explicitly only when the user overrides. That is why the dark palette
 * is defined twice in tokens.css: once under the media query and once under
 * `[data-theme='dark']`.
 */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readStored)

  useEffect(() => {
    const root = document.documentElement
    if (choice === 'system') {
      root.removeAttribute('data-theme')
      window.localStorage.removeItem(STORAGE_KEY)
    } else {
      root.setAttribute('data-theme', choice)
      window.localStorage.setItem(STORAGE_KEY, choice)
    }
  }, [choice])

  const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length] ?? 'system'

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setChoice(next)}
      aria-label={`${LABEL[choice]}. Activate to switch to ${next}.`}
    >
      <Icon
        name={choice === 'dark' ? 'moon' : choice === 'light' ? 'sun' : 'settings'}
        className="theme-toggle__icon"
      />
      {LABEL[choice]}
    </button>
  )
}
