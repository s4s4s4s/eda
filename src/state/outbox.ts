/* Очередь синхронизации дневника со Штурманом: хранение в localStorage под
   своим ключом OUTBOX_KEY и движок отправки. Формат AppState очередь не
   трогает - она лежит отдельно (раздел 3.2 плана «здоровье в одном месте»).

   Движок (createSyncEngine) получает всё внешнее параметрами - состояние,
   токен, хранилище, fetchFn, часы и таймеры, - поэтому тесты гоняют его без
   браузера. Правила:
   - один запрос в полёте: повторный пуск во время отправки лишь помечает, что
     после неё нужно ещё раз сверить дневник;
   - запись уходит из очереди только по `accepted` из ответа;
   - после ошибки пауза 1 минута, дальше вдвое, не больше часа; пуски по
     save/online/visible/timer паузу уважают, старт и кнопка - нет;
   - 400 (и 413) на пакет: пакет делится пополам до одной записи; запись,
     которую сервер отвергает и поодиночке, помечается отвергнутой (rejected) и
     не повторяется, пока её содержимое не изменится;
   - forget() заводит новую эпоху: ответ на запрос, начатый до неё, отбрасывается;
   - 401 останавливает повторы до смены токена. Факт остановки живёт только в
     памяти вкладки: токен (даже его хэш) в очередь не пишется, после
     перезагрузки будет одна пробная отправка и снова остановка. */

import { MEALS_BATCH_MAX, postMeals, SHTURMAN_BASE } from '../core/healthClient'
import { applyAccepted, diffForSync, entrySig, mealEntriesOf, retryDelayMs } from '../core/sync'
import type { SyncBook, SyncEntry, SyncMark, SyncStatus } from '../core/sync'
import type { AppState, Slot } from '../core/types'
import { SLOTS } from '../core/types'

/** Ключ localStorage очереди - единственное место, где он назван. */
export const OUTBOX_KEY = 'eda.sync.v1'

export interface OutboxState extends SyncBook {
  lastOkAt: string | null
  lastError: string | null
  attempts: number
  /** Отвергнутые сервером записи: id -> ключ содержимого (rejectKey). */
  rejected: Record<string, string>
}

export function emptyOutbox(): OutboxState {
  return { synced: {}, tombstones: {}, lastOkAt: null, lastError: null, attempts: 0, rejected: {} }
}

/** Ключ содержимого записи для отметки «отвергнута»: версия (updatedAt) в него
    не входит, она у неотправленной записи плавает от вызова к вызову. */
function rejectKey(e: SyncEntry): string {
  return `${e.deleted ? 'd' : 'u'}:${entrySig(e)}`
}

/** Предел прохода при делении пакета по 400: больше запросов или подряд идущих
    одиночных отказов - значит отказ общий (сервер отвергает всё), проход
    прекращается и начинается обычная пауза повтора. */
export const SPLIT_MAX_REQUESTS = 20
export const SPLIT_MAX_SINGLE_REJECTS = 3
export const SERVER_REJECTS_ALL = 'Сервер отвергает отправку.'

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
  const rejected: Record<string, string> = {}
  if (isPlainObject(json.rejected)) {
    for (const [id, v] of Object.entries(json.rejected)) {
      if (typeof v === 'string') rejected[id] = v
    }
  }
  return {
    synced,
    tombstones,
    lastOkAt: typeof json.lastOkAt === 'string' ? json.lastOkAt : null,
    lastError: typeof json.lastError === 'string' ? json.lastError : null,
    attempts: typeof json.attempts === 'number' && Number.isInteger(json.attempts) && json.attempts >= 0 ? json.attempts : 0,
    rejected
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

const REASONS_RESPECTING_PAUSE: ReadonlySet<SyncTrigger> = new Set(['save', 'online', 'visible', 'timer'])

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
  /* Эпоха очереди: forget() её сдвигает, и ответ на запрос, начатый раньше,
     не должен ничего записать в очередь. */
  let epoch = 0
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

  /** Что отправлять сейчас: очередь без отвергнутых сервером записей. */
  function plan(): { diff: ReturnType<typeof diffForSync>; queue: SyncEntry[]; rejected: number } {
    const diff = diffForSync(mealEntriesOf(deps.getState()), outbox, now())
    const queue = diff.queue.filter(e => outbox.rejected[e.id] !== rejectKey(e))
    return { diff, queue, rejected: diff.queue.length - queue.length }
  }

  /** Приводит сохранённое в порядок по результату plan: актуальные надгробия,
      забытое подтверждённое (предохранитель), отметки «отвергнута» только для
      записей, которые всё ещё в очереди с тем же содержимым. */
  function reconcile(p: ReturnType<typeof plan>): void {
    const rejected: Record<string, string> = {}
    for (const e of p.diff.queue) {
      if (outbox.rejected[e.id] === rejectKey(e)) rejected[e.id] = outbox.rejected[e.id]
    }
    const changed = !sameKeys(p.diff.tombstones, outbox.tombstones)
      || p.diff.forgetSynced
      || !sameKeys(rejected, outbox.rejected)
    if (!changed) return
    outbox = {
      ...outbox,
      tombstones: p.diff.tombstones,
      synced: p.diff.forgetSynced ? {} : outbox.synced,
      rejected
    }
    persist()
  }

  /** Отказ признан общим: отметки «отвергнута» этого прохода снимаются (они
      могли быть следствием общего отказа), дальше обычная пауза с удвоением. */
  function abortAsGeneral(marked: readonly string[]): 'failed' {
    const rejected = { ...outbox.rejected }
    for (const id of marked) delete rejected[id]
    outbox = { ...outbox, rejected }
    fail(SERVER_REJECTS_ALL)
    notify()
    return 'failed'
  }

  /** Отправка пакета с делением при 400. Результат: 'done' - обработан весь
      пакет (принято и/или отвергнуто); 'failed' - ошибка с паузой или остановка
      по 401; 'stale' - во время полёта вызван forget(), ответ отброшен. */
  async function deliver(batch: SyncEntry[], token: string): Promise<'done' | 'failed' | 'stale'> {
    const startEpoch = epoch
    const parts: SyncEntry[][] = [batch]
    let acceptedAny = false
    let requests = 0
    let singleRejects = 0
    const marked: string[] = []
    while (parts.length > 0) {
      if (requests >= SPLIT_MAX_REQUESTS) return abortAsGeneral(marked)
      const part = parts.shift()!
      requests++
      sending = true
      notify()
      let result: Awaited<ReturnType<typeof postMeals>>
      try {
        result = await postMeals(base, token, { entries: part }, fetchFn)
      } finally {
        sending = false
      }
      if (epoch !== startEpoch) return 'stale'

      if (!result.ok) {
        if (result.reason === 'bad-request') {
          if (part.length > 1) {
            const mid = Math.ceil(part.length / 2)
            parts.unshift(part.slice(0, mid), part.slice(mid))
          } else {
            outbox = { ...outbox, rejected: { ...outbox.rejected, [part[0].id]: rejectKey(part[0]) } }
            marked.push(part[0].id)
            persist()
            notify()
            if (++singleRejects > SPLIT_MAX_SINGLE_REJECTS) return abortAsGeneral(marked)
          }
          continue
        }
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
        return 'failed'
      }

      const sentIds = new Set(part.map(e => e.id))
      const accepted = result.accepted.filter(id => sentIds.has(id))
      if (accepted.length === 0) {
        fail('Сервер не принял ни одной записи.')
        notify()
        return 'failed'
      }
      acceptedAny = true
      singleRejects = 0
      const book = applyAccepted(outbox, part, accepted)
      outbox = { ...outbox, synced: book.synced, tombstones: book.tombstones }
      persist()
      notify()
    }
    outbox = {
      ...outbox,
      lastOkAt: acceptedAny ? new Date(now()).toISOString() : outbox.lastOkAt,
      lastError: null,
      attempts: 0
    }
    nextAttemptAt = 0
    clearTimer()
    persist()
    notify()
    return 'done'
  }

  /** Одна отправка. true - можно сразу идти дальше (в очереди ещё есть записи,
      за время полёта пришли новые правки или ответ отброшен после forget). */
  async function attempt(reason: SyncTrigger): Promise<boolean> {
    const token = deps.getToken()
    if (blocked(token) !== null) { notify(); return false }

    const first = plan()
    reconcile(first)
    if (first.queue.length === 0) { notify(); return false }
    if (REASONS_RESPECTING_PAUSE.has(reason) && now() < nextAttemptAt) { notify(); return false }

    const outcome = await deliver(first.queue.slice(0, MEALS_BATCH_MAX), token)
    if (outcome === 'failed') return false
    if (outcome === 'stale') return true
    return plan().queue.length > 0 || again
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
    outbox = { ...outbox, synced: {}, tombstones: diff.tombstones, rejected: {}, attempts: 0, lastError: null }
    haltedToken = null
    nextAttemptAt = 0
    persist()
    notify()
    await trigger('manual')
  }

  function forget(): void {
    epoch++
    outbox = { ...outbox, synced: {}, tombstones: {}, rejected: {}, attempts: 0, lastError: null }
    nextAttemptAt = 0
    clearTimer()
    persist()
    notify()
  }

  function status(): SyncStatus {
    const token = deps.getToken()
    const p = plan()
    return {
      queued: p.queue.length,
      rejected: p.rejected,
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

/** Пауза после последнего изменения токена, по истечении которой он считается
    введённым до конца. */
export const TOKEN_SETTLE_MS = 1500

export interface SyncControllerDeps extends Omit<SyncEngineDeps, 'getToken'> {
  /** Токен как он сейчас в настройках, включая недопечатанный. */
  readToken: () => string
  tokenSettleMs?: number
}

export interface SyncController {
  engine: SyncEngine
  /** Дневник сохранён на диск: отправка запускается, только если сам дневник
      (state.log) изменился с прошлого вызова. Сохранения из-за настроек молчат. */
  noteSaved(): void
  /** Токен в поле изменился: отправка не раньше, чем он перестанет меняться. */
  noteTokenInput(): void
  /** Поле токена потеряло фокус: токен введён, отправка сразу. */
  commitToken(): void
  dispose(): void
}

/** Движок плюс правила пуска из интерфейса. Движку токен отдаётся только
    «устоявшийся» (без пробелов по краям): пока человек печатает, на сервер не
    уходят ни обрезки токена, ни запросы на каждый символ. */
export function createSyncController(deps: SyncControllerDeps): SyncController {
  const timers: TimerApi = deps.timers ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
  const settleMs = deps.tokenSettleMs ?? TOKEN_SETTLE_MS
  let settledToken = deps.readToken().trim()
  let settleTimer: unknown = null
  let lastLog = deps.getState().log
  let disposed = false

  const engine = createSyncEngine({ ...deps, timers, getToken: () => settledToken })

  function clearSettleTimer(): void {
    if (settleTimer !== null) {
      timers.clear(settleTimer)
      settleTimer = null
    }
  }

  function settle(): void {
    clearSettleTimer()
    const typed = deps.readToken().trim()
    if (typed === settledToken || disposed) return
    settledToken = typed
    // новый токен - явное действие человека: пауза повтора старого токена не мешает
    void engine.trigger('manual')
  }

  return {
    engine,
    noteSaved() {
      const log = deps.getState().log
      if (log === lastLog) return
      lastLog = log
      void engine.trigger('save')
    },
    noteTokenInput() {
      clearSettleTimer()
      if (deps.readToken().trim() === settledToken) return
      settleTimer = timers.set(() => { settleTimer = null; settle() }, settleMs)
    },
    commitToken: settle,
    dispose() {
      disposed = true
      clearSettleTimer()
      engine.dispose()
    }
  }
}

function sameKeys(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every(k => k in b)
}
