/**
 * Тесты недельной сводки (src/core/week.ts): окно дат, пропущенные дни не читаются
 * как ноль, средние только по дням с данными. Гоняются node-ом после сборки esbuild:
 * `npm run test:week`.
 */
import { addExtra, logMeal } from '../src/core/log'
import { emptyNutrientTotals } from '../src/core/nutrition'
import { weekCoverage, weekSummary } from '../src/core/week'
import { NUTRIENT_KEYS } from '../src/core/types'
import type { AppState, Kbju, Meal, NutrientNorm, NutrientNorms, Nutrients, Product, ProductIndex, Slot } from '../src/core/types'

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

function meal(slot: Slot, title: string, productId: string): Meal {
  return { slot, title, steps: [], items: [{ product: productId, g: 100, where: 'container' }] }
}

function emptyState(): AppState {
  return {
    version: 1,
    settings: { cycleStartDate: '2026-08-01', cycleShift: 0, targetKcal: 3200, shortcutName: '' },
    log: {},
    preferences: { ingredients: {}, dishes: {} },
    customFoods: {},
    foodRequests: []
  } as unknown as AppState
}

// ---- пустой дневник -------------------------------------------------------------

function emptyDiaryChecks(): void {
  const state = emptyState()
  const week = weekSummary(state.log, '2026-08-07', 7)

  assert(week.days.length === 7, `ожидалось 7 дней, получено ${week.days.length}`)
  assert(week.days.every((d) => d.hasLog === false), 'все дни пустого дневника должны иметь hasLog === false')
  assert(week.days.every((d) => d.cycleDay === null), 'все дни без записей должны иметь cycleDay === null')
  assert(week.days.every((d) => d.nutrients === null), 'все дни без записей должны иметь nutrients === null')
  assert(week.daysWithLog === 0, `ожидалось 0 дней с записями, получено ${week.daysWithLog}`)
  assert(week.avgKcal === null, 'avgKcal пустого дневника должен быть null')
  assert(week.avgProteinG === null, 'avgProteinG пустого дневника должен быть null')
  assert(week.nutrients.every((n) => n.avgValue === null), 'все avgValue пустого дневника должны быть null')
  assert(week.nutrients.every((n) => n.daysWithData === 0), 'все daysWithData пустого дневника должны быть 0')
  assert(week.days[6].date === '2026-08-07', `последний день окна должен быть endDate, получено ${week.days[6].date}`)
  assert(week.days[0].date === '2026-08-01', `первый день окна ожидался 2026-08-01, получено ${week.days[0].date}`)

  group('пустой дневник: 7 дней, все hasLog false, все средние null')
}

// ---- один день с одной записью ---------------------------------------------------

function singleDayChecks(): void {
  const idx = products(product('a', { kcal: 400, p: 20, f: 10, c: 40 }))
  let state = emptyState()
  state = logMeal(state, '2026-08-07', 'lunch', meal('lunch', 'обед', 'a'), idx, 'eaten', 1, 7, 't')

  const week = weekSummary(state.log, '2026-08-07', 7)
  assert(week.daysWithLog === 1, `ожидался 1 день с записями, получено ${week.daysWithLog}`)
  assert(week.avgKcal === 400, `avgKcal должен равняться съеденному за единственный день (400), получено ${week.avgKcal}`)
  assert(week.avgProteinG === 20, `avgProteinG ожидался 20, получено ${week.avgProteinG}`)

  group('один день с одной записью: avgKcal равен съеденному за этот день, а не делённому на 7')
}

// ---- два дня, во втором только два приёма -----------------------------------------

function missingSlotsChecks(): void {
  const idx = products(product('a', { kcal: 400, p: 20, f: 10, c: 40 }))
  let state = emptyState()
  state = logMeal(state, '2026-08-06', 'breakfast', meal('breakfast', 'завтрак', 'a'), idx, 'eaten', 1, 6, 't')
  state = logMeal(state, '2026-08-07', 'breakfast', meal('breakfast', 'завтрак', 'a'), idx, 'eaten', 1, 7, 't')
  state = logMeal(state, '2026-08-07', 'dinner', meal('dinner', 'ужин', 'a'), idx, 'eaten', 1, 7, 't')

  const week = weekSummary(state.log, '2026-08-07', 7)
  const day2 = week.days.find((d) => d.date === '2026-08-07')!

  assert(JSON.stringify(day2.loggedSlots) === JSON.stringify(['breakfast', 'dinner']),
    `loggedSlots ожидались [breakfast, dinner] в порядке SLOTS, получено ${JSON.stringify(day2.loggedSlots)}`)
  assert(JSON.stringify(day2.missingSlots) === JSON.stringify(['lunch', 'snack']),
    `missingSlots ожидались [lunch, snack] в порядке SLOTS, получено ${JSON.stringify(day2.missingSlots)}`)

  group('два дня, во втором записи на два приёма: missingSlots верные и в порядке SLOTS')
}

// ---- доля fraction 0.5 --------------------------------------------------------------

function fractionChecks(): void {
  const idx = products(product('a', { kcal: 400, p: 20, f: 10, c: 40 }))
  let state = emptyState()
  state = logMeal(state, '2026-08-07', 'lunch', meal('lunch', 'обед', 'a'), idx, 'partial', 0.5, 7, 't')

  const week = weekSummary(state.log, '2026-08-07', 7)
  const day = week.days.find((d) => d.date === '2026-08-07')!

  assert(day.kbju.kcal === 200, `с долей 0.5 kcal дня ожидался 200, получено ${day.kbju.kcal}`)
  assert(week.avgKcal === 200, `среднее с единственным днём-долей ожидалось 200, получено ${week.avgKcal}`)

  group('запись с долей 0.5 учитывается долей и в дне, и в среднем')
}

// ---- нутриент известен в одном дне из двух -------------------------------------------

function nutrientAvailabilityChecks(): void {
  const idx = products(product('a', { kcal: 400, p: 20, f: 10, c: 40 }, { fiber: 10 }))
  const idxNoFiber = products(product('b', { kcal: 300, p: 10, f: 5, c: 30 }))
  let state = emptyState()
  state = logMeal(state, '2026-08-06', 'lunch', meal('lunch', 'обед', 'a'), idx, 'eaten', 1, 6, 't')
  state = logMeal(state, '2026-08-07', 'lunch', meal('lunch', 'обед', 'b'), idxNoFiber, 'eaten', 1, 7, 't')

  const week = weekSummary(state.log, '2026-08-07', 7)
  const fiber = week.nutrients.find((n) => n.key === 'fiber')!

  assert(fiber.daysWithData === 1, `клетчатка ожидалась известной в 1 дне из двух, получено ${fiber.daysWithData}`)
  assert(fiber.avgValue === 10, `avgValue клетчатки должен равняться значению единственного дня с данными (10), получено ${fiber.avgValue}`)

  group('нутриент, известный в одном дне из двух: avgValue равен значению того дня, daysWithData === 1')
}

// ---- неполная сумма (known < total) -----------------------------------------------

function partialDaysChecks(): void {
  const idx = products(
    product('a', { kcal: 400, p: 20, f: 10, c: 40 }, { fiber: 10 }),
    product('b', { kcal: 300, p: 10, f: 5, c: 30 }) // без клетчатки
  )
  const twoItemMeal: Meal = {
    slot: 'lunch',
    title: 'Обед',
    steps: [],
    items: [
      { product: 'a', g: 100, where: 'container' },
      { product: 'b', g: 100, where: 'container' }
    ]
  }
  let state = emptyState()
  state = logMeal(state, '2026-08-07', 'lunch', twoItemMeal, idx, 'eaten', 1, 7, 't')

  const week = weekSummary(state.log, '2026-08-07', 7)
  const fiber = week.nutrients.find((n) => n.key === 'fiber')!

  assert(fiber.partialDays === 1, `неполный день по клетчатке ожидался (partialDays 1), получено ${fiber.partialDays}`)
  assert(fiber.avgValue === 10, `неполнота не должна отменять avgValue (ожидалось 10), получено ${fiber.avgValue}`)
  assert(fiber.daysWithData === 1, `daysWithData при неполном, но известном дне ожидался 1, получено ${fiber.daysWithData}`)

  group('неполная сумма (known < total) отражается в partialDays и не отменяет avgValue')
}

// ---- окно через границу месяца ----------------------------------------------------

function monthBoundaryChecks(): void {
  const week = weekSummary({}, '2026-03-02', 7)
  const dates = week.days.map((d) => d.date)
  assert(JSON.stringify(dates) === JSON.stringify([
    '2026-02-24', '2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'
  ]), `окно через границу месяца выдало неверные даты: ${JSON.stringify(dates)}`)

  group('окно через границу месяца (endDate 2026-03-02, 7 дней) даёт правильные даты февраля')
}

// ---- окно через границу года -------------------------------------------------------

function yearBoundaryChecks(): void {
  const week = weekSummary({}, '2026-01-02', 7)
  const dates = week.days.map((d) => d.date)
  assert(JSON.stringify(dates) === JSON.stringify([
    '2025-12-27', '2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'
  ]), `окно через границу года выдало неверные даты: ${JSON.stringify(dates)}`)

  group('окно через границу года (endDate 2026-01-02) даёт даты декабря')
}

// ---- weekCoverage: множитель нормы = daysWithData, а не dayCount ------------------

function norm(amount: number, extra: Partial<NutrientNorm> = {}): NutrientNorm {
  return { amount, basis: 'rda', comparable: true, ...extra }
}

function coverageMultiplierChecks(): void {
  // Клетчатка известна только в одном дне из семи (10 г). Норма 10 г/сут.
  // Правильное окно — 10 * 1 = 10 (а не * 7 и не * daysWithLog).
  const idx = products(product('a', { kcal: 400, p: 20, f: 10, c: 40 }, { fiber: 10 }))
  const idxNoFiber = products(product('b', { kcal: 300, p: 10, f: 5, c: 30 }))
  let state = emptyState()
  // Три записанных дня, но клетчатка есть только в одном из них.
  state = logMeal(state, '2026-08-05', 'lunch', meal('lunch', 'обед', 'b'), idxNoFiber, 'eaten', 1, 5, 't')
  state = logMeal(state, '2026-08-06', 'lunch', meal('lunch', 'обед', 'b'), idxNoFiber, 'eaten', 1, 6, 't')
  state = logMeal(state, '2026-08-07', 'lunch', meal('lunch', 'обед', 'a'), idx, 'eaten', 1, 7, 't')

  const week = weekSummary(state.log, '2026-08-07', 7)
  const norms: NutrientNorms = { fiber: norm(10) }
  const coverage = weekCoverage(week, norms)
  const fiber = coverage.find((c) => c.key === 'fiber')!

  assert(fiber.daysWithData === 1, `daysWithData клетчатки ожидался 1, получено ${fiber.daysWithData}`)
  assert(fiber.dayCount === 7, `dayCount окна ожидался 7, получено ${fiber.dayCount}`)
  assert(fiber.norm === 10, `норма окна должна быть 10 г * 1 день данных = 10, получено ${fiber.norm}`)
  assert(fiber.norm !== 10 * 7, 'норма окна не должна умножаться на 7 (dayCount)')
  assert(fiber.value === 10, `сумма за дни с данными ожидалась 10, получено ${fiber.value}`)
  assert(fiber.ratio === 1, `ratio при value === norm ожидался 1, получено ${fiber.ratio}`)
  assert(fiber.state === 'ok', `состояние клетчатки ожидалось ok, получено ${fiber.state}`)
  assert(fiber.ul === null, `у клетчатки без ul в норме ul окна ожидался null, получено ${fiber.ul}`)
  assert(fiber.overUl === false, `без ul overUl должен быть false, получено ${fiber.overUl}`)
  assert(fiber.cdrr === null, `у клетчатки без cdrr в норме cdrr окна ожидался null, получено ${fiber.cdrr}`)
  assert(fiber.overCdrr === false, `без cdrr overCdrr должен быть false, получено ${fiber.overCdrr}`)

  group('weekCoverage: норма окна = суточная норма × daysWithData (по позиции), не × dayCount и не × daysWithLog')
}

function coverageNoDataChecks(): void {
  const idx = products(product('a', { kcal: 400, p: 20, f: 10, c: 40 })) // без клетчатки
  let state = emptyState()
  state = logMeal(state, '2026-08-07', 'lunch', meal('lunch', 'обед', 'a'), idx, 'eaten', 1, 7, 't')

  const week = weekSummary(state.log, '2026-08-07', 7)
  const coverage = weekCoverage(week, { fiber: norm(10) })
  const fiber = coverage.find((c) => c.key === 'fiber')!

  assert(fiber.state === 'no-data', `клетчатка без данных ожидала состояние no-data, получено ${fiber.state}`)
  assert(fiber.value === 0, `сумма без данных ожидалась 0, получено ${fiber.value}`)
  assert(fiber.ratio === null, `ratio без данных ожидался null, получено ${fiber.ratio}`)
  assert(fiber.norm === null, `норма окна без данных ожидалась null, получено ${fiber.norm}`)

  // Позиция без данных обязана остаться в списке — все ключи NUTRIENT_KEYS всегда присутствуют.
  assert(coverage.length === NUTRIENT_KEYS.length, `weekCoverage ожидал ${NUTRIENT_KEYS.length} позиций, получено ${coverage.length}`)
  assert(coverage.some((c) => c.key === 'fiber'), 'позиция без данных не должна пропадать из списка')

  group('weekCoverage: нутриент без данных остаётся в списке с состоянием no-data, value 0 и ratio null')
}

function coverageNoNormChecks(): void {
  const idx = products(product('a', { kcal: 400, p: 20, f: 10, c: 40 }, { fiber: 10 }))
  let state = emptyState()
  state = logMeal(state, '2026-08-07', 'lunch', meal('lunch', 'обед', 'a'), idx, 'eaten', 1, 7, 't')

  const week = weekSummary(state.log, '2026-08-07', 7)
  const coverage = weekCoverage(week, {}) // нормы нет вовсе
  const fiber = coverage.find((c) => c.key === 'fiber')!

  assert(fiber.state === 'no-norm', `клетчатка без нормы ожидала состояние no-norm, получено ${fiber.state}`)
  assert(fiber.value === 10, `сумма при отсутствии нормы всё равно должна считаться, получено ${fiber.value}`)
  assert(fiber.ratio === null, `ratio без нормы ожидался null, получено ${fiber.ratio}`)
  assert(fiber.norm === null, `норма окна без нормы ожидалась null, получено ${fiber.norm}`)

  group('weekCoverage: нутриент без нормы даёт состояние no-norm, сумма считается, ratio null')
}

function coverageNotComparableChecks(): void {
  const idx = products(product('a', { kcal: 400, p: 20, f: 10, c: 40 }, { water: 500 }))
  let state = emptyState()
  state = logMeal(state, '2026-08-07', 'lunch', meal('lunch', 'обед', 'a'), idx, 'eaten', 1, 7, 't')

  const week = weekSummary(state.log, '2026-08-07', 7)
  const coverage = weekCoverage(week, { water: norm(3000, { comparable: false }) })
  const water = coverage.find((c) => c.key === 'water')!

  assert(water.state === 'not-comparable', `вода ожидала состояние not-comparable, получено ${water.state}`)
  assert(water.value === 500, `сумма воды ожидалась 500, получено ${water.value}`)
  assert(water.ratio === null, `ratio для несравнимой нормы ожидался null, получено ${water.ratio}`)
  assert(water.norm === null, `норма окна для несравнимой нормы ожидалась null, получено ${water.norm}`)

  group('weekCoverage: comparable: false (вода) даёт состояние not-comparable и ratio null')
}

/** Записывает все четыре приёма дня одним и тем же блюдом: день выходит полным
    по приёмам, и на partialDays влияет только полнота внутри нутриента. */
function logFullDay(state: AppState, date: string, cycleDay: number, m: Meal, idx: ProductIndex): AppState {
  let result = state
  for (const slot of ['breakfast', 'lunch', 'dinner', 'snack'] as Slot[]) {
    result = logMeal(result, date, slot, { ...m, slot }, idx, 'eaten', 1, cycleDay, 't')
  }
  return result
}

function coveragePartialDaysChecks(): void {
  const idx = products(
    product('a', { kcal: 400, p: 20, f: 10, c: 40 }, { fiber: 10 }),
    product('b', { kcal: 300, p: 10, f: 5, c: 30 }) // без клетчатки
  )
  const twoItemMeal: Meal = {
    slot: 'lunch',
    title: 'Обед',
    steps: [],
    items: [
      { product: 'a', g: 100, where: 'container' },
      { product: 'b', g: 100, where: 'container' }
    ]
  }
  // оба дня записаны целиком (4 приёма из 4), чтобы partialDays мерил ровно
  // полноту внутри нутриента, а не неполноту дня по приёмам
  let state = emptyState()
  state = logFullDay(state, '2026-08-06', 6, meal('lunch', 'обед', 'a'), idx)
  state = logFullDay(state, '2026-08-07', 7, twoItemMeal, idx)

  const week = weekSummary(state.log, '2026-08-07', 7)
  const coverage = weekCoverage(week, { fiber: norm(10) })
  const fiber = coverage.find((c) => c.key === 'fiber')!

  assert(week.incompleteDays === 0, `оба дня записаны целиком, incompleteDays ожидался 0, получено ${week.incompleteDays}`)
  assert(fiber.daysWithData === 2, `daysWithData клетчатки ожидался 2, получено ${fiber.daysWithData}`)
  assert(fiber.partialDays === 1, `partialDays ожидался 1 (один из двух дней собран не по всем позициям), получено ${fiber.partialDays}`)
  assert(fiber.value === 80, `сумма клетчатки за оба дня ожидалась 40 + 40 = 80, получено ${fiber.value}`)
  assert(fiber.norm === 20, `норма окна ожидалась 10 * 2 = 20, получено ${fiber.norm}`)

  group('weekCoverage: partialDays считает дни с неполной суммой (known < total), не отменяя value')
}

// ---- неполнота дня по приёмам ----------------------------------------------------

/* День, в котором записан один приём из четырёх, нельзя мерить полной суточной
   нормой: съедено было больше, чем записано, и сумма — нижняя граница. Раньше
   неделя об этом молчала: missingSlots были посчитаны и не использованы. */
function incompleteDaysChecks(): void {
  const idx = products(product('a', { kcal: 400, p: 20, f: 10, c: 40 }, { fiber: 10 }))
  let state = emptyState()
  state = logMeal(state, '2026-08-07', 'lunch', meal('lunch', 'обед', 'a'), idx, 'eaten', 1, 7, 't')

  const week = weekSummary(state.log, '2026-08-07', 7)
  assert(week.daysWithLog === 1, `дней с записями ожидался 1, получено ${week.daysWithLog}`)
  assert(week.incompleteDays === 1, `день с одним приёмом из четырёх — неполный, incompleteDays ожидался 1, получено ${week.incompleteDays}`)
  assert(week.loggedSlots === 1, `loggedSlots ожидался 1, получено ${week.loggedSlots}`)
  assert(week.expectedSlots === 4, `expectedSlots ожидался 4 (4 приёма × 1 день с записями), получено ${week.expectedSlots}`)

  const coverage = weekCoverage(week, { fiber: norm(10) })
  const fiber = coverage.find((c) => c.key === 'fiber')!
  assert(fiber.daysWithData === 1, `daysWithData клетчатки ожидался 1, получено ${fiber.daysWithData}`)
  assert(fiber.partialDays >= 1, `день с недописанными приёмами обязан считаться неполным, partialDays получено ${fiber.partialDays}`)

  group('неполнота дня по приёмам: incompleteDays/loggedSlots/expectedSlots и partialDays в покрытии')
}

/* Пропуск — тоже статус: день «три съедено, один пропущен» дописан до конца, и
   помечать его неполным значило бы требовать от человека есть всё подряд. */
function skippedSlotCompletesDayChecks(): void {
  const idx = products(product('a', { kcal: 400, p: 20, f: 10, c: 40 }, { fiber: 10 }))
  let state = emptyState()
  state = logMeal(state, '2026-08-07', 'breakfast', meal('breakfast', 'завтрак', 'a'), idx, 'eaten', 1, 7, 't')
  state = logMeal(state, '2026-08-07', 'lunch', meal('lunch', 'обед', 'a'), idx, 'eaten', 1, 7, 't')
  state = logMeal(state, '2026-08-07', 'dinner', meal('dinner', 'ужин', 'a'), idx, 'eaten', 1, 7, 't')
  state = logMeal(state, '2026-08-07', 'snack', meal('snack', 'перекус', 'a'), idx, 'skipped', 0, 7, 't')

  const week = weekSummary(state.log, '2026-08-07', 7)
  assert(week.incompleteDays === 0, `день, где 3 записано и 1 пропущен, полон: incompleteDays ожидался 0, получено ${week.incompleteDays}`)
  assert(week.loggedSlots === 4 && week.expectedSlots === 4,
    `все четыре приёма получили статус, ожидалось 4 из 4, получено ${week.loggedSlots} из ${week.expectedSlots}`)

  const coverage = weekCoverage(week, { fiber: norm(10) })
  const fiber = coverage.find((c) => c.key === 'fiber')!
  assert(fiber.value === 30, `клетчатка ожидалась 30 (три съеденных приёма по 10), получено ${fiber.value}`)
  assert(fiber.partialDays === 0, `полный день не может считаться неполным, partialDays получено ${fiber.partialDays}`)

  group('пропущенный приём — тоже статус: день из 3 съеденных и 1 пропущенного полон')
}

/* День, в котором не осталось ни одной записи (отмена последнего приёма в старом
   хранилище, санитизация выбросила все записи), — день БЕЗ записей. Считать его
   записанным значит делить среднее за неделю на лишний день: два дня по 3000 и
   один пустой давали «2000 в среднем». */
function emptyDayIsNotZeroDayChecks(): void {
  const idx = products(product('a', { kcal: 3000, p: 150, f: 100, c: 300 }))
  let state = emptyState()
  state = logFullDay(state, '2026-08-06', 6, meal('lunch', 'день', 'a'), idx)
  state = logFullDay(state, '2026-08-07', 7, meal('lunch', 'день', 'a'), idx)
  // день с ключом, но без единой записи — так выглядит отменённый день в старом хранилище
  state = { ...state, log: { ...state.log, '2026-08-05': { cycleDay: 5, meals: {}, extras: [] } } }

  const week = weekSummary(state.log, '2026-08-07', 7)
  const emptyDay = week.days.find((d) => d.date === '2026-08-05')!

  assert(emptyDay.hasLog === false, 'день с пустым meals не считается записанным')
  assert(emptyDay.nutrients === null, 'у дня без записей нет и сумм нутриентов')
  assert(week.daysWithLog === 2, `дней с записями ожидалось 2, получено ${week.daysWithLog}`)
  assert(week.avgKcal === 12000, `среднее не должно делиться на пустой день: ожидалось 12000, получено ${week.avgKcal}`)

  group('день с ключом даты, но без записей, не входит в средние и не занижает их')
}

// ---- weekCoverage: ul за окно, overUl -------------------------------------------

function coverageUlChecks(): void {
  // Клетчатка по 10 г в каждый из двух дней (сумма 20). ul суточный — 8 г,
  // окно ul = 8 * 2 = 16, сумма 20 > 16 -> overUl.
  const idx = products(product('a', { kcal: 400, p: 20, f: 10, c: 40 }, { fiber: 10 }))
  let state = emptyState()
  state = logMeal(state, '2026-08-06', 'lunch', meal('lunch', 'обед', 'a'), idx, 'eaten', 1, 6, 't')
  state = logMeal(state, '2026-08-07', 'lunch', meal('lunch', 'обед', 'a'), idx, 'eaten', 1, 7, 't')

  const week = weekSummary(state.log, '2026-08-07', 7)
  const coverage = weekCoverage(week, { fiber: norm(10, { ul: 8 }) })
  const fiber = coverage.find((c) => c.key === 'fiber')!

  assert(fiber.daysWithData === 2, `daysWithData ожидался 2, получено ${fiber.daysWithData}`)
  assert(fiber.value === 20, `сумма клетчатки ожидалась 20, получено ${fiber.value}`)
  assert(fiber.ul === 16, `ul окна ожидался 8 * 2 = 16, получено ${fiber.ul}`)
  assert(fiber.overUl === true, `20 > 16 должно дать overUl true, получено ${fiber.overUl}`)

  group('weekCoverage: ul окна = суточный ul × daysWithData, превышение суммы даёт overUl')
}

function coverageUlNotExceededChecks(): void {
  // Тот же случай, но ul достаточно высок — превышения нет.
  const idx = products(product('a', { kcal: 400, p: 20, f: 10, c: 40 }, { fiber: 10 }))
  let state = emptyState()
  state = logMeal(state, '2026-08-06', 'lunch', meal('lunch', 'обед', 'a'), idx, 'eaten', 1, 6, 't')
  state = logMeal(state, '2026-08-07', 'lunch', meal('lunch', 'обед', 'a'), idx, 'eaten', 1, 7, 't')

  const week = weekSummary(state.log, '2026-08-07', 7)
  const coverage = weekCoverage(week, { fiber: norm(10, { ul: 15 }) })
  const fiber = coverage.find((c) => c.key === 'fiber')!

  assert(fiber.ul === 30, `ul окна ожидался 15 * 2 = 30, получено ${fiber.ul}`)
  assert(fiber.overUl === false, `20 < 30 не должно давать overUl, получено ${fiber.overUl}`)

  group('weekCoverage: сумма ниже ul окна не даёт overUl')
}

// ---- weekCoverage: cdrr натрия — отдельно от ul, никогда не даёт overUl -----------

function coverageCdrrChecks(): void {
  // Натрий по 1000 мг в каждый из двух дней (сумма 2000). cdrr суточный — 800,
  // окно cdrr = 800 * 2 = 1600, сумма 2000 > 1600 -> overCdrr. ul у натрия нет.
  const idx = products(product('a', { kcal: 400, p: 20, f: 10, c: 40 }, { sodium: 1000 }))
  let state = emptyState()
  state = logMeal(state, '2026-08-06', 'lunch', meal('lunch', 'обед', 'a'), idx, 'eaten', 1, 6, 't')
  state = logMeal(state, '2026-08-07', 'lunch', meal('lunch', 'обед', 'a'), idx, 'eaten', 1, 7, 't')

  const week = weekSummary(state.log, '2026-08-07', 7)
  const coverage = weekCoverage(week, { sodium: norm(1500, { cdrr: 800 }) }) // без ul — у натрия его нет
  const sodium = coverage.find((c) => c.key === 'sodium')!

  assert(sodium.value === 2000, `сумма натрия ожидалась 2000, получено ${sodium.value}`)
  assert(sodium.cdrr === 1600, `cdrr окна ожидался 800 * 2 = 1600, получено ${sodium.cdrr}`)
  assert(sodium.overCdrr === true, `2000 > 1600 должно дать overCdrr true, получено ${sodium.overCdrr}`)
  assert(sodium.ul === null, `у натрия ul в норме не задан — ul окна ожидался null, получено ${sodium.ul}`)
  assert(sodium.overUl === false, `превышение cdrr не должно давать overUl (у натрия нет верхнего предела), получено ${sodium.overUl}`)

  group('weekCoverage: cdrr натрия считается отдельно от ul; overCdrr не влияет на overUl и наоборот')
}

// ---- день из одной добавленной еды — записанный, но неполный по приёмам ----------

/* Добавленное сверх меню делает день записанным: калории съедены, и не считать
   их значило бы занизить неделю. Но статусы приёмов оно НЕ трогает — у такого
   дня все четыре приёма остаются missing, и неделя честно считает его неполным
   («записан не полностью»), а не полным днём на 400 ккал. */
function extrasMakeDayLoggedChecks(): void {
  const extra = {
    id: 'e1',
    slot: 'dinner' as Slot,
    fraction: 0.5,
    title: 'Тирамису, порция',
    kbju: { kcal: 800, p: 12, f: 44, c: 64 },
    nutrients: { ...emptyNutrientTotals(), sugar: { value: 50, known: 1, total: 1 } },
    loggedAt: '2026-08-07T21:00:00',
    kind: 'custom' as const,
    customFoodId: 'food-tiramisu',
    source: 'USDA SR Legacy 2018-04'
  }
  const state = addExtra(emptyState(), '2026-08-07', extra, 7)

  const week = weekSummary(state.log, '2026-08-07', 7)
  const day = week.days.find((d) => d.date === '2026-08-07')!

  assert(day.hasLog === true, 'день, в котором записана только добавленная еда, — записанный день')
  assert(day.extrasCount === 1, `extrasCount ожидался 1, получено ${day.extrasCount}`)
  assert(JSON.stringify(day.loggedSlots) === JSON.stringify([]),
    `добавленная еда не даёт приёму статуса, loggedSlots ожидались пустыми, получено ${JSON.stringify(day.loggedSlots)}`)
  assert(day.missingSlots.length === 4, `все четыре приёма обязаны остаться missing, получено ${JSON.stringify(day.missingSlots)}`)
  assert(day.kbju.kcal === 400, `калории дня — снапшот × доля (800 × 0.5), получено ${day.kbju.kcal}`)
  assert(day.nutrients!.sugar.value === 25, `сахара дня ожидались 25 (50 × 0.5), получено ${day.nutrients!.sugar.value}`)

  assert(week.daysWithLog === 1, `день с добавкой обязан войти в число дней с записями, получено ${week.daysWithLog}`)
  assert(week.avgKcal === 400, `среднее за неделю ожидалось 400, получено ${week.avgKcal}`)
  assert(week.incompleteDays === 1, 'день без единого статуса приёма неполон, сколько бы в нём ни было добавок')
  assert(week.loggedSlots === 0 && week.expectedSlots === 4,
    `приёмов записано 0 из 4, получено ${week.loggedSlots} из ${week.expectedSlots}`)

  // контроль: соседние дни окна добавка не трогает
  assert(week.days.filter((d) => d.hasLog).length === 1, 'записанным стал ровно один день окна')
  assert(week.days.every((d) => d.date === '2026-08-07' || d.extrasCount === 0), 'у дней без записей extrasCount равен нулю')

  group('summarizeDay: день из одной добавленной еды записан (hasLog), но все четыре приёма остаются missing')
}

function main(): void {
  console.log('week — недельная сводка: окно дат, средние только по дням с данными')
  emptyDiaryChecks()
  singleDayChecks()
  missingSlotsChecks()
  fractionChecks()
  nutrientAvailabilityChecks()
  partialDaysChecks()
  monthBoundaryChecks()
  yearBoundaryChecks()
  coverageMultiplierChecks()
  coverageNoDataChecks()
  coverageNoNormChecks()
  coverageNotComparableChecks()
  coveragePartialDaysChecks()
  incompleteDaysChecks()
  skippedSlotCompletesDayChecks()
  emptyDayIsNotZeroDayChecks()
  coverageUlChecks()
  coverageUlNotExceededChecks()
  coverageCdrrChecks()
  extrasMakeDayLoggedChecks()
  console.log(`\nВсе проверки week пройдены (${passed} групп).`)
}

try {
  main()
} catch (e) {
  console.error('\n✗ ТЕСТ WEEK УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}
