import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// TEMP DEBUG overlay
if (import.meta.env.DEV) {
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;bottom:0;left:0;z-index:9999;background:#fee;color:#900;font:11px monospace;max-width:100%;white-space:pre-wrap'
  document.body.appendChild(box)
  window.addEventListener('error', (e) => { box.textContent += e.message + '\n' })
  window.addEventListener('unhandledrejection', (e) => { box.textContent += String(e.reason) + '\n' })
  const origError = console.error.bind(console)
  console.error = (...args: unknown[]) => { box.textContent += args.map(String).join(' ') + '\n'; origError(...args) }
  setInterval(() => {
    const c = document.querySelector('.fmc-viewer canvas') as HTMLCanvasElement | null
    const v = document.querySelector('.fmc-viewer')
    box.textContent += c
      ? `canvas ${c.width}x${c.height} css ${c.clientWidth}x${c.clientHeight} viewer ${v?.clientWidth}x${v?.clientHeight}\n`
      : 'no canvas\n'
  }, 2500)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
