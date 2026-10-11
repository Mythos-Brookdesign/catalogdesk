import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.tsx'

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
      <App />
    </StrictMode>,
  )
}

void start()
