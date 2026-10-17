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
  applyFoodAsk, applyFoodPoll, customExtraFrom, customFoodDeviation, customFoodFromResult, customFoodTotals,
  discardFoodRequest, extraFromCustomFood, isBarcode, labelEnergyCheck, labelEnergyWarning, LABEL_ENERGY_TOLERANCE_KCAL, LABEL_ENERGY_TOLERANCE_PCT, labelExtraFrom,
  logDoneAutoRequests, logDoneLabelRequests, logProductNow, menuExtraFrom, newFoodRequest, newLabelRequest, newProductRequest, normalizeBarcode,
  offWarningText, parseFoodResult, parseOffProduct, pendingAutoRequests, pendingLabelRequests, productExtraFrom, productFactsFrom, productFoodFromFacts,
  productNutrientsFromPrinted, productSourceText, relogCustomFood, removeCustomFood, retryFoodRequest, saveCustomFood, searchCustomFoods, withComponentGrams
} from '../src/core/food'
import type { FoodPollResponse } from '../src/core/food'
import { dayNutrientTotals } from '../src/core/log'
import { isComplete } from '../src/core/nutrition'
import { weekCoverage, weekSummary } from '../src/core/week'
import { askFood, askLabel, askProduct, fetchOffProduct, pollFood, searchOff, SHTURMAN_BASE } from '../src/core/foodClient'
import { NUTRIENT_KEYS } from '../src/core/types'
import type { AppState, CustomFood, Meal, OffProduct, Product, ProductIndex } from '../src/core/types'

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
const LABEL_FIXTURE_PATH = path.join(REPO_ROOT, 'test', 'fixtures', 'label-result.json')

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
}

function loadLabelFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(LABEL_FIXTURE_PATH, 'utf8')) as Record<string, unknown>
}

function emptyState(): AppState {
  return {
    version: 6,
    settings: {
      cycleStartDate: '2026-08-01', cycleShift: 0, targetKcal: 3200, targetProteinG: 120,
      shortcutName: '', cycleStartConfirmed: true, shturmanToken: 'secret-token',
      menuCycleEnabled: false, targetFatG: 0, targetCarbsG: 0
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

// ---- наклейка (spec 2) ------------------------------------------------------

function throws(fn: () => unknown): boolean {
  try { fn() } catch { return true }
  return false
}

function parseLabelFixtureChecks(): void {
  const fixture = loadLabelFixture()
  const result = parseFoodResult(fixture)
  assert(result.spec === 2, `spec ожидался 2, получено ${result.spec}`)
  assert(result.label !== undefined, 'label обязан перенестись в результат')
  assert(result.label!.basis === 'portion' && result.label!.portionG === 370, 'basis/portionG обязаны прийти из фикстуры')
  assert(result.label!.dishNo === 3, `dishNo ожидался 3, получено ${result.label!.dishNo}`)
  assert(result.label!.perPortion.kcal === 442.1, 'perPortion.kcal обязан прийти из фикстуры')
  assert(result.fit !== undefined && result.fit.poor === false, 'fit обязан перенестись в результат')
  assert(result.components.length === 3, `ожидалось 3 компонента, получено ${result.components.length}`)

  // spec 2 допускает пустой состав: КБЖУ есть и без него
  const empty = parseFoodResult({ ...fixture, components: [], fit: undefined })
  assert(empty.components.length === 0 && empty.fit === undefined, 'spec 2 с пустым составом и без fit обязан приниматься')
  group('parseFoodResult: принимает фикстуру label-result.json (spec 2, label, fit) и spec 2 с пустым составом')
}

function parseLabelRejectsChecks(): void {
  const fixture = loadLabelFixture()
  const label = fixture.label as Record<string, unknown>
  assert(throws(() => parseFoodResult({ ...fixture, spec: 3 })), 'spec 3 обязан отвергаться')
  assert(throws(() => parseFoodResult({ ...fixture, spec: 0 })), 'spec 0 обязан отвергаться')
  assert(throws(() => parseFoodResult({ ...fixture, label: undefined })), 'spec 2 без label обязан отвергаться')
  const { perPortion: _perPortion, ...withoutPerPortion } = label
  assert(throws(() => parseFoodResult({ ...fixture, label: withoutPerPortion })), 'label без perPortion обязан отвергаться')
  assert(throws(() => parseFoodResult({ ...fixture, label: { ...label, basis: 'kg' } })), "basis 'kg' обязан отвергаться")
  assert(throws(() => parseFoodResult({ ...fixture, label: { ...label, portionG: 0 } })), 'portionG 0 обязан отвергаться')
  assert(throws(() => parseFoodResult({ ...fixture, label: { ...label, printed: { kcal: -1, p: 0, f: 0, c: 0 } } })), 'отрицательные printed обязаны отвергаться')
  assert(throws(() => parseFoodResult({ ...fixture, label: { ...label, ingredients: 'лук' } })), 'ingredients не списком обязан отвергаться')
  assert(throws(() => parseFoodResult({ ...fixture, fit: { poor: 'no' } })), 'битый fit обязан отвергаться')

  // spec 1 по-прежнему требует непустой состав
  const textFixture = loadFixture() as Record<string, unknown>
  assert(throws(() => parseFoodResult({ ...textFixture, components: [] })), 'пустые components при spec 1 обязаны отвергаться')
  group('parseFoodResult: отвергает spec 3, label без perPortion, basis kg, битый fit, пустые components при spec 1')
}

function parseDishNoChecks(): void {
  const fixture = loadLabelFixture()
  const label = fixture.label as Record<string, unknown>
  const withDish = (dishNo: unknown) => ({ ...fixture, label: { ...label, dishNo } })

  const absent = { ...label }
  delete absent.dishNo
  assert(parseFoodResult({ ...fixture, label: absent }).label!.dishNo === undefined, 'отсутствующий dishNo обязан остаться отсутствующим')
  assert(parseFoodResult(withDish(null)).label!.dishNo === null, 'dishNo null обязан приниматься')
  assert(parseFoodResult(withDish(1)).label!.dishNo === 1, 'dishNo 1 обязан приниматься')
  assert(parseFoodResult(withDish(12)).label!.dishNo === 12, 'dishNo 12 обязан приниматься')
  for (const bad of [0, 13, 3.5, -1, '3', NaN, true]) {
    assert(throws(() => parseFoodResult(withDish(bad))), `dishNo ${JSON.stringify(bad)} обязан отвергаться`)
  }
  group('parseFoodResult: dishNo - отсутствует, null или целое 1..12, иное отказ')
}

function labelEnergyCheckChecks(): void {
  const ref = labelEnergyCheck({ kcal: 442.1, p: 47.7, f: 19.7, c: 18.5 })
  assert(ref.ok, 'эталон Avocado 442.1/47.7/19.7/18.5 обязан сходиться')
  assert(ref.deviationPct !== null && Math.abs(ref.deviationPct) < 0.01, `отклонение эталона ожидалось 0, получено ${ref.deviationPct}`)
  assert(approx(ref.atwaterKcal, 442.1, 1e-6), `atwater эталона ожидался 442.1, получено ${ref.atwaterKcal}`)

  const zeros = labelEnergyCheck({ kcal: 0, p: 0, f: 0, c: 0 })
  assert(zeros.ok && zeros.deviationPct === null && zeros.atwaterKcal === 0, 'все нули: ok, отклонения нет')
  const kcalOnly = labelEnergyCheck({ kcal: 100, p: 0, f: 0, c: 0 })
  assert(!kcalOnly.ok && kcalOnly.deviationPct === null, 'ккал без БЖУ: не сходится, отклонение null')

  // допуск: max(2 ккал, 2 % от атуотера)
  assert(labelEnergyCheck({ kcal: 100, p: 24.525, f: 0, c: 0 }).ok, '100 ккал при atwater 98.1: ok')
  assert(labelEnergyCheck({ kcal: 50, p: 12.125, f: 0, c: 0 }).ok, '50 ккал при atwater 48.5: ok по абсолютному допуску')
  assert(!labelEnergyCheck({ kcal: 50, p: 11.75, f: 0, c: 0 }).ok, '50 ккал при atwater 47: не ok')
  assert(labelEnergyCheck({ kcal: 2, p: 0, f: 0, c: 0 }).ok, 'atwater 0 и 2 ккал: ok')
  assert(!labelEnergyCheck({ kcal: 2.5, p: 0, f: 0, c: 0 }).ok, 'atwater 0 и 2.5 ккал: не ok')
  assert(LABEL_ENERGY_TOLERANCE_KCAL === 2 && LABEL_ENERGY_TOLERANCE_PCT === 2, 'константы допуска')
  group('labelEnergyCheck: эталон ok и 0 %, нули, допуск max(2 ккал, 2 %)')
}

/* Опечатка в одной цифре обязана ловиться. */
function labelEnergyMisreadChecks(): void {
  const misread = labelEnergyCheck({ kcal: 442.1, p: 41.7, f: 19.7, c: 18.5 })
  assert(!misread.ok, `белок 41.7 вместо 47.7 обязан давать ok:false (отклонение ${misread.deviationPct}%)`)
  const fat = labelEnergyCheck({ kcal: 442.1, p: 47.7, f: 18.7, c: 18.5 })
  assert(!fat.ok, `жиры 18.7 вместо 19.7 обязаны давать ok:false (отклонение ${fat.deviationPct}%)`)
  group('labelEnergyCheck: белок 41.7 и жиры 18.7 не ok')
}

function labelEnergyWarningChecks(): void {
  assert(labelEnergyWarning({ kcal: 442.1, p: 47.7, f: 19.7, c: 18.5 }) === null, 'эталон: предупреждения нет')
  const text = labelEnergyWarning({ kcal: 442.1, p: 41.7, f: 19.7, c: 18.5 })
  assert(text === 'Числа с наклейки не сходятся: ккал 442, а по БЖУ 418. Проверь снимок.', `текст предупреждения: ${text}`)
  group('labelEnergyWarning: null при ok, округлённый текст при расхождении')
}

function labelFoodFrom(): ReturnType<typeof customFoodFromResult> {
  return customFoodFromResult(parseFoodResult(loadLabelFixture()), 'food:label-job', 'label-food-1', '2026-10-17T12:00:00')
}

function labelTotalsChecks(): void {
  const food = labelFoodFrom()
  assert(food.label !== undefined && food.fit !== undefined, 'customFoodFromResult обязан копировать label и fit')
  const totals = customFoodTotals(food)
  assert(totals.kbju === food.label!.perPortion || (totals.kbju.kcal === 442.1 && totals.kbju.p === 47.7 && totals.kbju.f === 19.7 && totals.kbju.c === 18.5),
    `kbju еды по наклейке обязано быть perPortion, получено ${JSON.stringify(totals.kbju)}`)
  const sumKcal = food.components.reduce((s, c) => s + c.per100.kbju.kcal * c.grams / 100, 0)
  assert(Math.abs(sumKcal - 442.1) > 1, 'проверка осмысленна только если сумма компонентов отличается от напечатанного')
  assert(NUTRIENT_KEYS.every(k => totals.nutrients[k] !== undefined), 'nutrients обязаны быть по всем ключам')

  // правка граммов не двигает КБЖУ еды по наклейке
  const edited = withComponentGrams(food, 0, food.components[0].grams * 3)
  const after = customFoodTotals(edited)
  assert(after.kbju.kcal === 442.1 && after.kbju.p === 47.7, 'withComponentGrams не должен менять kbju еды с label')
  assert(after.nutrients.fiber.value !== totals.nutrients.fiber.value || edited.components[0].grams !== food.components[0].grams,
    'нутриенты по составу обязаны следовать за граммами')
  group('customFoodTotals: еда с label отдаёт perPortion, withComponentGrams kbju не меняет')
}

function customFoodDeviationChecks(): void {
  const food = labelFoodFrom()
  const base = customFoodDeviation(food)
  assert(base !== null && base.poor === false, 'подогнанная фикстура не должна быть poor')
  assert(base!.massDeviationPct !== null && Math.abs(base!.massDeviationPct! - (-17.6)) < 0.11, `massDeviationPct фикстуры ожидался около -17.6, получено ${base!.massDeviationPct}`)

  // состав, раздутый в полтора раза: ккал по USDA уходят больше чем на 30 %
  const inflated = { ...food, components: food.components.map(c => ({ ...c, grams: c.grams * 1.5 })) }
  const poor = customFoodDeviation(inflated)
  assert(poor !== null && poor.poor === true, 'расхождение 50 % обязано давать poor:true')
  assert(poor!.deviationPct.kcal !== null && poor!.deviationPct.kcal! > 30, `kcal-отклонение ожидалось больше 30, получено ${poor!.deviationPct.kcal}`)

  // нет наклейки или нет состава - сравнивать не с чем
  const text = customFoodFromResult(parseFoodResult(loadFixture()), 'job', 'text-1', '2026-10-17T12:00:00')
  assert(customFoodDeviation(text) === null, 'у еды без label отклонения нет')
  assert(customFoodDeviation({ ...food, components: [] }) === null, 'у еды без состава отклонения нет')

  // напечатанный ноль: отклонение от нуля не определено
  const zeroFat = customFoodDeviation({ ...food, label: { ...food.label!, perPortion: { ...food.label!.perPortion, f: 0 } } })
  assert(zeroFat!.deviationPct.f === null, 'отклонение от нулевого напечатанного обязано быть null')

  // без веса порции массы-отклонения нет
  const noMass = customFoodDeviation({ ...food, label: { ...food.label!, portionG: null } })
  assert(noMass!.massDeviationPct === null, 'без portionG massDeviationPct обязан быть null')
  group('customFoodDeviation: poor на расхождении 50 %, null без label/состава, нули и вес порции')
}

function labelExtraChecks(): void {
  const food = labelFoodFrom()
  const extra = labelExtraFrom(food, 'dinner', 0.75, 'x-1', '2026-10-17T19:00:00')
  assert(extra.kind === 'label' && extra.titleHy === food.label!.titleHy, 'extra обязана нести titleHy с наклейки')
  assert(extra.kbju.kcal === 442.1 && extra.fraction === 0.75, 'extra: полная порция по наклейке и доля как передана')
  assert(extra.kind === 'label' && extra.customFoodId === 'label-food-1' && extra.source === food.source, 'extra обязана ссылаться на еду и источник')
  const text = customFoodFromResult(parseFoodResult(loadFixture()), 'job', 'text-1', '2026-10-17T12:00:00')
  assert(throws(() => labelExtraFrom(text, 'dinner', 1, 'x-2', '2026-10-17T19:00:00')), 'labelExtraFrom без label обязан бросать')
  group('labelExtraFrom: kind label, titleHy, kbju по наклейке; без label бросает')
}

function labelRequestChecks(): void {
  const target = { date: '2026-10-17', slot: 'lunch' as const }
  const text = newFoodRequest('t-1', 'тирамису', 120, target, '2026-10-17T10:00:00')
  assert(text.kind === 'text' && text.fraction === 1, "newFoodRequest обязан давать kind 'text' и fraction 1")

  const req = newLabelRequest('l-1', '', 350, target, 0.5, '2026-10-17T10:00:00')
  assert(req.kind === 'label' && req.text === '' && req.grams === 350 && req.fraction === 0.5 && req.status === 'pending', 'newLabelRequest: kind label, пустая заметка допустима')
  for (const bad of [0, 1.5, -0.1, NaN]) {
    assert(throws(() => newLabelRequest('l-2', '', null, target, bad, '2026-10-17T10:00:00')), `newLabelRequest с долей ${bad} обязан бросать`)
  }

  // повтор наклейки возможен только пересъёмкой: состояние не меняется
  const state: AppState = { ...emptyState(), foodRequests: [{ ...req, status: 'failed', error: 'не читается' }] }
  assert(retryFoodRequest(state, 'l-1', 'l-new', '2026-10-17T11:00:00') === state, 'retryFoodRequest на label обязан вернуть то же состояние')
  group('newLabelRequest/newFoodRequest: kind и fraction; retryFoodRequest на label ничего не меняет')
}

function labelWithoutCompositionChecks(): void {
  const noComposition = { ...labelFoodFrom(), components: [] }
  const totals = customFoodTotals(noComposition)
  assert(totals.kbju.kcal === 442.1, 'КБЖУ еды по наклейке без состава - напечатанное')
  assert(NUTRIENT_KEYS.every(k => totals.nutrients[k].known === 0 && totals.nutrients[k].total === 1),
    'наклейка без состава обязана отдавать одну неизвестную позицию (known 0, total 1) по каждому нутриенту')

  // день из приёма меню (клетчатка известна) и пустой наклейки: сумма не может быть полной
  const extra = labelExtraFrom(noComposition, 'dinner', 0.5, 'x-empty', '2026-10-17T19:00:00')
  const nutrients = customFoodTotals(noComposition).nutrients
  const menuNutrients = Object.fromEntries(NUTRIENT_KEYS.map(k => [k, { value: 5, known: 1, total: 1 }])) as typeof nutrients
  const day = {
    cycleDay: null,
    meals: {
      breakfast: {
        slot: 'breakfast' as const, mealId: 'm-1', status: 'eaten' as const, fraction: 1,
        kbju: { kcal: 300, p: 20, f: 10, c: 30 }, nutrients: menuNutrients, title: 'Завтрак', loggedAt: '2026-10-17T08:00:00'
      }
    },
    extras: [extra]
  } as AppState['log'][string]
  assert(extra.nutrients === nutrients || JSON.stringify(extra.nutrients) === JSON.stringify(nutrients), 'extra несёт нутриенты еды')
  const sum = dayNutrientTotals(day)
  for (const k of NUTRIENT_KEYS) {
    assert(sum[k].known < sum[k].total, `${k}: день с наклейкой без состава обязан быть неполным, получено ${JSON.stringify(sum[k])}`)
    assert(!isComplete(sum[k]), `${k}: isComplete обязан быть false`)
  }

  // неделя считает такой день частичным
  const week = weekSummary({ '2026-10-17': day }, '2026-10-17', 1, { expectMenuSlots: false })
  assert(week.nutrients.every(n => n.partialDays === 1), 'неделя обязана считать день с пустой наклейкой частичным по каждому нутриенту')
  const coverage = weekCoverage(week, {})
  assert(coverage.every(c => c.partialDays === 1), 'weekCoverage: partialDays обязан быть 1 по каждому нутриенту')
  group('наклейка без состава: одна неизвестная позиция, день неполный, неделя считает его частичным')
}

function pendingLabelRequestsChecks(): void {
  const fixture = loadLabelFixture()
  const yesterday = { date: '2026-10-16', slot: 'dinner' as const }
  const today = { date: '2026-10-17', slot: 'lunch' as const }
  let state = emptyState()
  state = applyFoodAsk(state, newLabelRequest('lab-old-pending', '', null, yesterday, 1, '2026-10-16T23:50:00'))
  state = applyFoodAsk(state, newLabelRequest('lab-old-expired', '', null, yesterday, 1, '2026-10-15T10:00:00'))
  state = applyFoodAsk(state, newLabelRequest('lab-today', '', null, today, 1, '2026-10-17T12:00:00'))
  state = applyFoodAsk(state, newLabelRequest('lab-done', '', null, today, 1, '2026-10-17T12:01:00'))
  state = applyFoodAsk(state, newFoodRequest('txt-old', 'тирамису', 120, yesterday, '2026-10-16T18:02:00'))
  state = applyFoodPoll(state, 'lab-old-expired', { ok: true, id: 'lab-old-expired', state: 'expired', pcAgo: null } as unknown as FoodPollResponse, '2026-10-17T10:30:00')
  state = applyFoodPoll(state, 'lab-done', { ok: true, id: 'lab-done', state: 'done', result: fixture, pcAgo: 1, modelOk: true }, '2026-10-17T12:30:00')
  assert(state.foodRequests.find(r => r.id === 'lab-old-expired')?.status === 'expired', 'заказ lab-old-expired обязан стать expired')
  const ids = pendingLabelRequests(state.foodRequests).map(r => r.id)
  assert(ids.includes('lab-old-pending') && ids.includes('lab-today'), `заказы любой даты обязаны попасть на сводку, получено ${JSON.stringify(ids)}`)
  assert(ids.includes('lab-old-expired'), 'протухший заказ вчерашнего дня обязан попасть на сводку: к нему нужны «Переснять» и «Убрать»')
  assert(!ids.includes('lab-done') && !ids.includes('txt-old'), 'готовые и текстовые заказы на сводку не попадают')
  group('pendingLabelRequests: заказы по наклейкам любой даты, включая expired; без done и текстовых')
}

function logDoneLabelRequestsChecks(): void {
  const target = { date: '2026-10-16', slot: 'dinner' as const }
  const fixture = loadLabelFixture()
  let state = emptyState()
  state = applyFoodAsk(state, newLabelRequest('lab-done', '', null, target, 0.5, '2026-10-16T18:00:00'))
  state = applyFoodAsk(state, newLabelRequest('lab-wait', '', null, target, 1, '2026-10-16T18:01:00'))
  state = applyFoodAsk(state, newFoodRequest('txt-done', 'тирамису', 120, target, '2026-10-16T18:02:00'))
  const done = (id: string, result: unknown): FoodPollResponse => ({ ok: true, id, state: 'done', result, pcAgo: 1, modelOk: true })
  state = applyFoodPoll(state, 'lab-done', done('lab-done', fixture), '2026-10-16T18:30:00')
  state = applyFoodPoll(state, 'txt-done', done('txt-done', loadFixture()), '2026-10-16T18:30:00')

  const ids = ['food-A', 'extra-A', 'food-B', 'extra-B']
  let n = 0
  const seen: string[] = []
  const next = logDoneLabelRequests(state, '2026-10-17T09:00:00', () => { const id = ids[n++]; seen.push(id); return id }, () => null)

  assert(n === 2, `nextId обязан вызываться дважды на один заказ (еда и запись), вызвано ${n}`)
  assert(next.foodRequests.find(r => r.id === 'lab-done') === undefined, 'записанный заказ по наклейке обязан уйти из очереди')
  assert(next.foodRequests.some(r => r.id === 'lab-wait'), 'заказ по наклейке без результата остаётся в очереди')
  assert(next.foodRequests.some(r => r.id === 'txt-done' && r.status === 'done'), 'текстовый done не трогается')
  assert(next.customFoods['food-A'] !== undefined && next.customFoods['food-A'].jobId === 'food:lab-done', 'еда обязана попасть в книгу с jobId food:<id>')
  const day = next.log['2026-10-16']
  assert(day !== undefined && day.cycleDay === null, 'день обязан появиться на дату заказа с cycleDay из колбэка (null)')
  const extra = day.extras.find(e => e.id === 'extra-A')
  assert(extra !== undefined && extra.kind === 'label', 'запись kind label обязана появиться в дне')
  assert(extra!.fraction === 0.5 && extra!.slot === 'dinner', 'запись обязана нести долю и приём заказа')
  assert(extra!.kbju.kcal === 442.1, 'запись обязана нести напечатанные числа')
  assert(day.extras.length === 1, 'текстовый done не должен записаться в журнал')
  assert(next.log['2026-10-17'] === undefined, 'запись идёт на дату заказа, а не на now')

  // детерминированность: те же входы - то же состояние
  let m = 0
  const again = logDoneLabelRequests(state, '2026-10-17T09:00:00', () => ids[m++], () => null)
  assert(JSON.stringify(again) === JSON.stringify(next), 'logDoneLabelRequests обязана быть детерминированной при том же nextId')

  // без заказов по наклейке состояние то же
  const plain = emptyState()
  assert(logDoneLabelRequests(plain, '2026-10-17T09:00:00', () => 'x', () => 1).log === plain.log, 'без заказов по наклейке журнал не меняется')
  group('logDoneLabelRequests: пишет extra label с долей заказа, убирает заказ, текстовые done не трогает')
}

// ---- товар Open Food Facts -------------------------------------------------

const PRODUCT_FIXTURE_PATH = path.join(REPO_ROOT, 'test', 'fixtures', 'product-result.json')

function loadProductFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(PRODUCT_FIXTURE_PATH, 'utf8')) as Record<string, unknown>
}

/** Snickers как его отдаёт воркер: товар без граммов и порции. */
function snickersOff(): OffProduct {
  const facts = parseFoodResult(loadProductFixture()).product!
  const { grams: _grams, perPortion: _perPortion, remark: _remark, ...off } = facts
  return off
}

function productFoodFrom(id = 'prod-food-1', createdAt = '2026-10-17T12:00:00'): CustomFood {
  return customFoodFromResult(parseFoodResult(loadProductFixture()), 'food:prod-job', id, createdAt)
}

const PRODUCT_TARGET = { date: '2026-10-16', slot: 'dinner' as const }

function parseProductFixtureChecks(): void {
  const result = parseFoodResult(loadProductFixture())
  assert(result.spec === 3 && result.product !== undefined, 'spec 3 обязан нести product')
  assert(result.product!.code === '5000159461122' && result.product!.grams === 50, 'product: код и граммы из фикстуры')
  assert(result.product!.perPortion.kcal === 240.5, `product.perPortion.kcal ожидалось 240.5, получено ${result.product!.perPortion.kcal}`)
  assert(result.components.length === 3 && result.fit !== undefined, 'состав и fit фикстуры обязаны разобраться')
  assert(result.label === undefined, 'у spec 3 label нет')
  group('parseFoodResult: spec 3 из product-result.json разбирается')
}

function parseProductMissingChecks(): void {
  const raw = loadProductFixture()
  const { product: _product, ...withoutProduct } = raw
  assert(throws(() => parseFoodResult(withoutProduct)), 'spec 3 без product обязан бросать')
  assert(throws(() => parseFoodResult({ ...raw, product: { ...(raw.product as object), grams: 0 } })), 'product.grams 0 обязан бросать')
  group('parseFoodResult: spec 3 без product бросает')
}

function parseProductEmptyCompositionChecks(): void {
  const raw = loadProductFixture()
  const { fit: _fit, ...rest } = raw
  const empty = parseFoodResult({ ...rest, components: [], source: 'Open Food Facts' })
  assert(empty.components.length === 0 && empty.product !== undefined && empty.fit === undefined, 'spec 3 с пустым составом обязан приниматься')
  assert(throws(() => parseFoodResult({ ...rest, spec: 1, components: [] })), 'spec 1 с пустым составом по-прежнему бросает')
  group('parseFoodResult: spec 3 с пустым составом принимается')
}

function parseOffProductChecks(): void {
  const good = snickersOff()
  const parsed = parseOffProduct(JSON.parse(JSON.stringify(good)))
  assert(JSON.stringify(parsed) === JSON.stringify(good), 'годный товар обязан разобраться без потерь')

  assert(throws(() => parseOffProduct({ ...good, per100: { ...good.per100, kcal: NaN } })), 'per100 с NaN обязан бросать')
  assert(throws(() => parseOffProduct({ ...good, per100: { ...good.per100, p: -1 } })), 'отрицательное per100 обязано бросать')
  assert(throws(() => parseOffProduct({ ...good, printedMicro: { fiber: 0 } })), 'printedMicro = 0 обязан бросать')
  assert(throws(() => parseOffProduct({ ...good, printedMicro: { sodium: -3 } })), 'printedMicro < 0 обязан бросать')
  assert(throws(() => parseOffProduct({ ...good, code: '123' })), 'короткий штрихкод обязан бросать')
  assert(throws(() => parseOffProduct({ ...good, name: '' })), 'пустое название обязано бросать')
  assert(throws(() => parseOffProduct({ ...good, plausible: 'yes' })), 'plausible не булево обязано бросать')

  const foreign = parseOffProduct({ ...good, printedMicro: { fiber: 4.3, vitC: 80, zinc: 0 } })
  assert(JSON.stringify(foreign.printedMicro) === '{"fiber":4.3}', `чужие ключи printedMicro обязаны игнорироваться, получено ${JSON.stringify(foreign.printedMicro)}`)
  group('parseOffProduct: годный принимается, per100 с NaN и printedMicro <= 0 бросают, чужой ключ игнорируется')
}

function productFactsFromChecks(): void {
  const facts = productFactsFrom(snickersOff(), 50)
  assert(facts.grams === 50, 'граммы обязаны сохраниться')
  assert(facts.perPortion.kcal === 240.5 && facts.perPortion.p === 4.3 && facts.perPortion.f === 11.25 && facts.perPortion.c === 30.25,
    `perPortion Snickers 50 г ожидалось 240.5/4.3/11.25/30.25, получено ${JSON.stringify(facts.perPortion)}`)
  const third = productFactsFrom(snickersOff(), 33)
  assert(third.perPortion.kcal === 158.73, `481 x 33 / 100 с округлением до 2 знаков ожидалось 158.73, получено ${third.perPortion.kcal}`)
  group('productFactsFrom: Snickers 50 г -> perPortion 240.5 ккал, 33 г округляется до 2 знаков')
}

function productNutrientsFromPrintedChecks(): void {
  const nutrients = productNutrientsFromPrinted(productFactsFrom(snickersOff(), 50))
  assert(NUTRIENT_KEYS.every(k => nutrients[k] !== undefined), 'nutrients обязаны быть по всем ключам')
  assert(approx(nutrients.fiber.value, 2.15) && nutrients.fiber.known === 1 && nutrients.fiber.total === 1, `fiber ожидалось 2.15 known 1 total 1, получено ${JSON.stringify(nutrients.fiber)}`)
  assert(approx(nutrients.sodium.value, 125.75) && approx(nutrients.cholesterol.value, 3.35), 'sodium и cholesterol: напечатанное x 0.5')
  assert(nutrients.vitC.value === 0 && nutrients.vitC.known === 0 && nutrients.vitC.total === 1, `vitC ожидалось known 0 total 1, получено ${JSON.stringify(nutrients.vitC)}`)

  const partial = productNutrientsFromPrinted(productFactsFrom({ ...snickersOff(), printedMicro: {} }, 50))
  assert(partial.fiber.known === 0 && partial.fiber.total === 1, 'без напечатанного клетчатка честно неизвестна')
  group('productNutrientsFromPrinted: fiber 2.15 known 1 total 1, vitC known 0 total 1')
}

function productTotalsWithoutCompositionChecks(): void {
  const food = productFoodFromFacts(snickersOff(), 50, '', 'food:j', 'pf-1', '2026-10-17T12:00:00')
  const totals = customFoodTotals(food)
  assert(totals.kbju === food.product!.perPortion, 'КБЖУ товара обязано быть perPortion')
  assert(totals.kbju.kcal === 240.5, 'kcal 240.5')
  assert(approx(totals.nutrients.fiber.value, 2.15) && totals.nutrients.fiber.known === 1, 'напечатанное попадает в нутриенты')
  assert(totals.nutrients.vitC.known === 0 && totals.nutrients.vitC.total === 1, 'без состава остальное неизвестно, а не ноль позиций')
  group('customFoodTotals товара без состава = perPortion + напечатанное')
}

function productTotalsMatchFixtureChecks(): void {
  const fixture = loadProductFixture()
  const food = productFoodFrom()
  const totals = customFoodTotals(food)
  const expected = (fixture.nutrients as Record<string, { value: number; known: number; total: number }>)
  for (const key of NUTRIENT_KEYS) {
    const want = expected[key]
    const got = totals.nutrients[key]
    assert(approx(got.value, want.value, 1e-6) && got.known === want.known && got.total === want.total,
      `nutrients.${key}: резолвер ${JSON.stringify(want)}, приложение ${JSON.stringify(got)}`)
  }
  assert(JSON.stringify(totals.kbju) === JSON.stringify(fixture.kbju), 'kbju приложения обязано совпадать с резолвером')
  assert(approx(totals.nutrients.fiber.value, 2.15) && approx(totals.nutrients.sodium.value, 125.75) && approx(totals.nutrients.cholesterol.value, 3.35)
    && approx(totals.nutrients.sugar.value, 25.9) && approx(totals.nutrients.satFat.value, 3.95), 'пять напечатанных перекрывают состав')
  assert(totals.nutrients.vitC.known === 3 && totals.nutrients.vitC.total === 3, 'остальные микро идут из состава')
  group('customFoodTotals товара с составом совпадает с nutrients из product-result.json')
}

function productDeviationChecks(): void {
  const fixture = loadProductFixture()
  const food = productFoodFrom()
  const dev = customFoodDeviation(food)
  assert(dev !== null && JSON.stringify(dev) === JSON.stringify(fixture.fit), `отклонение приложения обязано совпадать с fit резолвера: ${JSON.stringify(dev)}`)
  assert(dev!.poor === true, 'условный состав фикстуры poor')
  const bare = productFoodFromFacts(snickersOff(), 50, '', 'food:j', 'pf-2', '2026-10-17T12:00:00')
  assert(customFoodDeviation(bare) === null, 'у товара без состава отклонения нет')
  group('customFoodDeviation для товара: цель perPortion, масса grams, совпадает с fit резолвера')
}

function productExtraChecks(): void {
  const food = productFoodFrom('prod-food-1')
  const extra = productExtraFrom(food, 'snack', 0.5, 'x-1', '2026-10-17T15:00:00')
  assert(extra.kind === 'product' && extra.code === '5000159461122' && extra.url === food.product!.url, 'extra: kind, code, url')
  assert(extra.kind === 'product' && extra.source === food.source && extra.customFoodId === 'prod-food-1', 'extra: source и ссылка на еду')
  assert(extra.fraction === 0.5 && extra.slot === 'snack' && extra.kbju.kcal === 240.5, 'extra: полная порция и доля как переданы')
  assert(extraFromCustomFood(food, 'snack', 1, 'x-2', '2026-10-17T15:00:00').kind === 'product', 'extraFromCustomFood: product')
  assert(extraFromCustomFood(labelFoodFrom(), 'snack', 1, 'x-3', '2026-10-17T15:00:00').kind === 'label', 'extraFromCustomFood: label')
  const plain = customFoodFromResult(parseFoodResult(loadFixture()), 'job', 'text-1', '2026-10-17T12:00:00')
  assert(extraFromCustomFood(plain, 'snack', 1, 'x-4', '2026-10-17T15:00:00').kind === 'custom', 'extraFromCustomFood: custom')
  const noProduct = customFoodFromResult(parseFoodResult(loadFixture()), 'job', 'text-1', '2026-10-17T12:00:00')
  assert(throws(() => productExtraFrom(noProduct, 'snack', 1, 'x-5', '2026-10-17T15:00:00')), 'productExtraFrom без product обязан бросать')
  group('productExtraFrom: kind product, code, url, source; extraFromCustomFood разводит три вида')
}

function newProductRequestChecks(): void {
  const req = newProductRequest('p-1', snickersOff(), 50, '', PRODUCT_TARGET, 0.5, '2026-10-16T18:00:00')
  assert(req.kind === 'product' && req.grams === 50 && req.text === '' && req.fraction === 0.5 && req.status === 'pending' && req.product?.code === '5000159461122',
    'newProductRequest: kind, граммы, заметка, доля, факты товара')
  for (const bad of [0, 1.5, -0.1, NaN]) {
    assert(throws(() => newProductRequest('p-2', snickersOff(), 50, '', PRODUCT_TARGET, bad, '2026-10-16T18:00:00')), `доля ${bad} обязана бросать`)
  }
  for (const bad of [0, -5, NaN]) {
    assert(throws(() => newProductRequest('p-3', snickersOff(), bad, '', PRODUCT_TARGET, 1, '2026-10-16T18:00:00')), `граммы ${bad} обязаны бросать`)
  }
  group('newProductRequest: доля вне (0, 1] бросает')
}

function logDoneAutoRequestsChecks(): void {
  const done = (id: string, result: unknown): FoodPollResponse => ({ ok: true, id, state: 'done', result, pcAgo: 1, modelOk: true })
  let state = emptyState()
  state = applyFoodAsk(state, newProductRequest('prod-done', snickersOff(), 50, '', PRODUCT_TARGET, 0.5, '2026-10-16T18:00:00'))
  state = applyFoodAsk(state, newProductRequest('prod-wait', snickersOff(), 50, '', PRODUCT_TARGET, 1, '2026-10-16T18:01:00'))
  state = applyFoodAsk(state, newFoodRequest('txt-done', 'тирамису', 120, PRODUCT_TARGET, '2026-10-16T18:02:00'))
  state = applyFoodPoll(state, 'prod-done', done('prod-done', loadProductFixture()), '2026-10-16T18:30:00')
  state = applyFoodPoll(state, 'txt-done', done('txt-done', loadFixture()), '2026-10-16T18:30:00')
  assert(state.foodRequests.find(r => r.id === 'prod-done')?.status === 'done', 'заказ по товару обязан стать done с разобранным product-result')

  const ids = ['food-A', 'extra-A']
  let n = 0
  const next = logDoneAutoRequests(state, '2026-10-17T09:00:00', () => ids[n++], () => null)
  assert(n === 2, `nextId обязан вызываться дважды на заказ, вызвано ${n}`)
  assert(next.foodRequests.find(r => r.id === 'prod-done') === undefined, 'записанный заказ уходит из очереди')
  assert(next.foodRequests.some(r => r.id === 'prod-wait'), 'заказ без результата остаётся')
  assert(next.foodRequests.some(r => r.id === 'txt-done' && r.status === 'done'), 'текстовый done не трогается')
  assert(next.customFoods['food-A']?.product?.code === '5000159461122' && next.customFoods['food-A'].jobId === 'food:prod-done', 'еда с product попадает в книгу')
  const day = next.log['2026-10-16']
  const extra = day?.extras.find(e => e.id === 'extra-A')
  assert(extra !== undefined && extra.kind === 'product' && extra.fraction === 0.5 && extra.slot === 'dinner' && extra.kbju.kcal === 240.5,
    'запись kind product с целью и долей заказа')
  assert(day.extras.length === 1 && next.log['2026-10-17'] === undefined, 'пишется только заказ по товару и на дату заказа')

  // синоним
  assert(logDoneLabelRequests === logDoneAutoRequests, 'logDoneLabelRequests - синоним')
  // наклейка по-прежнему пишется тем же проходом
  let withLabel = applyFoodAsk(emptyState(), newLabelRequest('lab-done', '', null, PRODUCT_TARGET, 1, '2026-10-16T18:00:00'))
  withLabel = applyFoodPoll(withLabel, 'lab-done', done('lab-done', loadLabelFixture()), '2026-10-16T18:30:00')
  const labelIds = ['lf', 'le']
  let k = 0
  const labelNext = logDoneAutoRequests(withLabel, '2026-10-17T09:00:00', () => labelIds[k++], () => null)
  assert(labelNext.log['2026-10-16'].extras[0].kind === 'label', 'наклейка пишется тем же проходом')
  group('logDoneAutoRequests: готовый product становится едой и записью с целью и долей заказа, заказ снят, текстовый не тронут; logDoneLabelRequests - синоним')
}

function logProductNowChecks(): void {
  const request = newProductRequest('now-1', snickersOff(), 50, 'без орехов', PRODUCT_TARGET, 0.5, '2026-10-16T18:00:00')
  const queued = applyFoodAsk(emptyState(), request)
  const ids = ['nf', 'ne']
  let n = 0
  const next = logProductNow(queued, request, () => ids[n++], '2026-10-17T09:00:00', () => 3)
  const food = next.customFoods.nf
  assert(food !== undefined && food.source === 'Open Food Facts' && food.components.length === 0 && food.spec === 3, 'еда: source OFF, состава нет')
  assert(food.request.text === 'без орехов' && food.request.grams === 50 && food.jobId === 'food:now-1', 'еда несёт заметку, граммы и jobId')
  const day = next.log['2026-10-16']
  const extra = day.extras.find(e => e.id === 'ne')
  assert(day.cycleDay === 3 && extra !== undefined && extra.kind === 'product' && extra.fraction === 0.5, 'запись на дату заказа с долей заказа')
  assert(extra!.nutrients.fiber.known === 1 && approx(extra!.nutrients.fiber.value, 2.15), 'напечатанное известно')
  assert(extra!.nutrients.vitC.known === 0 && extra!.nutrients.vitC.total === 1, 'остальное честно неизвестно')
  assert(next.foodRequests.length === 0, 'заказ снят с очереди')
  group('logProductNow: pending product -> запись с source "Open Food Facts", состав пуст, нутриенты честно неизвестны кроме напечатанных, заказ снят')

  // заказа нет в очереди (сетевой отказ из карточки)
  let m = 0
  const loose = logProductNow(emptyState(), request, () => ids[m++], '2026-10-17T09:00:00', () => null)
  assert(loose.log['2026-10-16'].extras.length === 1 && loose.customFoods.nf !== undefined, 'заказ не из очереди тоже записывается')
  group('logProductNow: заказ не из очереди тоже записывается')

  const text = newFoodRequest('t-1', 'тирамису', 120, PRODUCT_TARGET, '2026-10-16T18:00:00')
  const textState = applyFoodAsk(emptyState(), text)
  assert(logProductNow(textState, text, () => 'x', '2026-10-17T09:00:00', () => null) === textState, 'текстовый заказ состояние не меняет')
  group('logProductNow: текстовый заказ ничего не меняет')
}

function relogCustomFoodChecks(): void {
  const plain = customFoodFromResult(parseFoodResult(loadFixture()), 'job', 'text-1', '2026-10-17T12:00:00')
  const kinds: [CustomFood, string][] = [[plain, 'custom'], [labelFoodFrom(), 'label'], [productFoodFrom(), 'product']]
  for (const [food, kind] of kinds) {
    const state: AppState = { ...emptyState(), customFoods: { [food.id]: food } }
    let n = 0
    const next = relogCustomFood(state, food, '2026-10-18', 'snack', () => `re-${n++}`, '2026-10-18T15:00:00', () => 4)
    const day = next.log['2026-10-18']
    assert(day.cycleDay === 4 && day.extras.length === 1, `${kind}: день создаётся с cycleDay и одной записью`)
    const extra = day.extras[0]
    assert(extra.kind === kind && extra.fraction === 1 && extra.slot === 'snack' && extra.id === 're-0', `${kind}: запись вида ${kind}, доля 1, нужный приём`)
    assert(next.customFoods === state.customFoods && next.foodRequests === state.foodRequests, `${kind}: книга и очередь не меняются`)
    const twice = relogCustomFood(next, food, '2026-10-18', 'dinner', () => `re-${n++}`, '2026-10-18T19:00:00', () => 4)
    assert(twice.log['2026-10-18'].extras.length === 2, `${kind}: повторная запись добавляется рядом`)
  }
  group('relogCustomFood: пишет на дату и приём с долей 1 для custom, label и product')
}

function retryProductChecks(): void {
  const request = newProductRequest('rp-1', snickersOff(), 50, 'заметка', PRODUCT_TARGET, 0.5, '2026-10-16T18:00:00')
  const failed: AppState = { ...emptyState(), foodRequests: [{ ...request, status: 'failed', error: 'сбой' }] }
  const retried = retryFoodRequest(failed, 'rp-1', 'rp-2', '2026-10-16T19:00:00')
  assert(retried.foodRequests.length === 1 && retried.foodRequests[0].id === 'rp-2', 'заказ заменяется новым id')
  const fresh = retried.foodRequests[0]
  assert(fresh.kind === 'product' && fresh.status === 'pending' && fresh.grams === 50 && fresh.text === 'заметка' && fresh.fraction === 0.5
    && fresh.product?.code === '5000159461122' && fresh.askedAt === '2026-10-16T19:00:00' && fresh.error === undefined, 'повтор несёт те же факты, граммы, заметку и долю')
  const broken: AppState = { ...emptyState(), foodRequests: [{ ...request, product: undefined, status: 'failed' }] }
  assert(retryFoodRequest(broken, 'rp-1', 'rp-3', '2026-10-16T19:00:00') === broken, 'без фактов товара повтор невозможен')
  group('retryFoodRequest для product')
}

function pendingAutoRequestsChecks(): void {
  const prod = newProductRequest('pa-1', snickersOff(), 50, '', PRODUCT_TARGET, 1, '2026-10-16T18:00:00')
  const lab = newLabelRequest('pa-2', '', null, PRODUCT_TARGET, 1, '2026-10-16T18:00:00')
  const txt = newFoodRequest('pa-3', 'суп', null, PRODUCT_TARGET, '2026-10-16T18:00:00')
  const doneProd = { ...newProductRequest('pa-4', snickersOff(), 50, '', PRODUCT_TARGET, 1, '2026-10-16T18:00:00'), status: 'done' as const }
  const failedProd = { ...newProductRequest('pa-5', snickersOff(), 50, '', PRODUCT_TARGET, 1, '2026-10-16T18:00:00'), status: 'failed' as const }
  const ids = pendingAutoRequests([prod, lab, txt, doneProd, failedProd]).map(r => r.id)
  assert(ids.join(',') === 'pa-1,pa-2,pa-5', `ожидались pa-1,pa-2,pa-5, получено ${ids.join(',')}`)
  assert(pendingLabelRequests === pendingAutoRequests, 'pendingLabelRequests - синоним')
  group('pendingAutoRequests включает product')
}

function searchCustomFoodsChecks(): void {
  const mk = (id: string, title: string, createdAt: string, text = ''): CustomFood => ({
    ...customFoodFromResult(parseFoodResult(loadFixture()), 'job', id, createdAt), title, request: { text, grams: null }
  })
  const snickers = productFoodFrom('snk', '2026-10-10T12:00:00')
  const borsch = mk('b1', 'Борщ домашний', '2026-10-11T12:00:00')
  const kasha1 = mk('k1', 'Каша овсяная', '2026-10-01T12:00:00')
  const kasha2 = mk('k2', 'Каша гречневая', '2026-10-05T12:00:00')
  const kasha3 = mk('k3', 'Молоко', '2026-10-09T12:00:00', 'овсяная каша на молоке')
  const label = { ...labelFoodFrom(), createdAt: '2026-10-12T12:00:00' }
  const foods = [snickers, borsch, kasha1, kasha2, kasha3, label]
  const ids = (list: CustomFood[]): string => list.map(f => f.id).join(',')

  assert(ids(searchCustomFoods(foods, 'БОРЩ')) === 'b1', 'кириллица без учёта регистра')
  assert(ids(searchCustomFoods(foods, 'борщ дом')) === 'b1', 'токены - подстроки')
  assert(searchCustomFoods(foods, 'борщ гречневая').length === 0, 'все токены обязательны')
  assert(ids(searchCustomFoods(foods, 'овсяная каша')) === 'k3,k1', 'токены ищутся и в исходном тексте, новые сверху')
  assert(ids(searchCustomFoods(foods, 'каша')) === 'k3,k2,k1', 'порядок по createdAt убыванию')
  assert(ids(searchCustomFoods(foods, 'каша', 2)) === 'k3,k2', 'лимит обрезает')
  assert(ids(searchCustomFoods(foods, 'mars')) === 'snk', 'бренд товара участвует в поиске')
  assert(ids(searchCustomFoods(foods, 'Հավի')) === label.id, 'армянское название с наклейки участвует в поиске')
  assert(searchCustomFoods(foods, '').length === 0 && searchCustomFoods(foods, '  ,. ').length === 0, 'пустой запрос -> []')
  assert(ids(searchCustomFoods(foods, '5000159461122')) === 'snk', 'штрихкод находит товар точно')
  assert(ids(searchCustomFoods(foods, '5000 1594 61122')) === 'snk', 'пробелы в штрихкоде не мешают')
  assert(searchCustomFoods(foods, '12345678').length === 0, 'чужой штрихкод ничего не находит')
  group('searchCustomFoods: кириллица, все токены обязательны, порядок по createdAt, штрихкод точно, лимит, пустой запрос -> []')
}

function isBarcodeChecks(): void {
  assert(isBarcode('5000159461122') && isBarcode(' 5000 1594 61122 ') && isBarcode('12345678') && isBarcode('12345678901234'), 'цифры 8-14 - штрихкод')
  assert(!isBarcode('1234567') && !isBarcode('123456789012345') && !isBarcode('50001594611a2') && !isBarcode('') && !isBarcode('snickers'), 'не штрихкод')
  assert(normalizeBarcode(' 5000 1594\t61122 ') === '5000159461122', 'normalizeBarcode убирает пробелы')
  group('isBarcode')
}

function offWarningTextChecks(): void {
  assert(offWarningText('macros-sum-over-100') === 'белки, жиры и углеводы вместе больше 100 г', 'macros-sum-over-100')
  assert(offWarningText('energy-over-ceiling') === 'энергия больше 900 ккал на 100 г', 'energy-over-ceiling')
  assert(offWarningText('energy-mismatch') === 'ккал не сходятся с БЖУ', 'energy-mismatch')
  assert(offWarningText('что-то новое') === 'числа с упаковки не прошли проверку', 'неизвестный код')
  const withUsda = productFoodFrom()
  const bare = productFoodFromFacts(snickersOff(), 50, '', 'food:j', 'pf-3', '2026-10-17T12:00:00')
  assert(productSourceText(withUsda) === 'С упаковки, Open Food Facts · микро по составу USDA', 'подпись товара с составом')
  assert(productSourceText(bare) === 'С упаковки, Open Food Facts · без витаминов', 'подпись товара без состава')
  const entry = productExtraFrom(bare, 'snack', 1, 'x', '2026-10-17T15:00:00')
  assert(entry.kind === 'product' && productSourceText(entry) === 'С упаковки, Open Food Facts · без витаминов', 'подпись записи по source')
  group('offWarningText и productSourceText')
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
  {
    // Воркер отдаёт modelOk: null, пока раннер ни разу не прислал отчёт о модели
    // (pcState в src/worker.js «Штурмана»). Это нормальный ответ, а не брак формы.
    const { fetchFn } = fakeFetch(200, { ok: true, id: 'food:n', state: 'pending', pcAgo: 321, modelOk: null })
    const result = await askFood(SHTURMAN_BASE, 't', { id: 'food:n', text: 'гречка' }, fetchFn)
    assert(result.ok === true && result.response.modelOk === null, `modelOk: null обязан проходить как есть, получено ${JSON.stringify(result)}`)
    const bad = fakeFetch(200, { ok: true, id: 'food:n', state: 'pending', pcAgo: 1, modelOk: 'да' })
    const badResult = await askFood(SHTURMAN_BASE, 't', { id: 'food:n', text: 'гречка' }, bad.fetchFn)
    assert(!badResult.ok && badResult.reason === 'bad-response', 'modelOk не boolean и не null обязан давать bad-response')
  }
  group('foodClient: 401 -> unauthorized, 404 -> not-found, 400 -> bad-request, throw -> network, не-JSON -> bad-response, успех -> {ok:true,response}, modelOk null принят, заголовок и URL верны')
}

async function askLabelChecks(): Promise<void> {
  const okBody: FoodPollResponse = { ok: true, id: 'food:l-1', state: 'pending', pcAgo: 4, modelOk: true }
  {
    const { fetchFn, calls } = fakeFetch(200, okBody)
    const result = await askLabel(SHTURMAN_BASE, 'tok', { id: 'l-1', mime: 'image/jpeg', image: 'QUJD', grams: 350 }, fetchFn)
    assert(result.ok === true, 'успешный ответ обязан давать ok: true')
    assert(calls.length === 1 && calls[0].url === `${SHTURMAN_BASE}/food`, 'ожидался один POST на /food')
    assert(calls[0].init.method === 'POST', 'метод обязан быть POST')
    const headers = calls[0].init.headers as Record<string, string>
    assert(headers.authorization === 'Bearer tok' && headers['content-type'] === 'application/json', 'заголовки authorization и content-type обязаны быть выставлены')
    const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
    assert(sent.kind === 'label' && sent.id === 'l-1' && sent.mime === 'image/jpeg' && sent.image === 'QUJD', 'тело обязано нести kind, id, mime, image')
    assert(sent.note === '' && sent.grams === 350, 'note по умолчанию пустая, grams как передан')
    assert(!('text' in sent), 'поле text в теле наклейки не посылается')
  }
  {
    const { fetchFn, calls } = fakeFetch(200, okBody)
    await askLabel(SHTURMAN_BASE, 'tok', { id: 'l-2', mime: 'image/png', image: 'QUJD', note: 'без соуса' }, fetchFn)
    const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
    assert(sent.note === 'без соуса' && sent.grams === null, 'note передаётся, grams по умолчанию null')
  }
  {
    const { fetchFn } = fakeFetch(413, { ok: false, error: 'снимок слишком большой' })
    const result = await askLabel(SHTURMAN_BASE, 'tok', { id: 'l-3', mime: 'image/jpeg', image: 'QUJD' }, fetchFn)
    assert(!result.ok && result.reason === 'bad-request' && result.error === 'Снимок слишком большой, попробуй переснять ближе.',
      `413 обязан давать bad-request с текстом клиента, получено ${JSON.stringify(result)}`)
  }
  {
    const { fetchFn } = fakeFetch(400, { ok: false, error: 'поле «text» обязательно' })
    const result = await askLabel(SHTURMAN_BASE, 'tok', { id: 'l-4', mime: 'image/jpeg', image: 'QUJD' }, fetchFn)
    assert(!result.ok && result.reason === 'bad-request' && result.error === 'поле «text» обязательно', '400 старого воркера обязан дойти как bad-request с его текстом')
  }
  group('askLabel: POST с kind label без text, 413 -> понятный bad-request, 400 старого воркера доходит')
}

async function askProductChecks(): Promise<void> {
  const okBody: FoodPollResponse = { ok: true, id: 'food:p-1', state: 'pending', pcAgo: 4, modelOk: true }
  {
    const { fetchFn, calls } = fakeFetch(200, okBody)
    const result = await askProduct(SHTURMAN_BASE, 'tok', { id: 'p-1', code: '5000159461122', grams: 50, note: 'без обёртки' }, fetchFn)
    assert(result.ok === true, 'успешный ответ обязан давать ok: true')
    assert(calls.length === 1 && calls[0].url === `${SHTURMAN_BASE}/food` && calls[0].init.method === 'POST', 'ожидался один POST на /food')
    const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
    assert(sent.kind === 'product' && sent.id === 'p-1' && sent.code === '5000159461122' && sent.grams === 50 && sent.note === 'без обёртки',
      `тело обязано нести kind, id, code, grams, note, получено ${JSON.stringify(sent)}`)
    assert(!('text' in sent) && !('target' in sent), 'text и цель в теле не посылаются')
  }
  {
    const { fetchFn, calls } = fakeFetch(200, okBody)
    await askProduct(SHTURMAN_BASE, 'tok', { id: 'p-2', code: '5000159461122', grams: 30 }, fetchFn)
    const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
    assert(sent.note === '', 'note по умолчанию пустая')
  }
  group('askProduct шлёт kind product, code, grams, note')
  {
    const ask = (status: number, body: unknown) =>
      askProduct(SHTURMAN_BASE, 't', { id: 'p-3', code: '5000159461122', grams: 50 }, fakeFetch(status, body).fetchFn)
    const nf = await ask(404, { ok: false, reason: 'no-nutrition', error: 'У товара нет полного КБЖУ' })
    assert(!nf.ok && nf.reason === 'off' && nf.error === 'У товара нет полного КБЖУ', `404 с reason обязан давать off, получено ${JSON.stringify(nf)}`)
    const bad = await ask(502, { ok: false, reason: 'off-unavailable', error: 'Open Food Facts не отвечает' })
    assert(!bad.ok && bad.reason === 'off' && bad.error === 'Open Food Facts не отвечает', `502 с reason обязан давать off, получено ${JSON.stringify(bad)}`)
    const timeout = await ask(504, { ok: false, reason: 'off-timeout', error: 'таймаут' })
    assert(!timeout.ok && timeout.reason === 'off', '504 с reason обязан давать off')
    const old = await ask(404, { ok: false })
    assert(!old.ok && old.reason === 'not-found', '404 без reason остаётся not-found')
    const unauth = await ask(401, {})
    assert(!unauth.ok && unauth.reason === 'unauthorized', '401 остаётся unauthorized')
  }
  group('askProduct: 404/502 с reason -> reason off')
}

async function searchOffChecks(): Promise<void> {
  const good = snickersOff()
  const okBody = { ok: true, q: 'snickers', items: [good], skipped: 2, total: 9, cached: false }
  {
    const { fetchFn, calls } = fakeFetch(200, okBody)
    const result = await searchOff(SHTURMAN_BASE, 'tok', 'сникерс бар', 12, fetchFn)
    assert(result.ok && result.items.length === 1 && result.skipped === 2 && result.total === 9, `200 обязан давать items/skipped/total, получено ${JSON.stringify(result)}`)
    assert(calls[0].url === `${SHTURMAN_BASE}/off/search?q=${encodeURIComponent('сникерс бар')}&n=12`, `неверный URL поиска: ${calls[0].url}`)
    const headers = calls[0].init.headers as Record<string, string>
    assert(calls[0].init.method === 'GET' && headers.authorization === 'Bearer tok', 'GET с Bearer-токеном')
  }
  {
    const broken = { ...okBody, items: [good, { code: '1' }, 5] }
    const result = await searchOff(SHTURMAN_BASE, 't', 'snickers', 12, fakeFetch(200, broken).fetchFn)
    assert(result.ok && result.items.length === 1 && result.skipped === 4, `битые items пропускаются и входят в skipped, получено ${JSON.stringify(result)}`)
  }
  const reasonOf = async (status: number, body: unknown): Promise<string> => {
    const r = await searchOff(SHTURMAN_BASE, 't', 'snickers', 12, fakeFetch(status, body).fetchFn)
    return r.ok ? 'ok' : r.reason
  }
  assert(await reasonOf(404, { ok: false }) === 'old-worker', '404 без reason -> old-worker')
  assert(await reasonOf(502, { ok: false, reason: 'off-unavailable' }) === 'off-unavailable', '502 -> off-unavailable')
  assert(await reasonOf(504, { ok: false, reason: 'off-timeout' }) === 'off-unavailable', '504 -> off-unavailable')
  assert(await reasonOf(401, {}) === 'unauthorized', '401 -> unauthorized')
  assert(await reasonOf(400, { ok: false, error: 'запрос от 2 до 80 символов' }) === 'bad-request', '400 -> bad-request')
  assert(await reasonOf(200, { ok: true }) === 'bad-response', 'тело без items -> bad-response')
  assert(await reasonOf(200, 'строка') === 'bad-response', 'тело не объект -> bad-response')
  const notJson = (async () => ({ ok: true, status: 200, json: async () => { throw new Error('не JSON') } }) as unknown as Response) as typeof fetch
  const nj = await searchOff(SHTURMAN_BASE, 't', 'snickers', 12, notJson)
  assert(!nj.ok && nj.reason === 'bad-response', 'не JSON -> bad-response')
  const netFail = (async () => { throw new Error('offline') }) as typeof fetch
  const net = await searchOff(SHTURMAN_BASE, 'секретный-токен', 'snickers', 12, netFail)
  assert(!net.ok && net.reason === 'network' && !net.error.includes('секретный-токен'), 'сбой fetch -> network без токена в тексте')
  const old = await searchOff(SHTURMAN_BASE, 't', 'snickers', 12, fakeFetch(404, {}).fetchFn)
  assert(!old.ok && old.error === 'Воркер ещё не обновлён: поиск товаров недоступен.', 'текст old-worker по плану')
  group('searchOff: 200 -> items/skipped; 404 без reason -> old-worker; 502 -> off-unavailable; 401 -> unauthorized; не JSON -> bad-response; битый item пропускается')
}

async function fetchOffProductChecks(): Promise<void> {
  const good = snickersOff()
  {
    const { fetchFn, calls } = fakeFetch(200, { ok: true, product: good, cached: true })
    const result = await fetchOffProduct(SHTURMAN_BASE, 'tok', '5000159461122', fetchFn)
    assert(result.ok && JSON.stringify(result.product) === JSON.stringify(good), '200 обязан отдать разобранный товар без потерь')
    assert(calls[0].url === `${SHTURMAN_BASE}/off/product?code=5000159461122`, `неверный URL карточки: ${calls[0].url}`)
  }
  const get = (status: number, body: unknown) => fetchOffProduct(SHTURMAN_BASE, 't', '5000159461122', fakeFetch(status, body).fetchFn)
  const nn = await get(404, { ok: false, reason: 'no-nutrition', error: 'У товара в Open Food Facts нет полного КБЖУ на 100 г' })
  assert(!nn.ok && nn.reason === 'no-nutrition' && nn.error.includes('КБЖУ'), `404 no-nutrition обязан дойти, получено ${JSON.stringify(nn)}`)
  const nf = await get(404, { ok: false, reason: 'not-found' })
  assert(!nf.ok && nf.reason === 'not-found', '404 not-found обязан дойти')
  const old = await get(404, { ok: false })
  assert(!old.ok && old.reason === 'old-worker', '404 без reason -> old-worker')
  const down = await get(502, { ok: false, reason: 'off-bad-json' })
  assert(!down.ok && down.reason === 'off-unavailable', '502 -> off-unavailable')
  const bad = await get(200, { ok: true, product: { code: 'x' } })
  assert(!bad.ok && bad.reason === 'bad-response', 'карточка не по форме -> bad-response')
  group('fetchOffProduct: 404 с reason no-nutrition -> no-nutrition; 200 -> product')
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
  parseLabelFixtureChecks()
  parseLabelRejectsChecks()
  parseDishNoChecks()
  labelEnergyCheckChecks()
  labelTotalsChecks()
  customFoodDeviationChecks()
  labelExtraChecks()
  labelRequestChecks()
  labelWithoutCompositionChecks()
  pendingLabelRequestsChecks()
  logDoneLabelRequestsChecks()
  parseProductFixtureChecks()
  parseProductMissingChecks()
  parseProductEmptyCompositionChecks()
  parseOffProductChecks()
  productFactsFromChecks()
  productNutrientsFromPrintedChecks()
  productTotalsWithoutCompositionChecks()
  productTotalsMatchFixtureChecks()
  productDeviationChecks()
  productExtraChecks()
  newProductRequestChecks()
  logDoneAutoRequestsChecks()
  logProductNowChecks()
  relogCustomFoodChecks()
  retryProductChecks()
  pendingAutoRequestsChecks()
  searchCustomFoodsChecks()
  isBarcodeChecks()
  offWarningTextChecks()
  await clientStatusChecks()
  await askLabelChecks()
  await askProductChecks()
  await searchOffChecks()
  await fetchOffProductChecks()
  labelEnergyMisreadChecks()
  labelEnergyWarningChecks()
  console.log(`\nВсе проверки food пройдены (${passed} групп).`)
}

main().catch((e) => {
  console.error('\n✗ ТЕСТ FOOD УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
})
