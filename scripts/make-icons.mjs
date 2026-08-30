import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

/* Иконка PWA «Еда»: тарелка с вилкой и ножом. Тёмный фон, светлый знак —
   читается значком 48×48 на экране телефона, никакого текста. Тот же
   способ и те же размеры/имена файлов, что и в dev/sat-srs/scripts/make-icons.mjs:
   имена должны совпадать один в один с манифестом в vite.config.ts. */

const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a2a1f"/><stop offset="1" stop-color="#1a120c"/>
    </linearGradient>
  </defs>`

/** Тарелка с вилкой (слева) и ножом (справа), центр 256,256 в базовой сетке 512×512. */
const plate = (cx, cy, scale) => `
  <g transform="translate(${cx} ${cy}) scale(${scale}) translate(-100 -100)">
    <circle cx="100" cy="100" r="92" fill="none" stroke="#f2e9dd" stroke-width="10"/>
    <circle cx="100" cy="100" r="60" fill="none" stroke="#f2e9dd" stroke-width="6" opacity=".55"/>
    <g fill="#f2e9dd">
      <rect x="46" y="30" width="10" height="70" rx="5"/>
      <rect x="64" y="30" width="10" height="46" rx="5"/>
      <rect x="82" y="30" width="10" height="46" rx="5"/>
      <path d="M46 76 Q46 100 64 100 L64 100 Q82 100 82 76 L82 60 L46 60 Z" fill="#f2e9dd"/>
      <rect x="59" y="98" width="10" height="76" rx="5"/>
    </g>
    <g fill="#f2e9dd">
      <path d="M146 30 C130 30 122 46 122 66 C122 84 132 96 144 100 L144 174 L156 174 L156 30 Z"/>
    </g>
  </g>`

/** основная иконка: круглая сцена на фоне + опциональная золотая рамка (для 512-с-паддингом) */
const svg = (pad, frame) => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  ${defs}
  <rect x="${pad}" y="${pad}" width="${512 - 2 * pad}" height="${512 - 2 * pad}" rx="${pad > 0 ? 110 : 0}" fill="url(#bg)"/>
  ${plate(256, 256, 1.85)}
  ${frame ? '<rect x="26" y="26" width="460" height="460" rx="96" fill="none" stroke="#e8c07a" stroke-opacity=".35" stroke-width="4"/>' : ''}
</svg>`

/** favicon: крупный кроп без внешнего кольца, читается в 32px */
const svgSmall = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  ${defs}
  <rect width="512" height="512" fill="url(#bg)"/>
  ${plate(256, 256, 2.5)}
</svg>`

mkdirSync('public', { recursive: true })

const jobs = [
  ['public/icon-512.png', svg(24, true), 512],
  ['public/icon-512-maskable.png', svg(0, false), 512],
  ['public/icon-192.png', svg(24, false), 192],
  ['public/apple-touch-icon.png', svg(0, false), 180],
  ['public/favicon-32.png', svgSmall, 32]
]

for (const [out, s, size] of jobs) {
  await sharp(Buffer.from(s)).resize(size, size).png().toFile(out)
  console.log(out)
}
