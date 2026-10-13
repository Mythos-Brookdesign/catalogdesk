import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { AuthGate } from './components/AuthGate'

async function start() {
  let theme = 'light'
  try {
    const result = await window.catalogDesktop?.getTheme()
    if (result?.ok) theme = result.value
  } catch {
    theme = 'light'
  }
  document.documentElement.dataset.theme = theme
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuthGate />
    </StrictMode>,
  )
}

void start()
