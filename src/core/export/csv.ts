/* Канал «CSV за день». Пытается системный шаринг файла (navigator.share);
   если файловый шаринг недоступен — честно отдаёт ok:true с пометкой, что CSV
   показан текстом (сам текст рисует экран через buildDayCsv). Скачивание через
   <a download> в standalone-PWA на iOS ненадёжно, поэтому на него не опираемся. */

import { buildDayCsv } from './format.ts'
import type { Availability, ExportChannel, ExportPayload, ExportResult } from './types.ts'

export const CSV_NOT_A_DAY_ERROR = 'CSV доступен только для выгрузки целого дня'
export const CSV_FALLBACK_NOTE = 'CSV показан текстом для копирования'
export const CSV_SHARED_NOTE = 'Файл отправлен'

interface ShareCapableNavigator {
  share: (data: { files?: File[]; title?: string }) => Promise<void>
  canShare?: (data: { files?: File[] }) => boolean
}

function getShareNavigator(): ShareCapableNavigator | undefined {
  const nav = (globalThis as unknown as { navigator?: Partial<ShareCapableNavigator> }).navigator
  if (nav && typeof nav.share === 'function') return nav as ShareCapableNavigator
  return undefined
}

function canShareFiles(nav: ShareCapableNavigator, file: unknown): boolean {
  if (typeof nav.canShare !== 'function') return false
  try {
    return nav.canShare({ files: [file as File] })
  } catch {
    return false
  }
}

export function csvChannel(): ExportChannel {
  return {
    id: 'csv',
    title: 'CSV за день',
    availability(): Availability {
      // Канал построения CSV работает всегда: в худшем случае текст показывается
      // на экране для ручного копирования — это не сбой, а предусмотренный путь.
      return { available: true }
    },
    async send(payload: ExportPayload): Promise<ExportResult> {
      if (payload.kind !== 'day') {
        return { ok: false, error: CSV_NOT_A_DAY_ERROR }
      }
      const csv = buildDayCsv(payload)
      const nav = getShareNavigator()
      if (nav) {
        const FileCtor = (globalThis as unknown as { File?: typeof File }).File
        const BlobCtor = (globalThis as unknown as { Blob?: typeof Blob }).Blob
        if (FileCtor && BlobCtor) {
          const blob = new BlobCtor([csv], { type: 'text/csv;charset=utf-8' })
          const file = new FileCtor([blob], `eda-${payload.date}.csv`, { type: 'text/csv' })
          if (canShareFiles(nav, file)) {
            try {
              await nav.share({ files: [file], title: `Дневник ${payload.date}` })
              return { ok: true, note: CSV_SHARED_NOTE }
            } catch (e) {
              const err = e as { name?: string; message?: string }
              if (err?.name === 'AbortError') {
                return { ok: false, error: 'Отправка отменена' }
              }
              return { ok: false, error: `Не удалось отправить файл: ${err?.message ?? String(e)}` }
            }
          }
        }
      }
      return { ok: true, note: CSV_FALLBACK_NOTE }
    }
  }
}
