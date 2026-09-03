/**
 * Тесты домена «своя еда» (src/core/food.ts) и клиента воркера
 * (src/core/foodClient.ts). Гоняется node-ом после сборки esbuild:
 * `npm run test:food`.
 *
 * test/fixtures/food-result.json — настоящий вывод scripts/resolve-food.mjs
 * (яйцо 171287 + банан 173944 + лосось 175167, разные граммы), дополненный
 * полем request так, как его добавляет раннер. customFoodTotals обязана
 * дать те же числа, что лежат в фикстуре, — это доказательство, что
 * приложение и раннер считают одинаково.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  applyFoodAsk, applyFoodPoll, customExtraFrom, customFoodFromResult, customFoodTotals,
  discardFoodRequest, menuExtraFrom, newFoodRequest, parseFoodResult,
  removeCustomFood, retryFoodRequest, saveCustomFood, withComponentGrams
} from '../src/core/food'
import type { FoodPollResponse } from '../src/core/food'
import { askFood, pollFood, SHTURMAN_BASE } from '../src/core/foodClient'
import { NUTRIENT_KEYS } from '../src/core/types'
import type { AppState, Meal, Product, ProductIndex } from '../src/core/types'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}
function group(name: string): void { console.log(`  ok ${name}`); passed++ }

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps
}

function findRepoRoot(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 12; i++) {
    if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'data'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`Не удалось найти корень репозитория (package.json + data/) вверх от ${startDir}`)
}

const REPO_ROOT = findRepoRoot(process.cwd())
const FIXTURE_PATH = path.join(REPO_ROOT, 'test', 'fixtures', 'food-result.json')

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
}

function emptyState(): AppState {
  return {
    version: 5,
    settings: {
      cycleStartDate: '2026-08-01', cycleShift: 0, targetKcal: 3200, targetProteinG: 120,
      shortcutName: '', cycleStartConfirmed: true, shturmanToken: 'secret-token'
    },
    log: {},
    preferences: { ingredients: {}, dishes: {} },
    customFoods: {},
    foodRequests: []
  }
}

// ---- parseFoodResult -------------------------------------------------------

function parseFoodResultAcceptsFixtureChecks(): void {
  const result = parseFoodResult(loadFixture())
  assert(result.ok === true, 'parseFoodResult обязан принять настоящий вывод resolve-food.mjs')
  assert(result.components.length === 3, `ожидалось 3 компонента, получено ${result.components.length}`)
  assert(result.request.text === 'Яйцо, банан и лосось', 'request.text обязан прийти из фикстуры дословно')
  group('parseFoodResult: принимает настоящий вывод resolve-food.mjs с полем request')
}

function customFoodTotalsMatchFixtureChecks(): void {
  const fixture = loadFixture() as Record<string, unknown>
  const result = parseFoodResult(fixture)
  const food = customFoodFromResult(result, 'food:test-job', 'custom-1', '2026-09-01T12:00:00')
  const totals = customFoodTotals(food)

  const fixtureKbju = fixture.kbju as { kcal: number; p: number; f: number; c: number }
  assert(approx(totals.kbju.kcal, fixtureKbju.kcal), `kcal ожидался ${fixtureKbju.kcal}, получено ${totals.kbju.kcal}`)
  assert(approx(totals.kbju.p, fixtureKbju.p), `p ожидался ${fixtureKbju.p}, получено ${totals.kbju.p}`)
  assert(approx(totals.kbju.f, fixtureKbju.f), `f ожидался ${fixtureKbju.f}, получено ${totals.kbju.f}`)
  assert(approx(totals.kbju.c, fixtureKbju.c), `c ожидался ${fixtureKbju.c}, получено ${totals.kbju.c}`)

  const fixtureNutrients = fixture.nutrients as Record<string, { value: number; known: number; total: number }>
  for (const key of NUTRIENT_KEYS) {
    const expected = fixtureNutrients[key]
    const actual = totals.nutrients[key]
    assert(actual.known === expected.known, `${key}.known ожидался ${expected.known}, получено ${actual.known}`)
    assert(actual.total === expected.total, `${key}.total ожидался ${expected.total}, получено ${actual.total}`)
    assert(approx(actual.value, expected.value), `${key}.value ожидался ${expected.value}, получено ${actual.value}`)
  }
  group('customFoodTotals(customFoodFromResult(...)) даёт те же kbju и nutrients (по всем 40 ключам), что лежат в фикстуре')
}

function withComponentGramsScalesLinearlyChecks(): void {
  const result = parseFoodResult(loadFixture())
  const food = customFoodFromResult(result, 'food:test-job', 'custom-1', '2026-09-01T12:00:00')
  const before = customFoodTotals(food)

  const originalGrams = food.components[1].grams
  const doubled = withComponentGrams(food, 1, originalGrams * 2)
  const after = customFoodTotals(doubled)

  // компонент 1 (банан) удвоен, остальные не тронуты
  assert(doubled.components[0].grams === food.components[0].grams, 'компонент 0 не должен измениться')
  assert(doubled.components[1].grams === originalGrams * 2, 'компонент 1 обязан удвоиться')
  assert(doubled.components[2].grams === food.components[2].grams, 'компонент 2 не должен измениться')

  const bananaFactor = doubled.components[1].per100.kbju.kcal * (originalGrams / 100)
  assert(approx(after.kbju.kcal, before.kbju.kcal + bananaFactor), 'kcal обязан вырасти ровно на удвоенный вклад компонента 1')
  group('withComponentGrams: масштабирует линейно и меняет только один компонент')
}

function parseFoodResultRejectsBadInputChecks(): void {
  const fixture = loadFixture() as Record<string, unknown>

  // пропущенный ключ нутриента
  const nutrients1 = { ...(fixture.nutrients as Record<string, unknown>) }
  delete nutrients1.fiber
  let threw = false
  try { parseFoodResult({ ...fixture, nutrients: nutrients1 }) } catch { threw = true }
  assert(threw, 'пропущенный ключ NUTRIENT_KEYS в nutrients обязан отвергаться')

  // NaN
  const nutrients2 = { ...(fixture.nutrients as Record<string, { value: number; known: number; total: number }>) }
  nutrients2.fiber = { ...nutrients2.fiber, value: NaN }
  threw = false
  try { parseFoodResult({ ...fixture, nutrients: nutrients2 }) } catch { threw = true }
  assert(threw, 'NaN в value нутриента обязан отвергаться')

  // known > total
  const nutrients3 = { ...(fixture.nutrients as Record<string, { value: number; known: number; total: number }>) }
  nutrients3.fiber = { ...nutrients3.fiber, known: nutrients3.fiber.total + 1 }
  threw = false
  try { parseFoodResult({ ...fixture, nutrients: nutrients3 }) } catch { threw = true }
  assert(threw, 'known > total обязан отвергаться')

  // отсутствие request
  const withoutRequest = { ...fixture }
  delete withoutRequest.request
  threw = false
  try { parseFoodResult(withoutRequest) } catch { threw = true }
  assert(threw, 'отсутствие request обязано отвергаться')

  group('parseFoodResult: отвергает пропущенный ключ нутриента, NaN, known > total, отсутствие request')
}

// ---- applyFoodPoll: переходы ----------------------------------------------

function pending(id: string, target: { date: string; slot: 'lunch' }): AppState {
  const state = emptyState()
  const request = newFoodRequest(id, 'тирамису', 120, target, '2026-09-01T10:00:00')
  return applyFoodAsk(state, request)
}

function applyFoodPollTransitionsChecks(): void {
  const target = { date: '2026-09-01', slot: 'lunch' as const }

  // pending -> done
  {
    const state = pending('req-1', target)
    const fixture = loadFixture()
    const response: FoodPollResponse = { ok: true, id: 'req-1', state: 'done', result: fixture, pcAgo: 5, modelOk: true }
    const next = applyFoodPoll(state, 'req-1', response, '2026-09-01T10:05:00')
    const req = next.foodRequests.find(r => r.id === 'req-1')!
    assert(req.status === 'done', `ожидался done, получено ${req.status}`)
    assert(req.result !== undefined && req.result.title === (fixture as Record<string, unknown>).title, 'result обязан быть разобран')
  }

  // pending -> failed
  {
    const state = pending('req-2', target)
    const response: FoodPollResponse = { ok: true, id: 'req-2', state: 'failed', error: 'в USDA не нашлось подходящих записей', pcAgo: 3, modelOk: true }
    const next = applyFoodPoll(state, 'req-2', response, '2026-09-01T10:05:00')
    const req = next.foodRequests.find(r => r.id === 'req-2')!
    assert(req.status === 'failed', `ожидался failed, получено ${req.status}`)
    assert(req.error === 'в USDA не нашлось подходящих записей', 'error обязан перенестись дословно')
  }

  // pending -> expired
  {
    const state = pending('req-3', target)
    const response: FoodPollResponse = { ok: true, id: 'req-3', state: 'expired', pcAgo: null, modelOk: false }
    const next = applyFoodPoll(state, 'req-3', response, '2026-09-02T10:05:00')
    const req = next.foodRequests.find(r => r.id === 'req-3')!
    assert(req.status === 'expired', `ожидался expired, получено ${req.status}`)
  }

  // taken остаётся pending для приложения
  {
    const state = pending('req-4', target)
    const response: FoodPollResponse = { ok: true, id: 'req-4', state: 'taken', pcAgo: 1, modelOk: true }
    const next = applyFoodPoll(state, 'req-4', response, '2026-09-01T10:05:00')
    const req = next.foodRequests.find(r => r.id === 'req-4')!
    assert(req.status === 'pending', `taken обязан остаться pending для приложения, получено ${req.status}`)
    assert(req.pcAgo === 1, 'pcAgo обязан обновиться')
  }

  // done с битым result -> failed
  {
    const state = pending('req-5', target)
    const response: FoodPollResponse = { ok: true, id: 'req-5', state: 'done', result: { ok: true, title: 'без нужных полей' }, pcAgo: 2, modelOk: true }
    const next = applyFoodPoll(state, 'req-5', response, '2026-09-01T10:05:00')
    const req = next.foodRequests.find(r => r.id === 'req-5')!
    assert(req.status === 'failed', `битый result обязан давать failed, получено ${req.status}`)
    assert(typeof req.error === 'string' && req.error.length > 0, 'failed обязан нести человеческую причину')
  }

  group('applyFoodPoll: pending -> done/failed/expired, taken остаётся pending, done с битым result -> failed')
}

// ---- сохранение и книга -----------------------------------------------------

function saveCustomFoodChecks(): void {
  const target = { date: '2026-09-01', slot: 'lunch' as const }
  const state = pending('req-save', target)
  const fixture = loadFixture()
  const withResult = applyFoodPoll(
    state, 'req-save',
    { ok: true, id: 'req-save', state: 'done', result: fixture, pcAgo: 1, modelOk: true },
    '2026-09-01T10:05:00'
  )
  const req = withResult.foodRequests.find(r => r.id === 'req-save')!
  assert(req.result !== undefined, 'заказ обязан нести разобранный результат перед сохранением')

  const food = customFoodFromResult(req.result!, 'req-save', 'custom-save-1', '2026-09-01T10:06:00')
  const saved = saveCustomFood(withResult, 'req-save', food, target, 0.5, 'extra-save-1', '2026-09-01T10:07:00', 5)

  assert(saved.customFoods['custom-save-1'] !== undefined, 'еда обязана попасть в книгу')
  assert(saved.foodRequests.find(r => r.id === 'req-save') === undefined, 'заказ обязан быть убран из очереди')
  const day = saved.log['2026-09-01']
  assert(day !== undefined, 'день обязан появиться в дневнике')
  const extra = day.extras.find(e => e.id === 'extra-save-1')
  assert(extra !== undefined, 'extra обязана появиться в дне')
  assert(extra!.fraction === 0.5, `fraction ожидался 0.5, получено ${extra!.fraction}`)
  assert(extra!.kind === 'custom' && extra!.customFoodId === 'custom-save-1', 'extra обязана ссылаться на сохранённую еду')

  group('saveCustomFood: кладёт еду в книгу, добавляет extra с fraction и убирает запрос')
}

function retryFoodRequestChecks(): void {
  const target = { date: '2026-09-01', slot: 'lunch' as const }
  const state = pending('req-retry', target)
  const failed: AppState = {
    ...state,
    foodRequests: state.foodRequests.map(r => (r.id === 'req-retry' ? { ...r, status: 'failed' as const, error: 'что-то пошло не так' } : r))
  }
  const retried = retryFoodRequest(failed, 'req-retry', 'req-retry-2', '2026-09-01T11:00:00')
  assert(retried.foodRequests.find(r => r.id === 'req-retry') === undefined, 'старый id обязан исчезнуть из очереди')
  const fresh = retried.foodRequests.find(r => r.id === 'req-retry-2')
  assert(fresh !== undefined, 'новый id обязан появиться в очереди')
  assert(fresh!.text === 'тирамису', 'текст запроса обязан перенестись дословно')
  assert(fresh!.status === 'pending', `новый запрос обязан быть pending, получено ${fresh!.status}`)
  group('retryFoodRequest: заменяет запрос новым id с тем же текстом')
}

function discardAndRemoveChecks(): void {
  const target = { date: '2026-09-01', slot: 'lunch' as const }
  const state = pending('req-discard', target)
  const discarded = discardFoodRequest(state, 'req-discard')
  assert(discarded.foodRequests.length === 0, 'discardFoodRequest обязан убрать заказ из очереди')

  const withFood: AppState = { ...emptyState(), customFoods: { 'f-1': customFoodFromResult(parseFoodResult(loadFixture()), 'job', 'f-1', '2026-09-01T00:00:00') } }
  const removed = removeCustomFood(withFood, 'f-1')
  assert(removed.customFoods['f-1'] === undefined, 'removeCustomFood обязан убрать еду из книги')
  group('discardFoodRequest и removeCustomFood убирают заказ/еду из состояния')
}

// ---- menuExtraFrom ----------------------------------------------------------

function product(id: string, per100: { kcal: number; p: number; f: number; c: number }): Product {
  return { id, name: id, fdcId: 1, fdcDescription: id, tags: [], per100, micro100: {} }
}

function products(...list: Product[]): ProductIndex {
  const map = new Map<string, Product>()
  for (const p of list) map.set(p.id, p)
  return map
}

function menuExtraFromChecks(): void {
  const idx = products(product('x', { kcal: 200, p: 10, f: 5, c: 20 }))
  const meal: Meal = { slot: 'lunch', id: 'obed-5', title: 'Обед дня 5', steps: [], items: [{ product: 'x', g: 100, where: 'container' }] }
  const extra = menuExtraFrom(meal, idx, 'dinner', 0.5, 5, 'extra-menu-1', '2026-09-01T19:00:00', '2026-08-01')
  assert(extra.kind === 'menu' && extra.mealId === 'obed-5', 'extra обязана нести mealId перенесённого блюда')
  assert(extra.kbju.kcal === 200, `снапшот полной порции ожидался 200 ккал, получено ${extra.kbju.kcal}`)
  assert(extra.fraction === 0.5, 'доля обязана перенестись как передана')
  group('menuExtraFrom: снапшот полной порции блюда меню с mealId/fromCycleDay/fromSlot')
}

// ---- foodClient -------------------------------------------------------------

function fakeFetch(status: number, body: unknown): { calls: { url: string; init: RequestInit }[]; fetchFn: typeof fetch } {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    } as unknown as Response
  }) as typeof fetch
  return { calls, fetchFn }
}

async function clientStatusChecks(): Promise<void> {
  {
    const { fetchFn } = fakeFetch(401, { ok: false, error: 'токен приложения не принят' })
    const result = await pollFood(SHTURMAN_BASE, 't', 'food:x', fetchFn)
    assert(!result.ok && result.reason === 'unauthorized', `401 обязан давать unauthorized, получено ${JSON.stringify(result)}`)
  }
  {
    const { fetchFn } = fakeFetch(404, { ok: false, error: 'такой разбор не заказан' })
    const result = await pollFood(SHTURMAN_BASE, 't', 'food:x', fetchFn)
    assert(!result.ok && result.reason === 'not-found', `404 обязан давать not-found, получено ${JSON.stringify(result)}`)
  }
  {
    const { fetchFn } = fakeFetch(400, { ok: false, error: 'текст слишком длинный' })
    const result = await askFood(SHTURMAN_BASE, 't', { id: 'x', text: 'a'.repeat(1000) }, fetchFn)
    assert(!result.ok && result.reason === 'bad-request' && result.error === 'текст слишком длинный', `400 обязан давать bad-request с текстом воркера, получено ${JSON.stringify(result)}`)
  }
  {
    const throwingFetch = (async () => { throw new Error('network down') }) as unknown as typeof fetch
    const result = await pollFood(SHTURMAN_BASE, 't', 'food:x', throwingFetch)
    assert(!result.ok && result.reason === 'network', `исключение fetch обязано давать network, получено ${JSON.stringify(result)}`)
  }
  {
    const notJsonFetch = (async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json') } })) as unknown as typeof fetch
    const result = await pollFood(SHTURMAN_BASE, 't', 'food:x', notJsonFetch)
    assert(!result.ok && result.reason === 'bad-response', `не-JSON обязан давать bad-response, получено ${JSON.stringify(result)}`)
  }
  {
    const okBody: FoodPollResponse = { ok: true, id: 'food:x', state: 'pending', pcAgo: 10, modelOk: true }
    const { fetchFn, calls } = fakeFetch(200, okBody)
    const result = await askFood(SHTURMAN_BASE, 'my-secret-token', { id: 'food:x', text: 'тирамису', grams: 120 }, fetchFn)
    assert(result.ok === true, 'успешный ответ обязан давать ok: true')
    if (result.ok) {
      assert(result.response.id === 'food:x', 'response обязан прийти как есть')
      assert(result.response.state === 'pending', 'response.state обязан прийти как есть')
    }
    assert(calls.length === 1, 'ожидался ровно один вызов fetch')
    assert(calls[0].url === `${SHTURMAN_BASE}/food`, `URL ожидался ${SHTURMAN_BASE}/food, получено ${calls[0].url}`)
    const headers = calls[0].init.headers as Record<string, string>
    assert(headers.authorization === 'Bearer my-secret-token', `заголовок authorization ожидался «Bearer my-secret-token», получено «${headers.authorization}»`)
  }
  group('foodClient: 401 -> unauthorized, 404 -> not-found, 400 -> bad-request, throw -> network, не-JSON -> bad-response, успех -> {ok:true,response}, заголовок и URL верны')
}

async function main(): Promise<void> {
  console.log('food — домен «своя еда» и клиент воркера')
  parseFoodResultAcceptsFixtureChecks()
  customFoodTotalsMatchFixtureChecks()
  withComponentGramsScalesLinearlyChecks()
  parseFoodResultRejectsBadInputChecks()
  applyFoodPollTransitionsChecks()
  saveCustomFoodChecks()
  retryFoodRequestChecks()
  discardAndRemoveChecks()
  menuExtraFromChecks()
  await clientStatusChecks()
  console.log(`\nВсе проверки food пройдены (${passed} групп).`)
}

main().catch((e) => {
  console.error('\n✗ ТЕСТ FOOD УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
})
