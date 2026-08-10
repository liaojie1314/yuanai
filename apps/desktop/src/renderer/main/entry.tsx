import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './chat.css'
import { startDesktopRenderer } from '../shared/start-renderer'
import { RendererRoot } from '../shared/RendererRoot'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Renderer root element is missing')
}

startDesktopRenderer(async () => {
  const { App } = await import('./App')
  createRoot(rootElement).render(
    <StrictMode>
      <RendererRoot>
        <App />
      </RendererRoot>
    </StrictMode>
  )
})
