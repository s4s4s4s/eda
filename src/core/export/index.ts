/* Реестр каналов выгрузки. Единственное место, куда добавляется новый канал —
   правка тут не требует правки экрана: ExportSheet просто рисует то, что вернул
   buildChannels. */

import { clipboardChannel } from './clipboard.ts'
import { csvChannel } from './csv.ts'
import { healthShortcutChannel } from './health-shortcut.ts'
import type { Availability, ExportChannel, ExportPayload, ExportResult } from './types.ts'

export interface BuildChannelsOptions {
  /** Имя команды Apple Shortcuts из настроек. Пусто — канал Health недоступен. */
  getShortcutName: () => string
  /** Адрес, на который команда вернётся после записи (x-success/x-cancel/x-error). */
  appUrl: string
}

/** Причина отказа ОДНА на все три канала — приём пропущен, отправлять нечего.
    Живёт в одном месте (см. withSkippedGuard ниже), а не копией в каждом
    канале: буфер, CSV и Health отправили бы одни и те же 29 нулей и
    kcal: 0 — то есть съеденное, которого не было, независимо от того, как
    устроен конкретный канал. */
export const SKIPPED_MEAL_REASON = 'приём пропущен — выгружать нечего'

/** Приём пропущен (или доля 0) — ExportPayload вида 'meal' не несёт статус
    отдельно (это снапшот kbju/nutrients + доля), поэтому пропуск виден по
    fraction === 0: съесть 0 долю от чего угодно — то же самое, что не есть. */
function isSkippedMealPayload(payload: ExportPayload): boolean {
  return payload.kind === 'meal' && payload.fraction === 0
}

/** Единая точка, где к «своей» доступности канала (браузер поддерживает
    буфер, телефон — iOS, имя команды задано) примешивается доступность,
    зависящая от того, что именно отправляем. Оборачивает КАЖДЫЙ канал одним
    и тем же способом — добавлять проверку в clipboard.ts/csv.ts/
    health-shortcut.ts по отдельности означало бы три места, которые рано
    или поздно разойдутся. */
function withSkippedGuard(channel: ExportChannel): ExportChannel {
  return {
    ...channel,
    availability(payload?: ExportPayload): Availability {
      if (payload && isSkippedMealPayload(payload)) {
        return { available: false, reason: SKIPPED_MEAL_REASON }
      }
      return channel.availability(payload)
    }
  }
}

/** Порядок в массиве — порядок показа на экране: буфер, CSV, Health. */
export function buildChannels(opts: BuildChannelsOptions): ExportChannel[] {
  return [
    clipboardChannel(),
    csvChannel(),
    healthShortcutChannel(opts.getShortcutName, opts.appUrl)
  ].map(withSkippedGuard)
}

/** Точка выбора канала: недоступный канал не получает вызова send вообще —
    availability проверяется здесь, а не оставляется на совесть вызывающего.
    Payload передаётся в availability же — доступность зависит не только от
    самого канала, но и от того, что мы пытаемся отправить (см. withSkippedGuard). */
export async function sendViaChannel(channel: ExportChannel, payload: ExportPayload): Promise<ExportResult> {
  const avail = channel.availability(payload)
  if (!avail.available) return { ok: false, error: avail.reason }
  return channel.send(payload)
}

export type { Availability, ExportChannel, ExportPayload, ExportResult } from './types.ts'
export { readCallback, buildShortcutUrl, isIOS, healthNutrients, NO_HEALTHKIT_TYPE } from './health-shortcut.ts'
export { CSV_FALLBACK_NOTE, CSV_SHARED_NOTE, CSV_NOT_A_DAY_ERROR } from './csv.ts'
export {
  buildDayCsv, CSV_HEADER, CSV_NUTRIENT_COLUMNS, dayClipboardText, eatenNutrientsOf, eatenOf,
  formatDateShort, formatNutrientAmount, mealClipboardText, NO_DATA_TEXT, nutrientLine, nutrientLines
} from './format.ts'
