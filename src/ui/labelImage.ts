/* Сжатие снимка наклейки перед отправкой на разбор (контракт 1.1 плана).
   Снимок с телефона весит мегабайты, а воркер принимает не больше ~470 КБ
   base64, поэтому клиент ужимает его до targetBytes: JPEG через canvas с
   падающим качеством, а если и на минимальном качестве велик, с меньшей
   длинной стороной.

   Загрузка идёт через <img> с object URL, а не через createImageBitmap:
   на iOS Safari <img> применяет EXIF-ориентацию сам, и повёрнутый снимок
   приходит на разбор правильной стороной. Результат живёт только в
   возвращаемом значении: в состояние приложения и localStorage он не
   попадает (решение D6). */

export interface CompressedLabelPhoto {
  /** Base64 без префикса data:. */
  base64: string
  mime: 'image/jpeg'
  /** Размер JPEG в байтах (до base64). */
  bytes: number
  width: number
  height: number
}

export interface CompressLabelOptions {
  /** Длинная сторона в пикселях при первой попытке. */
  maxSide?: number
  /** Целевой размер JPEG в байтах. */
  targetBytes?: number
  /** Нижняя граница качества JPEG, ниже которой сжатие переходит к уменьшению стороны. */
  minQuality?: number
}

export const LABEL_UNREADABLE_ERROR = 'Снимок не читается как изображение'
export const LABEL_TOO_BIG_ERROR = 'Не удалось ужать снимок до допустимого размера. Сними ближе или при лучшем свете.'

const DEFAULT_MAX_SIDE = 2000
const DEFAULT_TARGET_BYTES = 350_000
const DEFAULT_MIN_QUALITY = 0.5
/** Лестница качества: от лучшего к худшему, не ниже minQuality. */
const QUALITY_STEPS = [0.82, 0.7, 0.6, 0.5]
/** Запасные длинные стороны после первой попытки. Ниже 1200 px мелкий шрифт состава уже не читается. */
const FALLBACK_SIDES = [1600, 1200]

function loadImage(file: Blob): Promise<{ img: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(file)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ img, url })
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(LABEL_UNREADABLE_ERROR))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
}

/** Blob -> base64 без префикса data:. FileReader не раздувает стек, в отличие от btoa на больших строках. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(LABEL_UNREADABLE_ERROR))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error(LABEL_UNREADABLE_ERROR))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma === -1 ? '' : result.slice(comma + 1))
    }
    reader.readAsDataURL(blob)
  })
}

export async function compressLabelPhoto(
  file: Blob,
  options: CompressLabelOptions = {}
): Promise<CompressedLabelPhoto> {
  const maxSide = options.maxSide ?? DEFAULT_MAX_SIDE
  const targetBytes = options.targetBytes ?? DEFAULT_TARGET_BYTES
  const minQuality = options.minQuality ?? DEFAULT_MIN_QUALITY

  const { img, url } = await loadImage(file)
  try {
    const srcW = img.naturalWidth
    const srcH = img.naturalHeight
    if (srcW === 0 || srcH === 0) throw new Error(LABEL_UNREADABLE_ERROR)

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(LABEL_UNREADABLE_ERROR)

    const sides = [maxSide, ...FALLBACK_SIDES.filter(s => s < maxSide)]
    const qualities = QUALITY_STEPS.filter(q => q >= minQuality)

    for (const side of sides) {
      const scale = Math.min(1, side / Math.max(srcW, srcH))
      const width = Math.max(1, Math.round(srcW * scale))
      const height = Math.max(1, Math.round(srcH * scale))
      canvas.width = width
      canvas.height = height
      // JPEG без прозрачности: PNG-скриншот иначе получил бы чёрный фон
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)

      for (const quality of qualities) {
        const blob = await canvasToBlob(canvas, quality)
        if (!blob) throw new Error(LABEL_UNREADABLE_ERROR)
        if (blob.size <= targetBytes) {
          return { base64: await blobToBase64(blob), mime: 'image/jpeg', bytes: blob.size, width, height }
        }
      }
    }
    throw new Error(LABEL_TOO_BIG_ERROR)
  } finally {
    URL.revokeObjectURL(url)
  }
}
