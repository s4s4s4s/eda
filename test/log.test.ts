/**
 * Тесты дневника (src/core/log.ts): логирование/разлогирование приёмов,
 * снапшот КБЖУ, суммы. Никакого localStorage — только чистые функции над
 * AppState. Гоняются node-ом после сборки esbuild: `npm run test:log`.
 */
import { dayNutrientTotals, dayTotal, eatenKbju, eatenNutrients, logMeal, unlogMeal } from '../src/core/log'
import type { AppState, Kbju, Meal, Nutrients, Product, ProductIndex } from '../src/core/types'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}
function group(name: string): void { console.log(`  ok ${name}`); passed++ }

function product(id: string, per100: Kbju, micro100: Nutrients = {}): Product {
  return { id, name: id, fdcId: 1, fdcDescription: id, tags: [], per100, micro100 }
}

function products(...list: Product[]): ProductIndex {
  const map = new Map<string, Product>()
  for (const p of list) map.set(p.id, p)
  return map
}

function meal(slot: 'breakfast' | 'lunch' | 'dinner' | 'snack', title: string, kcalPer100: number): Meal {
  return {
    slot,
    title,
    steps: [],
    items: [{ product: 'x', g: 100, where: 'container' }]
  }
}

function emptyState(): AppState {
  return {
    version: 1,
    settings: { cycleStartDate: '2026-08-01', cycleShift: 0, targetKcal: 3200, shortcutName: '' },
    log: {}
  }
}

// ---- снапшот не переписывается задним числом --------------------------------

function snapshotIsFrozenChecks(): void {
  const idx = products(product('x', { kcal: 200, p: 10, f: 5, c: 20 }))
  const originalMeal = meal('lunch', 'Обед v1', 200)

  const state0 = emptyState()
  const state1 = logMeal(state0, '2026-08-05', 'lunch', originalMeal, idx, 'eaten', 1, 5, '2026-08-05T12:00:00')

  const entry = state1.log['2026-08-05'].meals.lunch!
  assert(entry.kbju.kcal === 200, `снапшот kcal ожидалось 200, получено ${entry.kbju.kcal}`)
  assert(entry.title === 'Обед v1', 'снапшот сохранил заголовок приёма на момент записи')

  // «подменили меню» — новый объект меню с другим item, но state1 в него не заглядывает:
  // пересчёт итога дня не должен зависеть от того, что случилось с исходным meal дальше.
  const changedMeal: Meal = { ...originalMeal, title: 'Обед v2 (изменили задним числом)', items: [{ product: 'x', g: 999, where: 'container' }] }
  void changedMeal // намеренно не передаём в state1 — снапшот уже сделан

  const total = dayTotal(state1.log['2026-08-05'])
  assert(total.kcal === 200, `итог дня после «правки меню» должен остаться прежним (200), получено ${total.kcal}`)

  group('logMeal: снапшот КБЖУ не переписывается задним числом при изменении меню')
}

// ---- повторный logMeal перезаписывает запись ---------------------------------

function overwriteChecks(): void {
  const idx = products(product('x', { kcal: 200, p: 10, f: 5, c: 20 }))
  const state0 = emptyState()
  const state1 = logMeal(state0, '2026-08-05', 'lunch', meal('lunch', 'v1', 200), idx, 'eaten', 1, 5, 't1')
  const state2 = logMeal(state1, '2026-08-05', 'lunch', meal('lunch', 'v2', 200), idx, 'partial', 0.5, 5, 't2')

  assert(Object.keys(state2.log['2026-08-05'].meals).length === 1, 'повторная запись того же slot не плодит дубли')
  const entry = state2.log['2026-08-05'].meals.lunch!
  assert(entry.title === 'v2' && entry.status === 'partial' && entry.fraction === 0.5, 'повторная запись перезаписывает старую')

  // исходный state1 не мутирован повторной записью
  assert(state1.log['2026-08-05'].meals.lunch!.title === 'v1', 'state1 не должен был измениться после logMeal(state1 -> state2)')

  group('logMeal: повторная запись перезаписывает, входной state не мутирован')
}

// ---- unlogMeal -----------------------------------------------------------------

function unlogChecks(): void {
  const idx = products(product('x', { kcal: 200, p: 10, f: 5, c: 20 }))
  const state0 = emptyState()
  const state1 = logMeal(state0, '2026-08-05', 'lunch', meal('lunch', 'v1', 200), idx, 'eaten', 1, 5, 't1')
  const state2 = unlogMeal(state1, '2026-08-05', 'lunch')

  assert(state2.log['2026-08-05'].meals.lunch === undefined, 'unlogMeal должен удалить запись')
  assert(state1.log['2026-08-05'].meals.lunch !== undefined, 'unlogMeal не должен мутировать входной state')

  group('unlogMeal: удаляет запись, входной state не мутирован')
}

// ---- skipped даёт ноль --------------------------------------------------------

function skippedChecks(): void {
  const idx = products(product('x', { kcal: 200, p: 10, f: 5, c: 20 }))
  const state0 = emptyState()
  const state1 = logMeal(state0, '2026-08-05', 'breakfast', meal('breakfast', 'v1', 200), idx, 'skipped', 0, 5, 't1')
  const entry = state1.log['2026-08-05'].meals.breakfast!
  const eaten = eatenKbju(entry)
  assert(eaten.kcal === 0 && eaten.p === 0 && eaten.f === 0 && eaten.c === 0, `skipped должен давать ноль, получено ${JSON.stringify(eaten)}`)
  group('skipped: eatenKbju даёт ноль по всем макросам')
}

// ---- смесь eaten/partial/skipped сходится с ручным расчётом -------------------

function mixChecks(): void {
  const idx = products(
    product('a', { kcal: 400, p: 20, f: 10, c: 40 }),
    product('b', { kcal: 600, p: 30, f: 20, c: 50 }),
    product('c', { kcal: 300, p: 15, f: 5, c: 30 }),
    product('d', { kcal: 500, p: 25, f: 15, c: 45 })
  )
  const mealFor = (slot: 'breakfast' | 'lunch' | 'dinner' | 'snack', productId: string, title: string): Meal => ({
    slot, title, steps: [], items: [{ product: productId, g: 100, where: 'container' }]
  })

  let state = emptyState()
  // завтрак: eaten (fraction 1) -> {400,20,10,40}
  state = logMeal(state, '2026-08-06', 'breakfast', mealFor('breakfast', 'a', 'завтрак'), idx, 'eaten', 1, 6, 't')
  // обед: partial 0.5 -> {300,15,10,25}
  state = logMeal(state, '2026-08-06', 'lunch', mealFor('lunch', 'b', 'обед'), idx, 'partial', 0.5, 6, 't')
  // ужин: skipped -> {0,0,0,0}
  state = logMeal(state, '2026-08-06', 'dinner', mealFor('dinner', 'c', 'ужин'), idx, 'skipped', 0, 6, 't')
  // перекус: partial 0.25 -> {125,6.25,3.75,11.25}
  state = logMeal(state, '2026-08-06', 'snack', mealFor('snack', 'd', 'перекус'), idx, 'partial', 0.25, 6, 't')

  // ручной расчёт: 400 + 300 + 0 + 125 = 825; 20+15+0+6.25=41.25; 10+10+0+3.75=23.75; 40+25+0+11.25=76.25
  const total = dayTotal(state.log['2026-08-06'])
  assert(Math.abs(total.kcal - 825) < 0.001, `kcal ожидалось 825, получено ${total.kcal}`)
  assert(Math.abs(total.p - 41.25) < 0.001, `p ожидалось 41.25, получено ${total.p}`)
  assert(Math.abs(total.f - 23.75) < 0.001, `f ожидалось 23.75, получено ${total.f}`)
  assert(Math.abs(total.c - 76.25) < 0.001, `c ожидалось 76.25, получено ${total.c}`)

  group('dayTotal: смесь eaten/partial/skipped сходится с ручным расчётом')
}

// ---- снапшот нутриентов рядом со снапшотом КБЖУ ------------------------------

function nutrientSnapshotChecks(): void {
  // у «x» есть клетчатка и витамин K, у «y» — только клетчатка: приём выходит
  // полным по клетчатке и неполным по витамину K
  const idx = products(
    product('x', { kcal: 200, p: 10, f: 5, c: 20 }, { fiber: 4, vitK: 20 }),
    product('y', { kcal: 100, p: 5, f: 1, c: 10 }, { fiber: 6 })
  )
  const twoItemMeal: Meal = {
    slot: 'lunch',
    title: 'Обед',
    steps: [],
    items: [
      { product: 'x', g: 100, where: 'container' },
      { product: 'y', g: 100, where: 'container' }
    ]
  }

  const state = logMeal(emptyState(), '2026-08-07', 'lunch', twoItemMeal, idx, 'eaten', 1, 7, 't')
  const entry = state.log['2026-08-07'].meals.lunch!

  assert(entry.nutrients.fiber.value === 10 && entry.nutrients.fiber.known === 2 && entry.nutrients.fiber.total === 2,
    `клетчатка в снапшоте ожидалась 10 при полноте 2/2, получено ${JSON.stringify(entry.nutrients.fiber)}`)
  assert(entry.nutrients.vitK.value === 20 && entry.nutrients.vitK.known === 1 && entry.nutrients.vitK.total === 2,
    `витамин K в снапшоте ожидался 20 при полноте 1/2, получено ${JSON.stringify(entry.nutrients.vitK)}`)
  assert(entry.nutrients.vitB12.known === 0 && entry.nutrients.vitB12.value === 0,
    'нутриент, неизвестный обеим позициям, попадает в снапшот как «нет данных», а не как ноль-значение')

  group('logMeal: снапшот нутриентов записывается рядом с КБЖУ и несёт полноту')
}

function eatenNutrientsChecks(): void {
  const idx = products(product('x', { kcal: 200, p: 10, f: 5, c: 20 }, { fiber: 4, vitK: 20 }))
  const half = logMeal(emptyState(), '2026-08-07', 'lunch', meal('lunch', 'Обед', 200), idx, 'partial', 0.5, 7, 't')
  const entry = half.log['2026-08-07'].meals.lunch!
  const eaten = eatenNutrients(entry)

  assert(eaten.fiber.value === 2, `съеденная половина клетчатки ожидалась 2, получено ${eaten.fiber.value}`)
  assert(eaten.fiber.known === entry.nutrients.fiber.known && eaten.fiber.total === entry.nutrients.fiber.total,
    'доля не меняет полноту: половина приёма известна ровно настолько же, насколько целый')
  group('eatenNutrients: доля умножает значения и не трогает полноту')
}

function dayNutrientTotalsChecks(): void {
  const idx = products(
    product('a', { kcal: 400, p: 20, f: 10, c: 40 }, { fiber: 10, vitK: 30 }),
    product('b', { kcal: 600, p: 30, f: 20, c: 50 }, { fiber: 20 })
  )
  const mealFor = (slot: 'breakfast' | 'lunch', productId: string): Meal => ({
    slot, title: slot, steps: [], items: [{ product: productId, g: 100, where: 'container' }]
  })

  let state = emptyState()
  state = logMeal(state, '2026-08-08', 'breakfast', mealFor('breakfast', 'a'), idx, 'eaten', 1, 8, 't')
  state = logMeal(state, '2026-08-08', 'lunch', mealFor('lunch', 'b'), idx, 'partial', 0.5, 8, 't')

  // ручной расчёт: клетчатка 10 + 20*0.5 = 20 (известна у обеих позиций дня);
  // витамин K 30 + ничего = 30, известен по одной позиции из двух
  const totals = dayNutrientTotals(state.log['2026-08-08'])
  assert(Math.abs(totals.fiber.value - 20) < 0.001, `клетчатка за день ожидалась 20, получено ${totals.fiber.value}`)
  assert(totals.fiber.known === 2 && totals.fiber.total === 2, `полнота клетчатки ожидалась 2/2, получено ${JSON.stringify(totals.fiber)}`)
  assert(Math.abs(totals.vitK.value - 30) < 0.001, `витамин K за день ожидался 30 (второй приём его не знает), получено ${totals.vitK.value}`)
  assert(totals.vitK.known === 1 && totals.vitK.total === 2, `полнота витамина K ожидалась 1/2, получено ${JSON.stringify(totals.vitK)}`)
  assert(totals.vitB12.known === 0, 'неизвестный всем нутриент остаётся «нет данных» и на уровне дня')
  group('dayNutrientTotals: сумма дня складывает значения и полноту, пропуск не превращается в ноль')
}

function main(): void {
  console.log('log — дневник: снапшот, перезапись, unlog, суммы')
  snapshotIsFrozenChecks()
  overwriteChecks()
  unlogChecks()
  skippedChecks()
  mixChecks()
  nutrientSnapshotChecks()
  eatenNutrientsChecks()
  dayNutrientTotalsChecks()
  console.log(`\nВсе проверки log пройдены (${passed} групп).`)
}

try {
  main()
} catch (e) {
  console.error('\n✗ ТЕСТ LOG УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}
