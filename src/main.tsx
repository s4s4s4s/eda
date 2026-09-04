import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './ui/theme.css'
import './ui/layout.css'
import './ui/summary.css'
import './ui/meal.css'
import './ui/sheets.css'
import App from './ui/App.tsx'
import { announceUpdateReady } from './ui/swUpdate.ts'

/* Меню и продукты вкомпилированы в бандл (src/data/load.ts), сеть приложению
   не нужна вообще — service worker нужен только для офлайн-работы.

   Новая версия скачивается сама, но НЕ подменяет экран молча: приложение
   говорит об этом полосой и ждёт нажатия. Человек может стоять с телефоном
   над контейнером и записывать приём — перезагрузка под руками в этот момент
   выглядит как сбой, а не как забота. */
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    announceUpdateReady(() => updateSW(true))
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
