/* Реестр каналов выгрузки. Единственное место, куда добавляется новый канал —
   правка тут не требует правки экрана: ExportSheet просто рисует то, что вернул
   buildChannels. */

import { clipboardChannel } from './clipboard.ts'
import { csvChannel } from './csv.ts'
import { healthShortcutChannel } from './health-shortcut.ts'
import type { ExportChannel, ExportPayload, ExportResult } from './types.ts'

export interface BuildChannelsOptions {
  /** Имя команды Apple Shortcuts из настроек. Пусто — канал Health недоступен. */
  getShortcutName: () => string
  /** Адрес, на который команда вернётся после записи (x-success/x-cancel/x-error). */
  appUrl: string
}

/** Порядок в массиве — порядок показа на экране: буфер, CSV, Health. */
export function buildChannels(opts: BuildChannelsOptions): ExportChannel[] {
  return [
    clipboardChannel(),
    csvChannel(),
    healthShortcutChannel(opts.getShortcutName, opts.appUrl)
  ]
}

/** Точка выбора канала: недоступный канал не получает вызова send вообще —
    availability проверяется здесь, а не оставляется на совесть вызывающего. */
export async function sendViaChannel(channel: ExportChannel, payload: ExportPayload): Promise<ExportResult> {
  const avail = channel.availability()
  if (!avail.available) return { ok: false, error: avail.reason }
  return channel.send(payload)
}

export type { Availability, ExportChannel, ExportPayload, ExportResult } from './types.ts'
export { readCallback, buildShortcutUrl, isIOS, healthNutrients } from './health-shortcut.ts'
export { CSV_FALLBACK_NOTE, CSV_SHARED_NOTE, CSV_NOT_A_DAY_ERROR } from './csv.ts'
export {
  buildDayCsv, CSV_HEADER, CSV_NUTRIENT_COLUMNS, dayClipboardText, eatenNutrientsOf, eatenOf,
  formatDateShort, formatNutrientAmount, mealClipboardText, NO_DATA_TEXT, nutrientLine, nutrientLines
} from './format.ts'
