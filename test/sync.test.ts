/**
 * Тесты синхронизации дневника со Штурманом: чистое ядро (src/core/sync.ts),
 * клиент маршрута POST /health/meals (src/core/healthClient.ts) и очередь с
 * движком отправки (src/state/outbox.ts) на фейковом fetchFn, строго по
 * контракту раздела 3.1 плана «здоровье в одном месте». Гоняется node-ом после
 * сборки esbuild: `npm run test:sync`.
 */
import { addExtra, removeExtra, setExtraFraction, unlogMeal } from '../src/core/log'
import { emptyNutrientTotals } from '../src/core/nutrition'
import { MEALS_BATCH_MAX, postMeals } from '../src/core/healthClient'
import { applyAccepted, diffForSync, entrySig, formatSyncTime, mealEntriesOf, retryDelayMs, RETRY_MAX_MS, RETRY_MIN_MS, syncStatusText } from '../src/core/sync'
import type { SyncBook, SyncEntry } from '../src/core/sync'
import { createSyncEngine, emptyOutbox, loadOutbox, OUTBOX_KEY, saveOutbox } from '../src/state/outbox'
import type { TimerApi } from '../src/state/outbox'
import { defaultState } from '../src/state/storage'
import type { AppState, ExtraLogEntry, MealLogEntry } from '../src/core/types'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}
function group(name: string): void { console.log(`  ok ${name}`); passed++ }

const T0 = Date.parse('2026-10-19T10:00:00.000Z')

function mealEntry(over: Partial<MealLogEntry> = {}): MealLogEntry {
  return {
    slot: 'lunch',
    mealId: 'borscht',
    status: 'eaten',
    fraction: 1,
    kbju: { kcal: 800, p: 40, f: 30, c: 90 },
    nutrients: emptyNutrientTotals(),
    title: 'Борщ',
    loggedAt: '2026-10-19T09:00:00.000Z',
    productsRevision: '2026-10-01',
    ...over
  }
}

function extraEntry(id: string, over: Partial<ExtraLogEntry> = {}): ExtraLogEntry {
  return {
    kind: 'custom',
    id,
    slot: 'snack',
    fraction: 0.5,
    title: 'Йогурт',
    kbju: { kcal: 200, p: 10, f: 8, c: 20 },
    nutrients: emptyNutrientTotals(),
    loggedAt: '2026-10-19T09:30:00.000Z',
    customFoodId: 'yogurt',
    source: 'USDA SR Legacy 2018-04',
    ...over
  } as ExtraLogEntry
}

function stateWith(token = 'tok'): AppState {
  const base = defaultState()
  return {
    ...base,
    settings: { ...base.settings, shturmanToken: token },
    log: {
      '2026-10-19': { cycleDay: 3, meals: { lunch: mealEntry() }, extras: [extraEntry('x-1')] }
    }
  }
}

function emptyBook(): SyncBook {
  return { synced: {}, tombstones: {} }
}

class FakeStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  data = new Map<string, string>()
  getItem(key: string): string | null { return this.data.has(key) ? this.data.get(key)! : null }
  setItem(key: string, value: string): void { this.data.set(key, value) }
}

/** Фейковый воркер по контракту 3.1: принимает пачку, возвращает accepted = все id. */
interface ServerCall { url: string; init: RequestInit; entries: SyncEntry[] }

function fakeServer(handler?: (call: ServerCall, n: number) => { status: number; body: unknown } | 'throw'): {
  calls: ServerCall[]
  fetchFn: typeof fetch
} {
  const calls: ServerCall[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    const entries = (JSON.parse(String(init.body)) as { entries: SyncEntry[] }).entries
    const call = { url, init, entries }
    calls.push(call)
    const out = handler ? handler(call, calls.length) : { status: 200, body: { ok: true, accepted: entries.map(e => e.id), days: [...new Set(entries.map(e => e.day))] } }
    if (out === 'throw') throw new TypeError('Failed to fetch')
    return { ok: out.status >= 200 && out.status < 300, status: out.status, json: async () => out.body } as unknown as Response
  }) as typeof fetch
  return { calls, fetchFn }
}

/** Ручные часы и таймеры: время двигает тест, таймеры срабатывают по требованию. */
function fakeClock(start = T0): { now: () => number; advance: (ms: number) => void; timers: TimerApi; pending: () => { ms: number }[]; fireNext: () => void } {
  let t = start
  const scheduled: { fn: () => void; ms: number; id: number; cleared: boolean }[] = []
  let seq = 0
  return {
    now: () => t,
    advance: ms => { t += ms },
    timers: {
      set(fn, ms) { const h = { fn, ms, id: ++seq, cleared: false }; scheduled.push(h); return h },
      clear(handle) { (handle as { cleared: boolean }).cleared = true }
    },
    pending: () => scheduled.filter(s => !s.cleared).map(s => ({ ms: s.ms })),
    fireNext: () => {
      const next = scheduled.find(s => !s.cleared)
      if (!next) throw new Error('нет ожидающего таймера')
      next.cleared = true
      next.fn()
    }
  }
}

// ---- чистое ядро -----------------------------------------------------------

function mealEntriesOfChecks(): void {
  const entries = mealEntriesOf(stateWith())
  assert(entries.length === 2, `ожидалось 2 записи, получено ${entries.length}`)
  const meal = entries.find(e => e.kind === 'meal')!
  assert(meal.id === '2026-10-19:lunch', `id приёма = <day>:<slot>, получено ${meal.id}`)
  assert(meal.day === '2026-10-19' && meal.slot === 'lunch', 'день и слот приёма')
  assert(meal.status === 'eaten' && meal.fraction === 1, 'статус и доля приёма')
  assert(meal.kcal === 800 && meal.p === 40 && meal.f === 30 && meal.c === 90, 'числа цельного приёма')
  assert(meal.updatedAt === meal.loggedAt && meal.loggedAt === '2026-10-19T09:00:00.000Z', 'updatedAt = loggedAt')
  assert(meal.productsRevision === '2026-10-01', 'ревизия справочника уходит')
  const extra = entries.find(e => e.kind === 'extra')!
  assert(extra.id === 'x-1', 'id добавленной еды - его собственный')
  assert(extra.status === undefined, 'у добавленной еды статуса нет')
  assert(extra.fraction === 0.5 && extra.kcal === 100 && extra.p === 5 && extra.f === 4 && extra.c === 10,
    'числа добавленной еды - съеденное: снапшот x доля')
  assert(!('productsRevision' in extra), 'у extra не-menu ревизии нет')

  const partial = mealEntriesOf({
    ...stateWith(),
    log: { '2026-10-19': { cycleDay: null, meals: { dinner: mealEntry({ slot: 'dinner', status: 'partial', fraction: 0.25 }), snack: mealEntry({ slot: 'snack', status: 'skipped', fraction: 0 }) }, extras: [] } }
  })
  const d = partial.find(e => e.slot === 'dinner')!
  assert(d.kcal === 200 && d.fraction === 0.25, 'съел часть: число уже умножено на долю')
  const sk = partial.find(e => e.slot === 'snack')!
  assert(sk.status === 'skipped' && sk.kcal === 0 && sk.fraction === 0, 'пропущенный приём: ноль, статус skipped')
  group('mealEntriesOf: id, доля, updatedAt = loggedAt')
}

function diffChecks(): void {
  const state = stateWith()
  const entries = mealEntriesOf(state)
  const first = diffForSync(entries, emptyBook(), T0)
  assert(first.queue.length === 2 && Object.keys(first.tombstones).length === 0, 'пустая книга: обе записи в очереди')

  const sentBook = applyAccepted(emptyBook(), first.queue, first.queue.map(e => e.id))
  assert(Object.keys(sentBook.synced).length === 2, 'принятые записи подтверждены')
  const idle = diffForSync(entries, sentBook, T0 + 1000)
  assert(idle.queue.length === 0, 'после подтверждения очередь пуста')

  // unlogMeal -> надгробие
  const after = mealEntriesOf(unlogMeal(state, '2026-10-19', 'lunch'))
  const d = diffForSync(after, sentBook, T0 + 5000)
  assert(d.queue.length === 1, 'после unlogMeal одна запись в очереди')
  const t = d.queue[0]
  assert(t.id === '2026-10-19:lunch' && t.deleted === true, 'надгробие на исчезнувший приём')
  assert(t.day === '2026-10-19' && t.slot === 'lunch' && t.kind === 'meal', 'у надгробия есть day/slot/kind для валидатора сервера')
  assert(Date.parse(t.updatedAt) > Date.parse(sentBook.synced[t.id].updatedAt), 'updatedAt надгробия строго новее подтверждённого')
  assert(d.tombstones[t.id] !== undefined, 'надгробие запоминается')

  // updatedAt надгробия не плавает между вызовами
  const d2 = diffForSync(after, { ...sentBook, tombstones: d.tombstones }, T0 + 99_000)
  assert(d2.queue[0].updatedAt === t.updatedAt, 'надгробие создаётся один раз')

  // надгробие принято -> исчезает и из synced, и из tombstones
  const acked = applyAccepted({ ...sentBook, tombstones: d.tombstones }, d.queue, [t.id])
  assert(acked.synced[t.id] === undefined && acked.tombstones[t.id] === undefined, 'принятое надгробие стирается')
  assert(diffForSync(after, acked, T0 + 9000).queue.length === 0, 'после подтверждения надгробия очередь пуста')

  // запись вернулась (повторная запись приёма) -> неотправленное надгробие снимается
  const back = mealEntriesOf(state)
  const d3 = diffForSync(back, { ...sentBook, tombstones: d.tombstones }, T0 + 7000)
  assert(Object.keys(d3.tombstones).length === 0, 'вернувшаяся запись снимает своё надгробие')
  assert(d3.queue.length === 0, 'вернувшаяся неизменная запись не в очереди')

  // removeExtra -> надгробие добавленной еды
  const noExtra = mealEntriesOf(removeExtra(state, '2026-10-19', 'x-1'))
  const dx = diffForSync(noExtra, sentBook, T0 + 5000)
  assert(dx.queue.length === 1 && dx.queue[0].id === 'x-1' && dx.queue[0].deleted === true && dx.queue[0].kind === 'extra', 'надгробие добавленной еды')

  // новая запись того же приёма: loggedAt новее -> в очереди с этим loggedAt
  const relogged = mealEntriesOf({ ...state, log: { '2026-10-19': { ...state.log['2026-10-19'], meals: { lunch: mealEntry({ fraction: 0.5, status: 'partial', loggedAt: '2026-10-19T12:00:00.000Z' }) } } } })
  const dr = diffForSync(relogged, sentBook, T0 + 5000)
  assert(dr.queue.length === 1 && dr.queue[0].updatedAt === '2026-10-19T12:00:00.000Z', 'перезапись приёма уходит с новым loggedAt')
  group('diffForSync: очередь, надгробия, возврат записи')
}

function fractionEditChecks(): void {
  const state = stateWith()
  const book = (() => {
    const q = diffForSync(mealEntriesOf(state), emptyBook(), T0).queue
    return applyAccepted(emptyBook(), q, q.map(e => e.id))
  })()
  const edited = setExtraFraction(state, '2026-10-19', 'x-1', 1)
  const entries = mealEntriesOf(edited)
  assert(entries.find(e => e.id === 'x-1')!.updatedAt === '2026-10-19T09:30:00.000Z', 'правка доли loggedAt не двигает')
  const d = diffForSync(entries, book, T0 + 60_000)
  assert(d.queue.length === 1 && d.queue[0].id === 'x-1', 'правка доли замечена по отпечатку')
  const sent = d.queue[0]
  assert(sent.kcal === 200 && sent.fraction === 1, 'уходит новое съеденное')
  assert(Date.parse(sent.updatedAt) > Date.parse(book.synced['x-1'].updatedAt), 'версия строго новее подтверждённой, иначе сервер её проигнорирует')
  assert(entrySig(sent) !== book.synced['x-1'].sig, 'отпечаток изменился')
  const after = applyAccepted(book, d.queue, ['x-1'])
  assert(diffForSync(entries, after, T0 + 120_000).queue.length === 0, 'после подтверждения правки очередь пуста')
  group('правка доли добавленной еды (loggedAt не меняется) попадает в очередь')
}

function applyAcceptedChecks(): void {
  const q = diffForSync(mealEntriesOf(stateWith()), emptyBook(), T0).queue
  const part = applyAccepted(emptyBook(), q, [q[0].id, 'чужой-id'])
  assert(Object.keys(part.synced).length === 1 && part.synced[q[0].id] !== undefined, 'подтверждается только принятое и реально отправленное')
  group('applyAccepted: чужие id игнорируются')
}

function retryDelayChecks(): void {
  assert(retryDelayMs(0) === 0, 'нет ошибок - нет паузы')
  assert(retryDelayMs(1) === RETRY_MIN_MS && RETRY_MIN_MS === 60_000, 'первая пауза - минута')
  assert(retryDelayMs(2) === 120_000 && retryDelayMs(3) === 240_000, 'пауза удваивается')
  assert(retryDelayMs(7) === RETRY_MAX_MS && retryDelayMs(40) === RETRY_MAX_MS && RETRY_MAX_MS === 3_600_000, 'потолок - час')
  group('retryDelayMs: от минуты до часа с удвоением')
}

function statusTextChecks(): void {
  const base = { queued: 3, lastOkAt: null, lastError: null, attempts: 0, blocked: null, sending: false } as const
  assert(syncStatusText(base) === 'В очереди 3 записи, отправок ещё не было.', syncStatusText(base))
  const err = syncStatusText({ ...base, queued: 1, lastOkAt: '2026-10-19T09:05:00.000Z', lastError: 'нет сети' })
  assert(err.startsWith('В очереди 1 запись, последняя отправка ') && err.endsWith('ошибка: нет сети.'), err)
  assert(syncStatusText({ ...base, blocked: 'no-token' }).includes('не введён токен'), 'без токена - причина')
  assert(syncStatusText({ ...base, blocked: 'unauthorized', lastError: 'Токен приложения не принят' }).includes('до смены токена'), '401 - причина')
  assert(syncStatusText({ ...base, queued: 0 }).startsWith('В очереди пусто'), 'пустая очередь')
  assert(/^\d\d\.\d\d \d\d:\d\d$/.test(formatSyncTime('2026-10-19T09:05:00.000Z')), 'формат времени')
  assert(!/[\u2013\u2014]/.test(syncStatusText({ ...base, lastError: 'x' })), 'в тексте нет длинных тире')
  group('syncStatusText')
}

// ---- клиент ----------------------------------------------------------------

async function clientChecks(): Promise<void> {
  const entries = mealEntriesOf(stateWith())
  const ok = fakeServer()
  const r = await postMeals('https://w.example', 'SECRET-TOKEN', { entries }, ok.fetchFn)
  assert(r.ok && r.accepted.length === 2 && r.days[0] === '2026-10-19', 'успех: accepted и days')
  const call = ok.calls[0]
  assert(call.url === 'https://w.example/health/meals' && call.init.method === 'POST', 'адрес и метод по контракту')
  assert((call.init.headers as Record<string, string>).authorization === 'Bearer SECRET-TOKEN', 'Bearer-токен')
  assert(call.entries.length === 2, 'тело {entries: [...]}')

  const cases: [number, unknown, string][] = [
    [401, { ok: false }, 'unauthorized'],
    [400, { ok: false, error: 'entries[0].fraction: вне [0,1]' }, 'bad-request'],
    [413, {}, 'bad-request'],
    [500, {}, 'bad-response'],
    [200, { ok: true }, 'bad-response'],
    [200, { ok: true, accepted: [1] }, 'bad-response'],
    [200, 'мусор', 'bad-response']
  ]
  for (const [status, body, reason] of cases) {
    const s = fakeServer(() => ({ status, body }))
    const res = await postMeals('https://w.example', 'SECRET-TOKEN', { entries }, s.fetchFn)
    assert(!res.ok && res.reason === reason, `${status} ${JSON.stringify(body)} -> ${reason}, получено ${JSON.stringify(res)}`)
    assert(!res.ok && !res.error.includes('SECRET-TOKEN'), 'токен не попадает в текст ошибки')
  }
  const e400 = await postMeals('https://w.example', 't', { entries }, fakeServer(() => ({ status: 400, body: { error: 'причина сервера' } })).fetchFn)
  assert(!e400.ok && e400.error === 'причина сервера', 'при 400 показывается причина сервера')
  const net = await postMeals('https://w.example', 'SECRET-TOKEN', { entries }, fakeServer(() => 'throw').fetchFn)
  assert(!net.ok && net.reason === 'network' && !net.error.includes('SECRET-TOKEN'), 'сеть: network без токена в тексте')
  const tooMany = await postMeals('https://w.example', 't', { entries: Array.from({ length: MEALS_BATCH_MAX + 1 }, () => entries[0]) }, ok.fetchFn)
  assert(!tooMany.ok && tooMany.reason === 'bad-request' && ok.calls.length === 1, 'больше 200 записей даже не отправляются')
  group('postMeals: контракт, причины отказа, токен не течёт')
}

// ---- хранение --------------------------------------------------------------

function storageChecks(): void {
  const st = new FakeStorage()
  assert(OUTBOX_KEY === 'eda.sync.v1', 'ключ очереди')
  assert(JSON.stringify(loadOutbox(st)) === JSON.stringify(emptyOutbox()), 'пусто -> пустая очередь')
  const q = diffForSync(mealEntriesOf(stateWith()), emptyBook(), T0).queue
  const book = applyAccepted(emptyBook(), q, [q[0].id])
  const box = { ...emptyOutbox(), ...book, lastOkAt: '2026-10-19T10:00:00.000Z', lastError: 'x', attempts: 2 }
  assert(saveOutbox(st, box), 'запись очереди')
  assert(JSON.stringify(loadOutbox(st)) === JSON.stringify(box), 'круг запись-чтение сохраняет очередь')
  for (const bad of ['{не json', '[]', '"s"', '{"synced":5,"tombstones":[],"attempts":-3}']) {
    st.data.set(OUTBOX_KEY, bad)
    assert(JSON.stringify(loadOutbox(st)) === JSON.stringify(emptyOutbox()), `мусор ${bad} -> пустая очередь без броска`)
  }
  st.data.set(OUTBOX_KEY, JSON.stringify({ ...box, synced: { ...box.synced, битая: { updatedAt: 1 } } }))
  assert(Object.keys(loadOutbox(st).synced).length === 1, 'битая запись выпадает, соседняя остаётся')
  assert(!saveOutbox(null, box), 'нет хранилища - false')
  const throwing = { getItem: () => null, setItem: () => { throw new Error('quota') } }
  assert(!saveOutbox(throwing, box), 'квота - false, без броска')
  group('outbox: eda.sync.v1, круг, мусор, квота')
}

// ---- движок ----------------------------------------------------------------

function makeEngine(opts: { state?: () => AppState; token?: () => string; storage?: FakeStorage; handler?: Parameters<typeof fakeServer>[0] } = {}) {
  const clock = fakeClock()
  const server = fakeServer(opts.handler)
  const storage = opts.storage ?? new FakeStorage()
  let state = stateWith()
  const engine = createSyncEngine({
    getState: opts.state ?? (() => state),
    getToken: opts.token ?? (() => state.settings.shturmanToken),
    storage,
    fetchFn: server.fetchFn,
    base: 'https://w.example',
    now: clock.now,
    timers: clock.timers
  })
  return { engine, clock, server, storage, setState: (s: AppState) => { state = s }, getState: () => state }
}

async function engineSuccessChecks(): Promise<void> {
  const h = makeEngine()
  await h.engine.trigger('start')
  assert(h.server.calls.length === 1 && h.server.calls[0].entries.length === 2, 'одна пачка из двух записей')
  const st = h.engine.status()
  assert(st.queued === 0 && st.lastError === null && st.lastOkAt === new Date(T0).toISOString() && st.attempts === 0, 'принято: очередь пуста, время отправки записано')
  const saved = loadOutbox(h.storage)
  assert(Object.keys(saved.synced).length === 2, 'подтверждение лежит в eda.sync.v1')
  await h.engine.trigger('save')
  assert(h.server.calls.length === 1, 'нечего слать - запросов нет')
  group('движок: accepted очищает очередь')
}

async function engineAcceptedOnlyChecks(): Promise<void> {
  const h = makeEngine({ handler: call => ({ status: 200, body: { ok: true, accepted: [call.entries[0].id], days: [] } }) })
  await h.engine.trigger('start')
  assert(h.server.calls.length === 2, 'не принятое остаётся и уходит вторым запросом')
  assert(h.server.calls[1].entries.length === 1 && h.server.calls[1].entries[0].id !== h.server.calls[0].entries[0].id, 'во второй раз только оставшаяся запись')
  assert(h.engine.status().queued === 0, 'после двух запросов очередь пуста')

  const none = makeEngine({ handler: () => ({ status: 200, body: { ok: true, accepted: [], days: [] } }) })
  await none.engine.trigger('start')
  assert(none.server.calls.length === 1, 'пустой accepted не крутит запросы в цикле')
  const s = none.engine.status()
  assert(s.queued === 2 && s.attempts === 1 && s.lastError !== null, 'ничего не принято: записи на месте, попытка засчитана')
  group('движок: удаление из очереди только по accepted')
}

async function engineNetworkChecks(): Promise<void> {
  let failing = true
  const h = makeEngine({ handler: call => (failing ? 'throw' : { status: 200, body: { ok: true, accepted: call.entries.map(e => e.id), days: [] } }) })
  await h.engine.trigger('start')
  let s = h.engine.status()
  assert(s.queued === 2 && s.attempts === 1 && s.lastError !== null && s.lastOkAt === null, 'network: записи остались, attempts = 1')
  assert(loadOutbox(h.storage).attempts === 1, 'attempts сохранён')
  assert(h.clock.pending().length === 1 && h.clock.pending()[0].ms === 60_000, 'повтор через минуту')

  await h.engine.trigger('save')
  assert(h.server.calls.length === 1, 'пуск после сохранения не обходит паузу')
  await h.engine.trigger('online')
  s = h.engine.status()
  assert(h.server.calls.length === 2 && s.attempts === 2, 'online обходит паузу, attempts = 2')
  assert(h.clock.pending().length === 1 && h.clock.pending()[0].ms === 120_000, 'пауза удвоилась до двух минут')

  failing = false
  h.clock.advance(120_000)
  h.clock.fireNext()
  await Promise.resolve()
  await h.engine.trigger('save')
  s = h.engine.status()
  assert(s.queued === 0 && s.attempts === 0 && s.lastError === null, 'после успеха ошибка и attempts сброшены')
  assert(h.clock.pending().length === 0, 'таймер повтора снят')
  group('движок: network оставляет записи, attempts растёт, пауза удваивается')
}

async function engine401Checks(): Promise<void> {
  let token = 'old'
  const s0 = stateWith()
  let seenToken = ''
  const h = makeEngine({
    token: () => token,
    handler: (call, n) => {
      seenToken = (call.init.headers as Record<string, string>).authorization
      return n === 1 ? { status: 401, body: { ok: false } } : { status: 200, body: { ok: true, accepted: call.entries.map(e => e.id), days: [] } }
    }
  })
  h.setState(s0)
  await h.engine.trigger('start')
  let s = h.engine.status()
  assert(s.blocked === 'unauthorized' && s.queued === 2, '401: остановка, записи на месте')
  assert(h.clock.pending().length === 0, '401: таймер повтора не ставится')
  for (const reason of ['save', 'online', 'visible', 'start', 'manual'] as const) await h.engine.trigger(reason)
  assert(h.server.calls.length === 1, '401: никакой пуск не шлёт запросов до смены токена')
  token = 'new'
  await h.engine.trigger('save')
  s = h.engine.status()
  assert(h.server.calls.length === 2 && seenToken === 'Bearer new' && s.blocked === null && s.queued === 0, 'смена токена снимает остановку')
  assert(!JSON.stringify([...h.storage.data.values()]).includes('old'), 'токен в очередь не пишется')

  const empty = makeEngine({ token: () => '' })
  await empty.engine.trigger('start')
  assert(empty.server.calls.length === 0 && empty.engine.status().blocked === 'no-token', 'без токена запросов нет')
  group('движок: 401 останавливает повторы до смены токена, пустой токен молчит')
}

async function engineSingleFlightChecks(): Promise<void> {
  let release: (() => void) | null = null
  const gate = new Promise<void>(r => { release = r })
  const clock = fakeClock()
  const calls: SyncEntry[][] = []
  let state = stateWith()
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const entries = (JSON.parse(String(init.body)) as { entries: SyncEntry[] }).entries
    calls.push(entries)
    if (calls.length === 1) await gate
    return { ok: true, status: 200, json: async () => ({ ok: true, accepted: entries.map(e => e.id), days: [] }) } as unknown as Response
  }) as typeof fetch
  const engine = createSyncEngine({
    getState: () => state, getToken: () => 't', storage: new FakeStorage(), fetchFn, base: 'https://w.example', now: clock.now, timers: clock.timers
  })
  const a = engine.trigger('save')
  const b = engine.trigger('save')
  const c = engine.trigger('visible')
  assert(calls.length === 1, `три пуска подряд дали ${calls.length} запросов в полёте`)
  assert(engine.status().sending, 'status показывает отправку')
  // за время полёта дневник изменился: после ответа движок сверяет ещё раз
  state = addExtra(state, '2026-10-19', extraEntry('x-2', { loggedAt: '2026-10-19T09:40:00.000Z' }), 3)
  release!()
  await Promise.all([a, b, c])
  assert(calls.length === 2, `после полёта нужна одна досылка, запросов ${calls.length}`)
  assert(calls[1].length === 1 && calls[1][0].id === 'x-2', 'досылка несёт только то, что изменилось в полёте')
  assert(engine.status().queued === 0 && !engine.status().sending, 'всё доставлено')
  group('движок: один запрос в полёте, правка в полёте досылается')
}

async function engineBatchChecks(): Promise<void> {
  const base = defaultState()
  const days: AppState['log'] = {}
  for (let i = 0; i < 230; i++) {
    const day = `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`
    days[day] = { cycleDay: null, meals: { lunch: mealEntry() }, extras: [] }
  }
  const state: AppState = { ...base, settings: { ...base.settings, shturmanToken: 't' }, log: days }
  const h = makeEngine({ state: () => state, token: () => 't' })
  await h.engine.trigger('manual')
  assert(h.server.calls.length === 2, `230 записей = 2 запроса, получено ${h.server.calls.length}`)
  assert(h.server.calls[0].entries.length === MEALS_BATCH_MAX && h.server.calls[1].entries.length === 30, 'пачки по 200 и остаток')
  group('движок: пачки по 200 записей')
}

async function engineResendAndForgetChecks(): Promise<void> {
  const h = makeEngine()
  await h.engine.trigger('start')
  assert(h.server.calls.length === 1, 'первичная отправка')
  await h.engine.resendAll()
  assert(h.server.calls.length === 2 && h.server.calls[1].entries.length === 2, '«Отправить весь дневник» шлёт всё заново')
  assert(h.server.calls[1].entries.every(e => !e.deleted), 'повторная отправка без надгробий')

  // исчезнувшая запись и «весь дневник»: надгробие не теряется
  h.setState(removeExtra(h.getState(), '2026-10-19', 'x-1'))
  await h.engine.resendAll()
  const last = h.server.calls[h.server.calls.length - 1]
  const upserts = last.entries.filter(e => !e.deleted)
  const stones = last.entries.filter(e => e.deleted)
  assert(upserts.length === 1 && upserts[0].kind === 'meal', 'сброс подтверждений шлёт то, что есть в дневнике')
  assert(stones.length === 1 && stones[0].id === 'x-1', 'надгробие исчезнувшей записи не теряется при сбросе')

  // forget: дневник стёрт целиком, удаления на сервер не уходят
  const g = makeEngine()
  await g.engine.trigger('start')
  g.setState({ ...g.getState(), log: {} })
  g.engine.forget()
  await g.engine.trigger('save')
  assert(g.server.calls.length === 1, 'после forget надгробия не отправляются')
  assert(Object.keys(loadOutbox(g.storage).synced).length === 0, 'forget очищает подтверждённое')

  // без forget то же самое состояние даёт надгробия
  const t = makeEngine()
  await t.engine.trigger('start')
  t.setState({ ...t.getState(), log: {} })
  await t.engine.trigger('save')
  const del = t.server.calls[1].entries
  assert(del.length === 2 && del.every(e => e.deleted === true), 'исчезнувшие записи уходят надгробиями')
  assert(t.engine.status().queued === 0, 'надгробия подтверждены')
  group('движок: resendAll, forget и надгробия')
}

async function engineReloadChecks(): Promise<void> {
  const storage = new FakeStorage()
  const first = makeEngine({ storage })
  await first.engine.trigger('start')
  const second = makeEngine({ storage })
  await second.engine.trigger('start')
  assert(second.server.calls.length === 0, 'после перезапуска подтверждённое помнится: повторной отправки нет')
  group('движок: очередь переживает перезапуск')
}

async function main(): Promise<void> {
  mealEntriesOfChecks()
  diffChecks()
  fractionEditChecks()
  applyAcceptedChecks()
  retryDelayChecks()
  statusTextChecks()
  await clientChecks()
  storageChecks()
  await engineSuccessChecks()
  await engineAcceptedOnlyChecks()
  await engineNetworkChecks()
  await engine401Checks()
  await engineSingleFlightChecks()
  await engineBatchChecks()
  await engineResendAndForgetChecks()
  await engineReloadChecks()
  console.log(`\nВсе проверки sync пройдены (${passed} групп).`)
}

main().catch((e) => {
  console.error('\n✗ ТЕСТ SYNC УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
})
