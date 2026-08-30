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
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'favicon-32.png'],
      manifest: {
        name: 'Еда — приём и КБЖУ',
        short_name: 'Еда',
        description: 'Что в этом приёме, что досыпать, сколько КБЖУ',
        lang: 'ru',
        display: 'standalone',
        start_url: './',
        scope: '.',
        background_color: '#fbf7f0',
        theme_color: '#fbf7f0',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        /* Меню и справочник продуктов вкомпилированы в бандл (см. src/data/load.ts),
           сеть приложению не нужна вообще — кэшируем только статику. */
        globPatterns: ['**/*.{js,css,html,png,woff2}']
      }
    })
  ]
})
