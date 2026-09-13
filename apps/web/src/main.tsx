import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app/app.tsx'
import './styles/globals.css'

const container = document.getElementById('root')
if (container === null) {
  throw new Error('Missing #root element')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
