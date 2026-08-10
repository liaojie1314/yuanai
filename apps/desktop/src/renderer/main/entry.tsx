import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './chat.css'
import { startDesktopRenderer } from '../shared/start-renderer'
import { RendererRoot } from '../shared/RendererRoot'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Renderer root element is missing')
}

startDesktopRenderer(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <RendererRoot>
        <App />
      </RendererRoot>
    </StrictMode>
  )
})
