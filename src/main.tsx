import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './ui/theme.css'
import './ui/screen.css'
import './ui/sheets.css'
import App from './ui/App.tsx'

// Меню и продукты вкомпилированы в бандл (src/data/load.ts), сеть приложению
// не нужна вообще — регистрируем service worker для офлайн-работы и молча
// подхватываем новую версию: приём один-два раза в день, ждать смысла нет.
registerSW({ immediate: true })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
