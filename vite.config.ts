import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' '))
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt', а не 'autoUpdate': новая версия скачивается сама, но подменяет
      // экран только по нажатию человека. Тихая подмена под руками — это потеря
      // контроля: цифры на экране меняются, и непонятно почему.
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png', 'favicon-32.png'],
      manifest: {
        id: './',
        name: 'Еда — приём и КБЖУ',
        short_name: 'Еда',
        description: 'Текущий приём по восьмидневному циклу меню: что уже в контейнере, что досыпать, и сколько КБЖУ',
        lang: 'ru',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: './',
        scope: '.',
        categories: ['food', 'lifestyle', 'health'],
        background_color: '#12100E',
        theme_color: '#12100E',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        /* Меню и справочник продуктов вкомпилированы в бандл (см. src/data/load.ts),
           сеть приложению не нужна вообще — кэшируем только статику: код, иконки
           и сплэши iOS (apple-touch-startup-image, без них — белый экран при
           запуске офлайн). Явный список png вместо общей маски `*.png` — чтобы
           случайный крупный файл в public/ не раздул прекеш молча. */
        globPatterns: [
          '**/*.{js,css,html,woff2}',
          'icon-192.png',
          'icon-512.png',
          'icon-512-maskable.png',
          'apple-touch-icon.png',
          'favicon-32.png',
          'splash-*.png'
        ]
      }
    })
  ]
})
