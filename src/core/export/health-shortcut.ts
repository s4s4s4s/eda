/* Канал «Apple Health через команду Shortcuts». Механика разведана и зафиксирована:
   ссылка shortcuts://x-callback-url/run-shortcut?name=...&input=text&text=<JSON>
   &x-success=...&x-cancel=...&x-error=...

   Приложение из браузера не может само узнать, дошла ли запись до Health — поэтому
   send всегда возвращает ok:'pending': подтверждение приходит только возвратом
   x-success на readCallback. Таймера «наверное дошло» нет и не будет: не вернулся
   callback — значит не подтверждено. */

import { NUTRIENT_KEYS } from '../types.ts'
import type { Kbju, NutrientKey, NutrientTotals } from '../types.ts'
import { scaleNutrientTotals } from '../nutrition.ts'
import type { Availability, ExportChannel, ExportPayload, ExportResult } from './types.ts'

const NOT_IOS_REASON = 'Запись в Apple Health работает только на iPhone'
const NO_SHORTCUT_REASON = 'Не задано имя команды в настройках. Как её собрать — в справке'

interface MinimalNavigator {
  userAgent?: string
  maxTouchPoints?: number
}

function getNavigator(): MinimalNavigator | undefined {
  return (globalThis as unknown as { navigator?: MinimalNavigator }).navigator
}

/** iPhone/iPad — по userAgent, плюс iPadOS 13+ в режиме «рабочего стола» маскируется
    под Macintosh и отличается только сенсорными точками. */
export function isIOS(): boolean {
  const nav = getNavigator()
  if (!nav) return false
  const ua = nav.userAgent ?? ''
  if (/iPhone|iPad|iPod/.test(ua)) return true
  if (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return true
  return false
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function eatenKbju(payload: ExportPayload): Kbju {
  if (payload.kind === 'meal') {
    return {
      kcal: payload.kbju.kcal * payload.fraction,
      p: payload.kbju.p * payload.fraction,
      f: payload.kbju.f * payload.fraction,
      c: payload.kbju.c * payload.fraction
    }
  }
  return payload.total
}

/** Микрограммы теряются при округлении до десятых (B12 идёт сотыми долями мкг),
    поэтому нутриенты округляются до тысячных — этого хватает и датасету. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Съеденные нутриенты полезной нагрузки: у приёма снапшот полный, долю
    применяем здесь (то же соглашение, что и для kbju); у дня сумма уже съеденная. */
function eatenNutrientTotals(payload: ExportPayload): NutrientTotals {
  return payload.kind === 'meal'
    ? scaleNutrientTotals(payload.nutrients, payload.fraction)
    : payload.nutrients
}

/** Нутриенты для словаря «Команд». В словарь попадают ТОЛЬКО те, о которых
    известно хоть что-то (known > 0). Нутриент без данных не кладётся вовсе:
    пусть Health лучше не знает, чем знает неверное — ноль там неотличим от
    измеренного нуля и молча испортит статистику за месяцы. Частичное знание
    (known < total) отправляется: это занижение, но оно посчитано по реальным
    позициям, а его неполнота видна на экране и в CSV. */
export function healthNutrients(payload: ExportPayload): Partial<Record<NutrientKey, number>> {
  const totals = eatenNutrientTotals(payload)
  const dict: Partial<Record<NutrientKey, number>> = {}
  for (const key of NUTRIENT_KEYS) {
    const total = totals[key]
    if (total.known === 0) continue
    dict[key] = round3(total.value)
  }
  return dict
}

/** Локальная дата-время для записи в Health. payload несёт только дату (день
    дневника), время — момент фактического экспорта (передаётся снаружи для
    тестируемости). */
function healthPayloadJson(payload: ExportPayload, now: Date): string {
  const k = eatenKbju(payload)
  const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`
  return JSON.stringify({
    kcal: Math.round(k.kcal),
    protein: round1(k.p),
    fat: round1(k.f),
    carbs: round1(k.c),
    ...healthNutrients(payload),
    date: `${payload.date}T${time}`
  })
}

function makeOperationId(now: Date): string {
  return `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Собирает ссылку запуска команды. Чистая функция — тестируется без navigator/location. */
export function buildShortcutUrl(name: string, payload: ExportPayload, now: Date, appUrl: string): string {
  const id = makeOperationId(now)
  const json = healthPayloadJson(payload, now)
  const successUrl = `${appUrl}?exported=${encodeURIComponent(id)}`
  const params = [
    `name=${encodeURIComponent(name)}`,
    'input=text',
    `text=${encodeURIComponent(json)}`,
    `x-success=${encodeURIComponent(successUrl)}`,
    `x-cancel=${encodeURIComponent(appUrl)}`,
    `x-error=${encodeURIComponent(appUrl)}`
  ].join('&')
  return `shortcuts://x-callback-url/run-shortcut?${params}`
}

/** Достаёт id операции из query-строки возврата (?exported=<id>). null, если параметра нет. */
export function readCallback(search: string): string | null {
  const params = new URLSearchParams(search)
  const id = params.get('exported')
  return id && id.length > 0 ? id : null
}

export function healthShortcutChannel(getShortcutName: () => string, appUrl: string): ExportChannel {
  function checkAvailability(): Availability {
    if (!isIOS()) return { available: false, reason: NOT_IOS_REASON }
    const name = getShortcutName().trim()
    if (!name) return { available: false, reason: NO_SHORTCUT_REASON }
    return { available: true }
  }

  return {
    id: 'health-shortcut',
    title: 'Apple Health (через Команды)',
    availability: checkAvailability,
    async send(payload: ExportPayload): Promise<ExportResult> {
      const avail = checkAvailability()
      if (!avail.available) return { ok: false, error: avail.reason }
      const url = buildShortcutUrl(getShortcutName().trim(), payload, new Date(), appUrl)
      const loc = (globalThis as unknown as { location?: { href: string } }).location
      if (loc) loc.href = url
      return { ok: 'pending', note: 'Открываю Команды. Запись подтвердится, когда команда вернёт вас сюда' }
    }
  }
}
