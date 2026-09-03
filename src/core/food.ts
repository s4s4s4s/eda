/* Домен «своя еда»: разбор ответа воркера, книга своей еды и очередь заказов
   на разбор. Чистые функции — никакого fetch, localStorage или React, ровно
   как в остальном src/core (см. log.ts). Сетевой обмен живёт в foodClient.ts,
   а превращение результата в изменения AppState — здесь.

   Числа считает не модель, а scripts/resolve-food.mjs по USDA SR Legacy:
   модель только подбирает fdcId и граммы (pc/prompts/food.md). Приложению
   достаётся FoodResult с per100 каждого компонента, и оно пересчитывает
   граммы само — той же арифметикой, что считает позиции меню
   (addPer100ToTotals в nutrition.ts). Поэтому «правка компонента» здесь —
   это withComponentGrams, а не новый запрос к воркеру. */

import { addPer100ToTotals, emptyNutrientTotals, mealKbju, mealNutrients } from './nutrition'
import type {
  AppState, CustomFood, ExtraLogEntry, FoodComponent, FoodRequest, FoodResultOk,
  Kbju, Meal, NutrientTotals, ProductIndex, Slot
} from './types'
import { NUTRIENT_KEYS } from './types'

/* ---- разбор ответа воркера ---- */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function requireFiniteNumber(v: unknown, what: string): number {
  if (!isFiniteNumber(v)) throw new Error(`${what}: ожидалось конечное число, получено ${JSON.stringify(v)}`)
  return v
}

function requireString(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new Error(`${what}: ожидалась строка, получено ${JSON.stringify(v)}`)
  return v
}

function parseKbju(v: unknown, what: string): Kbju {
  if (!isPlainObject(v)) throw new Error(`${what}: ожидался объект КБЖУ, получено ${JSON.stringify(v)}`)
  return {
    kcal: requireFiniteNumber(v.kcal, `${what}.kcal`),
    p: requireFiniteNumber(v.p, `${what}.p`),
    f: requireFiniteNumber(v.f, `${what}.f`),
    c: requireFiniteNumber(v.c, `${what}.c`)
  }
}

function parseRequestBody(v: unknown): { text: string; grams: number | null } {
  if (!isPlainObject(v)) throw new Error('request: поле отсутствует или не объект — ответ воркера не несёт исходного запроса')
  const text = requireString(v.text, 'request.text')
  const grams = v.grams === null || v.grams === undefined ? null : requireFiniteNumber(v.grams, 'request.grams')
  return { text, grams }
}

function parseMicro(v: unknown, what: string): Record<string, number> {
  if (!isPlainObject(v)) throw new Error(`${what}: ожидался объект нутриентов, получено ${JSON.stringify(v)}`)
  const micro: Record<string, number> = {}
  for (const [key, value] of Object.entries(v)) {
    if (!(NUTRIENT_KEYS as readonly string[]).includes(key)) continue
    micro[key] = requireFiniteNumber(value, `${what}.${key}`)
  }
  return micro
}

function parseComponent(v: unknown, index: number): FoodComponent {
  const what = `components[${index}]`
  if (!isPlainObject(v)) throw new Error(`${what}: ожидался объект, получено ${JSON.stringify(v)}`)
  const fdcId = requireFiniteNumber(v.fdcId, `${what}.fdcId`)
  if (!Number.isInteger(fdcId) || fdcId <= 0) throw new Error(`${what}.fdcId: ожидалось целое положительное число, получено ${fdcId}`)
  const description = requireString(v.description, `${what}.description`)
  const category = requireString(v.category, `${what}.category`)
  const grams = requireFiniteNumber(v.grams, `${what}.grams`)
  if (grams <= 0) throw new Error(`${what}.grams: ожидалось положительное число, получено ${grams}`)
  if (!isPlainObject(v.per100)) throw new Error(`${what}.per100: ожидался объект, получено ${JSON.stringify(v.per100)}`)
  const kbju = parseKbju(v.per100.kbju, `${what}.per100.kbju`)
  const micro = parseMicro(v.per100.micro, `${what}.per100.micro`)
  const note = v.note === undefined ? undefined : requireString(v.note, `${what}.note`)
  return { fdcId, description, category, grams, ...(note !== undefined ? { note } : {}), per100: { kbju, micro } }
}

/** Строгая проверка ответа воркера. Бросает Error с человеческой причиной по-
    русски — вызывающий (applyFoodPoll, экран) решает, что с ней делать.

    Проверяются все ключи NUTRIENT_KEYS в nutrients как {value, known, total}
    с конечными числами и known <= total, kbju и per100 компонентов — тоже
    конечные, request обязан присутствовать (это исходный текст запроса, без
    него нельзя показать «что именно разбиралось»), source — непустая строка. */
export function parseFoodResult(raw: unknown): FoodResultOk {
  if (!isPlainObject(raw)) throw new Error('Ответ воркера не является объектом')
  if (raw.ok !== true) throw new Error('Ответ воркера не несёт ok: true — это не успешный результат разбора')

  const spec = requireFiniteNumber(raw.spec, 'spec')
  const source = requireString(raw.source, 'source')
  if (source.length === 0) throw new Error('source: пустая строка — источник чисел не назван')
  const title = requireString(raw.title, 'title')
  const request = parseRequestBody(raw.request)
  const kbju = parseKbju(raw.kbju, 'kbju')

  if (!Array.isArray(raw.components) || raw.components.length === 0) {
    throw new Error('components: ожидался непустой список компонентов')
  }
  const components = raw.components.map((c, i) => parseComponent(c, i))

  if (!isPlainObject(raw.nutrients)) throw new Error('nutrients: ожидался объект, получено ' + JSON.stringify(raw.nutrients))
  const nutrients = {} as NutrientTotals
  for (const key of NUTRIENT_KEYS) {
    const entry = raw.nutrients[key]
    if (!isPlainObject(entry)) throw new Error(`nutrients.${key}: ожидался объект {value, known, total}, получено ${JSON.stringify(entry)}`)
    const value = requireFiniteNumber(entry.value, `nutrients.${key}.value`)
    const known = requireFiniteNumber(entry.known, `nutrients.${key}.known`)
    const total = requireFiniteNumber(entry.total, `nutrients.${key}.total`)
    if (!Number.isInteger(known) || known < 0) throw new Error(`nutrients.${key}.known: ожидалось неотрицательное целое, получено ${known}`)
    if (!Number.isInteger(total) || total < 0) throw new Error(`nutrients.${key}.total: ожидалось неотрицательное целое, получено ${total}`)
    if (known > total) throw new Error(`nutrients.${key}: known (${known}) больше total (${total}) — так не бывает`)
    nutrients[key] = { value, known, total }
  }

  return { ok: true, spec, source, title, request, components, kbju, nutrients }
}

/* ---- книга своей еды ---- */

/** Кладёт разобранную еду в книгу. jobId — наряд воркера, id и createdAt
    задаёт вызывающий (uuid и текущее время — сторона с эффектами, не ядро). */
export function customFoodFromResult(result: FoodResultOk, jobId: string, id: string, createdAt: string): CustomFood {
  return {
    id,
    title: result.title,
    source: result.source,
    spec: result.spec,
    jobId,
    request: result.request,
    components: result.components,
    createdAt
  }
}

/** Итог КБЖУ и нутриентов своей еды — той же арифметикой, что считает позиции
    меню (addPer100ToTotals): доказательство, что приложение и раннер, разобравший
    еду на домашнем компьютере, считают одинаково. */
export function customFoodTotals(food: CustomFood): { kbju: Kbju; nutrients: NutrientTotals } {
  let kbju: Kbju = { kcal: 0, p: 0, f: 0, c: 0 }
  let nutrients = emptyNutrientTotals()
  for (const component of food.components) {
    const factor = component.grams / 100
    kbju = {
      kcal: kbju.kcal + component.per100.kbju.kcal * factor,
      p: kbju.p + component.per100.kbju.p * factor,
      f: kbju.f + component.per100.kbju.f * factor,
      c: kbju.c + component.per100.kbju.c * factor
    }
    nutrients = addPer100ToTotals(nutrients, component.per100.micro, component.grams)
  }
  return { kbju, nutrients }
}

/** Правит граммы ровно одного компонента, остальные не трогает. Это и есть
    «правка компонентов без ПК» из раздела 3 плана: состав меняется только
    новым нарядом, граммы — локально и детерминированно, потому что per100
    компонента уже лежит в CustomFood. */
export function withComponentGrams(food: CustomFood, index: number, grams: number): CustomFood {
  if (index < 0 || index >= food.components.length) {
    throw new Error(`withComponentGrams: индекс ${index} вне диапазона компонентов (их ${food.components.length})`)
  }
  if (!Number.isFinite(grams) || grams <= 0) {
    throw new Error(`withComponentGrams: граммы обязаны быть положительным конечным числом, получено ${grams}`)
  }
  const components = food.components.map((c, i) => (i === index ? { ...c, grams } : c))
  return { ...food, components }
}

/* ---- добавленная еда (extras) ---- */

/** Снапшот полной порции блюда меню, перенесённого из другого дня цикла на
    целевой приём. КБЖУ и нутриенты считаются той же арифметикой, что и у
    записи приёма меню (mealKbju/mealNutrients) — перенос блюда не должен
    давать других чисел, чем обычная запись того же блюда. */
export function menuExtraFrom(
  meal: Meal,
  products: ProductIndex,
  slot: Slot,
  fraction: number,
  fromCycleDay: number,
  id: string,
  loggedAt: string,
  productsRevision?: string
): ExtraLogEntry {
  return {
    kind: 'menu',
    id,
    slot,
    fraction,
    title: meal.title,
    kbju: mealKbju(meal, products),
    nutrients: mealNutrients(meal, products),
    loggedAt,
    mealId: meal.id,
    fromCycleDay,
    fromSlot: meal.slot,
    ...(productsRevision !== undefined ? { productsRevision } : {})
  }
}

/** Снапшот полной порции своей еды на целевой приём. */
export function customExtraFrom(food: CustomFood, slot: Slot, fraction: number, id: string, loggedAt: string): ExtraLogEntry {
  const { kbju, nutrients } = customFoodTotals(food)
  return {
    kind: 'custom',
    id,
    slot,
    fraction,
    title: food.title,
    kbju,
    nutrients,
    loggedAt,
    customFoodId: food.id,
    source: food.source
  }
}

/* ---- очередь заказов на разбор ---- */

export function newFoodRequest(id: string, text: string, grams: number | null, target: { date: string; slot: Slot }, askedAt: string): FoodRequest {
  return { id, text, grams, askedAt, target, status: 'pending', pcAgo: null }
}

/** Кладёт новый заказ в очередь состояния — вызывается после успешного askFood. */
export function applyFoodAsk(state: AppState, request: FoodRequest): AppState {
  return { ...state, foodRequests: [...state.foodRequests, request] }
}

/** Ответ воркера на опрос заказа `/food?id=...`. Форма зеркалит handleFoodPoll
    в src/worker.js «Штурмана» (раздел 1.1 плана). */
export interface FoodPollResponse {
  ok: true
  id: string
  state: 'pending' | 'taken' | 'done' | 'failed' | 'expired'
  result?: unknown
  error?: string
  pcAgo: number | null
  modelOk: boolean
}

/** Применяет ответ опроса к заказу с этим id. Чистый переход состояния:
    - 'taken' для приложения — по-прежнему pending (модель работает над ним),
      меняются только pcAgo/lastPolledAt;
    - 'pending' обновляет то же самое;
    - 'done' разбирается parseFoodResult; провал разбора — не сбой приложения,
      а честный failed с текстом причины (сервер прислал то, что приложение не
      может показать человеку как «готово»);
    - 'failed'/'expired' переносятся как есть, error — из ответа.
    id, которого нет в очереди, ничего не меняет — заказ мог быть убран
    человеком раньше, чем пришёл этот опрос. */
export function applyFoodPoll(state: AppState, id: string, response: FoodPollResponse, now: string): AppState {
  const index = state.foodRequests.findIndex(r => r.id === id)
  if (index === -1) return state

  const existing = state.foodRequests[index]
  let updated: FoodRequest

  if (response.state === 'pending' || response.state === 'taken') {
    updated = { ...existing, status: 'pending', pcAgo: response.pcAgo, lastPolledAt: now }
  } else if (response.state === 'done') {
    try {
      const result = parseFoodResult(response.result)
      updated = { ...existing, status: 'done', result, pcAgo: response.pcAgo, lastPolledAt: now, error: undefined }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      updated = { ...existing, status: 'failed', error: `Разбор пришёл в непонятном виде: ${message}`, pcAgo: response.pcAgo, lastPolledAt: now, result: undefined }
    }
  } else if (response.state === 'failed') {
    updated = { ...existing, status: 'failed', error: response.error ?? 'Разбор не удался', pcAgo: response.pcAgo, lastPolledAt: now }
  } else {
    // 'expired'
    updated = { ...existing, status: 'expired', pcAgo: response.pcAgo, lastPolledAt: now }
  }

  const foodRequests = state.foodRequests.map((r, i) => (i === index ? updated : r))
  return { ...state, foodRequests }
}

/** Кладёт готовую еду в книгу, добавляет извлечённую из неё запись дня и
    убирает выполненный заказ из очереди — три перехода одним действием
    человека («Сохранить и записать»). editedFood — food.result, возможно
    поправленный withComponentGrams; requestId — заказ, который сохраняем. */
export function saveCustomFood(
  state: AppState,
  requestId: string,
  editedFood: CustomFood,
  target: { date: string; slot: Slot },
  fraction: number,
  extraId: string,
  now: string,
  cycleDayForDate: number
): AppState {
  const customFoods = { ...state.customFoods, [editedFood.id]: editedFood }
  const extra = customExtraFrom(editedFood, target.slot, fraction, extraId, now)
  const existingDay = state.log[target.date] ?? { cycleDay: cycleDayForDate, meals: {}, extras: [] }
  const known = existingDay.extras.findIndex(e => e.id === extra.id)
  const extras = known === -1
    ? [...existingDay.extras, extra]
    : existingDay.extras.map(e => (e.id === extra.id ? extra : e))
  const log = { ...state.log, [target.date]: { cycleDay: existingDay.cycleDay, meals: existingDay.meals, extras } }
  const foodRequests = state.foodRequests.filter(r => r.id !== requestId)
  return { ...state, customFoods, log, foodRequests }
}

/** Убирает заказ из очереди, ничего не сохраняя, — кнопка «Убрать» на failed/
    expired запросе или на не нужном больше done. */
export function discardFoodRequest(state: AppState, id: string): AppState {
  return { ...state, foodRequests: state.foodRequests.filter(r => r.id !== id) }
}

/** Заменяет заказ новым: тот же текст и граммы, новый id и время, статус
    pending — кнопка «Повторить» на failed/expired. Прежний заказ убирается
    из очереди целиком: у нового id своя история опроса, дублировать его под
    старым нельзя (наряд на воркере тоже новый). */
export function retryFoodRequest(state: AppState, id: string, newId: string, now: string): AppState {
  const existing = state.foodRequests.find(r => r.id === id)
  if (!existing) return state
  const replacement = newFoodRequest(newId, existing.text, existing.grams, existing.target, now)
  return { ...state, foodRequests: state.foodRequests.map(r => (r.id === id ? replacement : r)) }
}

/** Убирает еду из книги. Уже записанные extras — самостоятельные снапшоты
    (ExtraLogEntry.kind === 'custom' несёт свой title/kbju/nutrients), они не
    трогаются: удаление еды из книги не переписывает уже съеденное. */
export function removeCustomFood(state: AppState, foodId: string): AppState {
  if (!(foodId in state.customFoods)) return state
  const customFoods = { ...state.customFoods }
  delete customFoods[foodId]
  return { ...state, customFoods }
}
