/* Очередь синхронизации дневника со Штурманом: хранение в localStorage под
   своим ключом OUTBOX_KEY и движок отправки. Формат AppState очередь не
   трогает - она лежит отдельно (раздел 3.2 плана «здоровье в одном месте»).

   Движок (createSyncEngine) получает всё внешнее параметрами - состояние,
   токен, хранилище, fetchFn, часы и таймеры, - поэтому тесты гоняют его без
   браузера. Правила:
   - один запрос в полёте: повторный пуск во время отправки лишь помечает, что
     после неё нужно ещё раз сверить дневник;
   - запись уходит из очереди только по `accepted` из ответа;
   - после ошибки пауза 1 минута, дальше вдвое, не больше часа; пуск после
     сохранения паузу уважает, пуск по online/visible/старту/кнопке - нет;
   - 401 останавливает повторы до смены токена. Факт остановки живёт только в
     памяти вкладки: токен (даже его хэш) в очередь не пишется, после
     перезагрузки будет одна пробная отправка и снова остановка. */

import { MEALS_BATCH_MAX, postMeals, SHTURMAN_BASE } from '../core/healthClient'
import { applyAccepted, diffForSync, mealEntriesOf, retryDelayMs } from '../core/sync'
import type { SyncBook, SyncEntry, SyncMark, SyncStatus } from '../core/sync'
import type { AppState, Slot } from '../core/types'
import { SLOTS } from '../core/types'

/** Ключ localStorage очереди - единственное место, где он назван. */
export const OUTBOX_KEY = 'eda.sync.v1'

export interface OutboxState extends SyncBook {
  lastOkAt: string | null
  lastError: string | null
  attempts: number
}

export function emptyOutbox(): OutboxState {
  return { synced: {}, tombstones: {}, lastOkAt: null, lastError: null, attempts: 0 }
}

type OutboxStorage = Pick<Storage, 'getItem' | 'setItem'>

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isSlot(v: unknown): v is Slot {
  return typeof v === 'string' && (SLOTS as readonly string[]).includes(v)
}

function isKind(v: unknown): v is 'meal' | 'extra' {
  return v === 'meal' || v === 'extra'
}

function readMark(v: unknown): SyncMark | null {
  if (!isPlainObject(v)) return null
  const { updatedAt, sig, day, slot, kind, title } = v
  if (typeof updatedAt !== 'string' || typeof sig !== 'string' || typeof day !== 'string' || typeof title !== 'string') return null
  if (!isSlot(slot) || !isKind(kind)) return null
  return { updatedAt, sig, day, slot, kind, title }
}

function readTombstone(v: unknown): SyncEntry | null {
  if (!isPlainObject(v) || v.deleted !== true) return null
  const { id, day, slot, kind, title, loggedAt, updatedAt } = v
  if (typeof id !== 'string' || typeof day !== 'string' || typeof title !== 'string') return null
  if (typeof loggedAt !== 'string' || typeof updatedAt !== 'string' || !isSlot(slot) || !isKind(kind)) return null
  return { id, day, slot, kind, title, fraction: 0, kcal: 0, p: 0, f: 0, c: 0, loggedAt, updatedAt, deleted: true }
}

/** Читает очередь и никогда не бросает: недоступное или битое хранилище даёт
    пустую очередь. Это безопасно - потеря `synced` означает лишь повторную
    отправку (сервер идемпотентен по id и updatedAt); битая запись выпадает
    сама, соседние остаются. */
export function loadOutbox(storage: OutboxStorage | null): OutboxState {
  if (!storage) return emptyOutbox()
  let raw: string | null
  try {
    raw = storage.getItem(OUTBOX_KEY)
  } catch {
    return emptyOutbox()
  }
  if (raw === null) return emptyOutbox()
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return emptyOutbox()
  }
  if (!isPlainObject(json)) return emptyOutbox()
  const synced: Record<string, SyncMark> = {}
  if (isPlainObject(json.synced)) {
    for (const [id, v] of Object.entries(json.synced)) {
      const mark = readMark(v)
      if (mark) synced[id] = mark
    }
  }
  const tombstones: Record<string, SyncEntry> = {}
  if (isPlainObject(json.tombstones)) {
    for (const [id, v] of Object.entries(json.tombstones)) {
      const t = readTombstone(v)
      if (t && t.id === id) tombstones[id] = t
    }
  }
  return {
    synced,
    tombstones,
    lastOkAt: typeof json.lastOkAt === 'string' ? json.lastOkAt : null,
    lastError: typeof json.lastError === 'string' ? json.lastError : null,
    attempts: typeof json.attempts === 'number' && Number.isInteger(json.attempts) && json.attempts >= 0 ? json.attempts : 0
  }
}

/** Пишет очередь; false - не удалось (квота, приватный режим). */
export function saveOutbox(storage: OutboxStorage | null, outbox: OutboxState): boolean {
  if (!storage) return false
  try {
    storage.setItem(OUTBOX_KEY, JSON.stringify(outbox))
    return true
  } catch {
    return false
  }
}

export type SyncTrigger = 'save' | 'start' | 'online' | 'visible' | 'manual' | 'timer'

export interface TimerApi {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export interface SyncEngineDeps {
  /** Свежее состояние дневника на момент пуска. */
  getState: () => AppState
  getToken: () => string
  storage: OutboxStorage | null
  fetchFn?: typeof fetch
  base?: string
  now?: () => number
  timers?: TimerApi
}

export interface SyncEngine {
  /** Пуск отправки. Возвращённый промис завершается, когда цепочка отправок
      остановилась (очередь пуста, ошибка, пауза или блокировка). */
  trigger(reason: SyncTrigger): Promise<void>
  /** «Отправить весь дневник»: забыть подтверждённое и отправить заново. */
  resendAll(): Promise<void>
  /** Забыть подтверждённое и надгробия БЕЗ отправки удалений: дневник стёрт
      целиком (очистка или потеря хранилища), а история на сервере остаётся. */
  forget(): void
  status(): SyncStatus
  subscribe(listener: () => void): () => void
  dispose(): void
}

const REASONS_RESPECTING_PAUSE: ReadonlySet<SyncTrigger> = new Set(['save'])

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const fetchFn = deps.fetchFn ?? fetch
  const base = deps.base ?? SHTURMAN_BASE
  const now = deps.now ?? (() => Date.now())
  const timers: TimerApi = deps.timers ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
  }

  let outbox = loadOutbox(deps.storage)
  let haltedToken: string | null = null
  let nextAttemptAt = 0
  let sending = false
  let running: Promise<void> | null = null
  let again = false
  let timer: unknown = null
  let disposed = false
  const listeners = new Set<() => void>()

  function notify(): void {
    for (const l of [...listeners]) l()
  }

  function persist(): void {
    if (!saveOutbox(deps.storage, outbox) && outbox.lastError === null) {
      outbox = { ...outbox, lastError: 'не удалось сохранить очередь в браузере' }
    }
  }

  function clearTimer(): void {
    if (timer !== null) {
      timers.clear(timer)
      timer = null
    }
  }

  function blocked(token: string): SyncStatus['blocked'] {
    if (token === '') return 'no-token'
    return haltedToken === token ? 'unauthorized' : null
  }

  function fail(error: string): void {
    outbox = { ...outbox, attempts: outbox.attempts + 1, lastError: error }
    persist()
    const delay = retryDelayMs(outbox.attempts)
    nextAttemptAt = now() + delay
    clearTimer()
    timer = timers.set(() => { timer = null; if (!disposed) void trigger('timer') }, delay)
  }

  /** Одна отправка. true - можно сразу идти дальше (успех и в очереди ещё есть
      или за время полёта пришли новые правки). */
  async function attempt(reason: SyncTrigger): Promise<boolean> {
    const token = deps.getToken()
    if (blocked(token) !== null) { notify(); return false }

    const diff = diffForSync(mealEntriesOf(deps.getState()), outbox, now())
    const tombstonesChanged = !sameKeys(diff.tombstones, outbox.tombstones)
    if (tombstonesChanged) {
      outbox = { ...outbox, tombstones: diff.tombstones }
      persist()
    }
    if (diff.queue.length === 0) { notify(); return false }
    if (REASONS_RESPECTING_PAUSE.has(reason) && now() < nextAttemptAt) { notify(); return false }

    const batch = diff.queue.slice(0, MEALS_BATCH_MAX)
    sending = true
    notify()
    let result: Awaited<ReturnType<typeof postMeals>>
    try {
      result = await postMeals(base, token, { entries: batch }, fetchFn)
    } finally {
      sending = false
    }

    if (!result.ok) {
      if (result.reason === 'unauthorized') {
        haltedToken = token
        clearTimer()
        nextAttemptAt = 0
        outbox = { ...outbox, attempts: outbox.attempts + 1, lastError: result.error }
        persist()
      } else {
        fail(result.error)
      }
      notify()
      return false
    }

    const sentIds = new Set(batch.map(e => e.id))
    const accepted = result.accepted.filter(id => sentIds.has(id))
    if (accepted.length === 0) {
      fail('Сервер не принял ни одной записи.')
      notify()
      return false
    }
    const book = applyAccepted(outbox, batch, accepted)
    outbox = {
      ...outbox,
      synced: book.synced,
      tombstones: book.tombstones,
      lastOkAt: new Date(now()).toISOString(),
      lastError: null,
      attempts: 0
    }
    nextAttemptAt = 0
    clearTimer()
    persist()
    notify()
    return diff.queue.length > accepted.length || again
  }

  async function loop(reason: SyncTrigger): Promise<void> {
    let next = reason
    for (;;) {
      again = false
      const more = await attempt(next)
      if (!more || disposed) return
      next = 'manual'
    }
  }

  function trigger(reason: SyncTrigger): Promise<void> {
    if (disposed) return Promise.resolve()
    if (running) {
      again = true
      return running
    }
    const p = loop(reason).finally(() => { running = null })
    running = p
    return p
  }

  async function resendAll(): Promise<void> {
    // надгробия для уже исчезнувших записей фиксируем до сброса: иначе забытое
    // подтверждение стёрло бы единственную память о том, что их надо удалить
    const diff = diffForSync(mealEntriesOf(deps.getState()), outbox, now())
    outbox = { ...outbox, synced: {}, tombstones: diff.tombstones, attempts: 0, lastError: null }
    haltedToken = null
    nextAttemptAt = 0
    persist()
    notify()
    await trigger('manual')
  }

  function forget(): void {
    outbox = { ...outbox, synced: {}, tombstones: {}, attempts: 0, lastError: null }
    nextAttemptAt = 0
    clearTimer()
    persist()
    notify()
  }

  function status(): SyncStatus {
    const token = deps.getToken()
    const diff = diffForSync(mealEntriesOf(deps.getState()), outbox, now())
    return {
      queued: diff.queue.length,
      lastOkAt: outbox.lastOkAt,
      lastError: outbox.lastError,
      attempts: outbox.attempts,
      blocked: blocked(token),
      sending
    }
  }

  return {
    trigger,
    resendAll,
    forget,
    status,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose() {
      disposed = true
      clearTimer()
      listeners.clear()
    }
  }
}

function sameKeys(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every(k => k in b)
}
