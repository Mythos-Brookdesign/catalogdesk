import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import type { Theme } from '../types/desktop'

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function select(next: Theme) {
    if (saving || next === theme) return
    setError('')
    setSaving(true)
    try {
      if (window.catalogDesktop) {
        const result = await window.catalogDesktop.setTheme(next)
        if (!result.ok) {
          setError(result.error)
          return
        }
      }
      document.documentElement.dataset.theme = next
      setTheme(next)
    } catch {
      setError('Farbschema konnte nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="theme-control">
      <div className="theme-toggle" role="group" aria-label="Farbschema">
        <button
          type="button"
          title="Hellmodus"
          aria-label="Hellmodus"
          aria-pressed={theme === 'light'}
          disabled={saving}
          onClick={() => void select('light')}
        >
          <Sun size={16} />
        </button>
        <button
          type="button"
          title="Dunkelmodus"
          aria-label="Dunkelmodus"
          aria-pressed={theme === 'dark'}
          disabled={saving}
          onClick={() => void select('dark')}
        >
          <Moon size={16} />
        </button>
      </div>
      {error && (
        <span className="theme-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
