/* Чистое ядро синхронизации дневника со Штурманом (маршрут POST /health/meals,
   раздел 3.1 плана «здоровье в одном месте»). Без fetch, localStorage и DOM:
   что отправлять, что уже подтверждено, какие записи исчезли и требуют
   надгробия, - решают функции этого файла, а отправляет и хранит очередь
   src/state/outbox.ts.

   Модель. Каждая запись дневника (приём по меню или добавленная еда) - одна
   строка SyncEntry с устойчивым id. Сервер хранит по id последнюю версию с
   наибольшим updatedAt, а удаление - это та же строка с deleted: true.
   Клиент помнит, что именно подтверждено (SyncMark по id), и по разнице
   между дневником и подтверждённым получает очередь.

   Числа kcal/p/f/c - СЪЕДЕННОЕ (снапшот полной порции, умноженный на долю), а
   не полная порция: сервер суммирует их по дню как есть, и «съел часть» не
   должна считаться целиком. Доля при этом уходит отдельным полем. */

import { SLOTS } from './types'
import type { AppState, Slot } from './types'

export type SyncKind = 'meal' | 'extra'

/** Одна запись тела POST /health/meals. */
export interface SyncEntry {
  /** Приём меню: `<day>:<slot>`; добавленная еда: её собственный id. */
  id: string
  day: string
  slot: Slot
  kind: SyncKind
  title: string
  /** Только у приёма меню (у добавленной еды статуса нет). */
  status?: string
  fraction: number
  kcal: number
  p: number
  f: number
  c: number
  loggedAt: string
  updatedAt: string
  productsRevision?: string
  deleted?: boolean
}

/** Что клиент знает о подтверждённой записи. day/slot/kind/title нужны, чтобы
    собрать надгробие, когда записи в дневнике уже нет: id добавленной еды дня
    и приёма в себе не несёт. */
export interface SyncMark {
  updatedAt: string
  sig: string
  day: string
  slot: Slot
  kind: SyncKind
  title: string
}

export interface SyncBook {
  /** Подтверждённые сервером записи. */
  synced: Record<string, SyncMark>
  /** Надгробия, ещё не подтверждённые сервером: полное тело удаления. */
  tombstones: Record<string, SyncEntry>
}

export interface SyncDiff {
  /** Что отправить: изменённые и новые записи, затем надгробия. */
  queue: SyncEntry[]
  /** Актуальное множество надгробий (старые, не отменённые возвратом записи, и новые). */
  tombstones: Record<string, SyncEntry>
}

function finiteOrZero(n: number): number {
  return Number.isFinite(n) ? n : 0
}

/** Два знака хватает: на сервере это суммы дня, а не медицинская запись. */
function round2(n: number): number {
  return Math.round(finiteOrZero(n) * 100) / 100
}

function toMs(iso: string): number {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

/** Отпечаток содержимого записи. Нужен потому, что правка доли добавленной
    еды (setExtraFraction) loggedAt не двигает: по одному updatedAt такая
    правка осталась бы невидимой для очереди. */
export function entrySig(e: SyncEntry): string {
  return JSON.stringify([e.kind, e.day, e.slot, e.title, e.status ?? '', e.fraction, e.kcal, e.p, e.f, e.c, e.productsRevision ?? ''])
}

function markOf(e: SyncEntry): SyncMark {
  return { updatedAt: e.updatedAt, sig: entrySig(e), day: e.day, slot: e.slot, kind: e.kind, title: e.title }
}

/** Плоский список записей дневника: приёмы меню и добавленная еда по дням.
    updatedAt = loggedAt: пока запись не перезаписана, версия не меняется. */
export function mealEntriesOf(state: AppState): SyncEntry[] {
  const out: SyncEntry[] = []
  for (const day of Object.keys(state.log).sort()) {
    const dayLog = state.log[day]
    for (const slot of SLOTS) {
      const m = dayLog.meals[slot]
      if (!m) continue
      out.push({
        id: `${day}:${slot}`,
        day,
        slot,
        kind: 'meal',
        title: m.title,
        status: m.status,
        fraction: m.fraction,
        kcal: round2(m.kbju.kcal * m.fraction),
        p: round2(m.kbju.p * m.fraction),
        f: round2(m.kbju.f * m.fraction),
        c: round2(m.kbju.c * m.fraction),
        loggedAt: m.loggedAt,
        updatedAt: m.loggedAt,
        ...(m.productsRevision !== undefined ? { productsRevision: m.productsRevision } : {})
      })
    }
    for (const x of dayLog.extras) {
      out.push({
        id: x.id,
        day,
        slot: x.slot,
        kind: 'extra',
        title: x.title,
        fraction: x.fraction,
        kcal: round2(x.kbju.kcal * x.fraction),
        p: round2(x.kbju.p * x.fraction),
        f: round2(x.kbju.f * x.fraction),
        c: round2(x.kbju.c * x.fraction),
        loggedAt: x.loggedAt,
        updatedAt: x.loggedAt,
        ...(x.kind === 'menu' && x.productsRevision !== undefined ? { productsRevision: x.productsRevision } : {})
      })
    }
  }
  return out
}

/** Версия, которую сервер заведомо примет поверх подтверждённой: свой
    loggedAt, если он новее, иначе момент обнаружения правки (но строго позже
    подтверждённого - сервер игнорирует равные и старые версии). */
function newerThan(prevUpdatedAt: string, candidate: string, nowMs: number): string {
  if (toMs(candidate) > toMs(prevUpdatedAt)) return candidate
  return new Date(Math.max(nowMs, toMs(prevUpdatedAt) + 1)).toISOString()
}

/** Что ещё не подтверждено сервером. Запись в очереди, если подтверждения нет,
    либо она новее подтверждённой, либо её содержимое изменилось. Подтверждённый
    id, которого в дневнике больше нет, даёт надгробие; оно создаётся один раз
    и хранится (его updatedAt не плавает от вызова к вызову). Вернувшаяся запись
    снимает своё неотправленное надгробие. Состояние не меняет. */
export function diffForSync(
  entries: readonly SyncEntry[],
  book: SyncBook,
  nowMs: number
): SyncDiff {
  const present = new Set<string>()
  const queue: SyncEntry[] = []
  for (const e of entries) {
    present.add(e.id)
    const mark = book.synced[e.id]
    if (!mark) {
      queue.push(e)
    } else if (toMs(e.updatedAt) > toMs(mark.updatedAt) || entrySig(e) !== mark.sig) {
      queue.push({ ...e, updatedAt: newerThan(mark.updatedAt, e.updatedAt, nowMs) })
    }
  }

  const tombstones: Record<string, SyncEntry> = {}
  for (const [id, t] of Object.entries(book.tombstones)) {
    if (!present.has(id)) tombstones[id] = t
  }
  for (const [id, mark] of Object.entries(book.synced)) {
    if (present.has(id) || tombstones[id]) continue
    const at = newerThan(mark.updatedAt, mark.updatedAt, nowMs)
    tombstones[id] = {
      id,
      day: mark.day,
      slot: mark.slot,
      kind: mark.kind,
      title: mark.title,
      fraction: 0,
      kcal: 0,
      p: 0,
      f: 0,
      c: 0,
      loggedAt: mark.updatedAt,
      updatedAt: at,
      deleted: true
    }
  }
  for (const t of Object.values(tombstones)) queue.push(t)
  return { queue, tombstones }
}

/** Учитывает подтверждение сервера: по каждому принятому id из отправленного
    пакета. Отправленная запись становится подтверждённой с СВОЕЙ версией
    (если запись успели изменить в полёте, она останется в очереди); принятое
    надгробие стирает и подтверждение, и себя. id вне отправленного пакета
    игнорируется: удалять из очереди можно только то, что реально ушло. */
export function applyAccepted(book: SyncBook, sent: readonly SyncEntry[], accepted: readonly string[]): SyncBook {
  const byId = new Map(sent.map(e => [e.id, e] as const))
  const synced = { ...book.synced }
  const tombstones = { ...book.tombstones }
  for (const id of accepted) {
    const e = byId.get(id)
    if (!e) continue
    if (e.deleted) {
      delete synced[id]
      delete tombstones[id]
    } else {
      synced[id] = markOf(e)
    }
  }
  return { synced, tombstones }
}

/** Пауза перед повтором после `attempts` подряд неудачных попыток: минута,
    дальше вдвое, не больше часа. */
export const RETRY_MIN_MS = 60_000
export const RETRY_MAX_MS = 3_600_000

export function retryDelayMs(attempts: number): number {
  if (attempts <= 0) return 0
  return Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** (attempts - 1))
}

/* ---- строка состояния для настроек ---- */

export type SyncBlock = 'no-token' | 'unauthorized' | null

export interface SyncStatus {
  queued: number
  lastOkAt: string | null
  lastError: string | null
  attempts: number
  blocked: SyncBlock
  sending: boolean
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** «19.10 14:32» в местном времени; сегодняшний год не печатается. */
export function formatSyncTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function recordsWord(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return 'записей'
  switch (n % 10) {
    case 1: return 'запись'
    case 2:
    case 3:
    case 4: return 'записи'
    default: return 'записей'
  }
}

/** Строка состояния: «в очереди N, последняя отправка ..., ошибка ...». */
export function syncStatusText(s: SyncStatus): string {
  const parts: string[] = []
  if (s.blocked === 'no-token') {
    parts.push('Не отправляется: не введён токен Штурмана')
  } else if (s.blocked === 'unauthorized') {
    parts.push('Токен не принят, отправка остановлена до смены токена')
  }
  parts.push(s.queued === 0 ? 'в очереди пусто' : `в очереди ${s.queued} ${recordsWord(s.queued)}`)
  parts.push(s.lastOkAt ? `последняя отправка ${formatSyncTime(s.lastOkAt)}` : 'отправок ещё не было')
  if (s.sending) parts.push('отправляется сейчас')
  if (s.lastError && s.blocked !== 'unauthorized') parts.push(`ошибка: ${s.lastError}`)
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1) + '.'
}
