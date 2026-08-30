import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

/* Иконка PWA «Еда»: миска в профиль, одна сплошная янтарная фигура на тёмном
   фоне. Никаких приборов и никаких диаграмм/секторов — первый заход (круг +
   янтарный сектор) читался как значок аналитики, а не еды, и спорил с главным
   правилом декларации («сначала еда, потом числа»). Один силуэт держит
   контраст и читается в 48px. Фон непрозрачный тёмный `--bg` (#12100E),
   фигура — единственный акцент `--accent` (#E8B45C), см. DESIGN.md, раздел
   «Цвет». Тот же инструмент (sharp, растеризация SVG), что и в
   dev/sat-srs/scripts/make-icons.mjs; имена файлов совпадают один в один с
   манифестом в vite.config.ts. */

const BG = '#12100E'
const ACCENT = '#E8B45C'

/* Геометрия миски на базовой сетке 512×512, центр силуэта на (256,256):
   верхний край — горизонталь y=162 от x=92 до x=420, у обоих верхних углов
   венчик разворачивается наружу до x≈434/78 (на 14px шире тела), стенки почти
   вертикальны у краёв и заворачивают к центру только во второй половине
   высоты, нижняя точка (256,354) скруглена, не заострена. Крайние точки
   (78,180), (434,180), (256,354) и рим (92,162)/(420,162) лежат внутри круга
   радиусом 205 по центру холста — это safe zone 80% для maskable-варианта
   (проверено арифметикой: max расстояние до центра ≈193.5px < 205px). */
const bowlPath =
  'M 92,162 L 420,162 ' +
  'Q 434,164 434,180 ' +
  'C 432,266 392,346 256,354 ' +
  'C 120,346 80,266 78,180 ' +
  'Q 78,164 92,162 Z'

const bowl = () => `<path d="${bowlPath}" fill="${ACCENT}"/>`

/** Базовая иконка 512×512: непрозрачный тёмный фон + миска. */
const iconSvg = () => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BG}"/>
  ${bowl()}
</svg>`

/** Сплэш-экран iOS: полноэкранный тёмный фон с миской по центру, без текста —
    apple-touch-startup-image, статичная картинка, что видна долю секунды при
    запуске установленного приложения (без неё — белая вспышка). Миска
    масштабируется от базовой сетки 512×512 и центрируется на экран. */
const splashSvg = (w, h) => {
  const scale = (Math.min(w, h) * 0.34) / 512
  const tx = w / 2 - 256 * scale
  const ty = h / 2 - 256 * scale
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${BG}"/>
  <g transform="translate(${tx} ${ty}) scale(${scale})">${bowl()}</g>
</svg>`
}

/* Экраны iPhone от SE (2016) до 16 Pro Max, портретная ориентация: точки (CSS px),
   плотность пикселей и физический размер сплэша в пикселях — тот же расчёт, каким
   Apple описывает apple-touch-startup-image в media-запросах. */
const splashDevices = [
  { w: 320, h: 568, dpr: 2 }, // iPhone SE (1st gen)
  { w: 375, h: 667, dpr: 2 }, // iPhone 6/7/8, SE 2/3
  { w: 414, h: 736, dpr: 3 }, // iPhone 6/7/8 Plus
  { w: 414, h: 896, dpr: 2 }, // iPhone XR/11
  { w: 375, h: 812, dpr: 3 }, // iPhone X/XS/11 Pro, 12/13 mini
  { w: 414, h: 896, dpr: 3 }, // iPhone XS Max/11 Pro Max
  { w: 390, h: 844, dpr: 3 }, // iPhone 12/12 Pro/13/13 Pro/14
  { w: 428, h: 926, dpr: 3 }, // iPhone 12/13 Pro Max, 14 Plus
  { w: 393, h: 852, dpr: 3 }, // iPhone 14 Pro/15/15 Pro/16
  { w: 430, h: 932, dpr: 3 }, // iPhone 14 Pro Max/15 Plus/15 Pro Max/16 Plus
  { w: 402, h: 874, dpr: 3 }, // iPhone 16 Pro
  { w: 440, h: 956, dpr: 3 } // iPhone 16 Pro Max
]

mkdirSync('public', { recursive: true })

const jobs = [
  ['public/icon-512.png', iconSvg(), 512, 512],
  ['public/icon-512-maskable.png', iconSvg(), 512, 512],
  ['public/icon-192.png', iconSvg(), 192, 192],
  ['public/apple-touch-icon.png', iconSvg(), 180, 180],
  ['public/favicon-32.png', iconSvg(), 32, 32]
]

for (const { w, h, dpr } of splashDevices) {
  const pw = w * dpr
  const ph = h * dpr
  jobs.push([`public/splash-${pw}x${ph}.png`, splashSvg(pw, ph), pw, ph])
}

for (const [out, s, w, h] of jobs) {
  await sharp(Buffer.from(s)).resize(w, h).png().toFile(out)
  console.log(out)
}
