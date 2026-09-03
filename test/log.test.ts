/**
 * Тесты дневника (src/core/log.ts): логирование/разлогирование приёмов,
 * снапшот КБЖУ, суммы. Никакого localStorage — только чистые функции над
 * AppState. Гоняются node-ом после сборки esbuild: `npm run test:log`.
 */
import { addExtra, clearLog, dayNutrientTotals, dayTotal, eatenExtraKbju, eatenKbju, eatenNutrients, logFootprint, logMeal, removeExtra, unlogMeal } from '../src/core/log'
import { emptyNutrientTotals } from '../src/core/nutrition'
import type { AppState, CustomFood, ExtraLogEntry, Kbju, Meal, NutrientTotals, Nutrients, Product, ProductIndex } from '../src/core/types'

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

function meal(slot: 'breakfast' | 'lunch' | 'dinner' | 'snack', title: string, kcalPer100: number, id = `${slot}-${title}`): Meal {
  return {
    slot,
    id,
    title,
    steps: [],
    items: [{ product: 'x', g: 100, where: 'container' }]
  }
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
  const state2 = logMeal(state1, '2026-08-05', 'dinner', meal('dinner', 'v1', 200), idx, 'eaten', 1, 5, 't2')
  const state3 = unlogMeal(state2, '2026-08-05', 'lunch')

  assert(state3.log['2026-08-05'] !== undefined, 'день с оставшейся записью обязан остаться в дневнике')
  assert(state3.log['2026-08-05'].meals.lunch === undefined, 'unlogMeal должен удалить запись')
  assert(state3.log['2026-08-05'].meals.dinner !== undefined, 'соседняя запись того же дня не трогается')
  assert(state2.log['2026-08-05'].meals.lunch !== undefined, 'unlogMeal не должен мутировать входной state')

  group('unlogMeal: удаляет запись, соседняя остаётся, входной state не мутирован')
}

/* Отменённая последняя запись обязана унести и сам день: пустой день — это день
   БЕЗ записей, а не день, в который человек ничего не съел. Оставленный ключ
   даты делал день записанным для недельной сводки, и среднее за неделю делилось
   на лишний день: два дня по 3000 ккал и один отменённый давали «2000». */
function unlogLastMealRemovesDayChecks(): void {
  const idx = products(product('x', { kcal: 200, p: 10, f: 5, c: 20 }))
  let state = emptyState()
  state = logMeal(state, '2026-08-05', 'lunch', meal('lunch', 'v1', 200), idx, 'eaten', 1, 5, 't1')
  state = logMeal(state, '2026-08-06', 'lunch', meal('lunch', 'v1', 200), idx, 'eaten', 1, 6, 't2')
  const after = unlogMeal(state, '2026-08-05', 'lunch')

  assert(!('2026-08-05' in after.log), 'после отмены последней записи ключ даты обязан исчезнуть из дневника')
  assert('2026-08-06' in after.log, 'соседний день не трогается')
  assert(Object.keys(after.log).length === 1, `в дневнике ожидался 1 день, получено ${Object.keys(after.log).length}`)
  assert('2026-08-05' in state.log, 'unlogMeal не должен мутировать входной state')

  group('unlogMeal: отмена последней записи дня уносит ключ даты — «дня с нулём» не остаётся')
}

/* Ревизия справочника — снапшот наравне с КБЖУ: без неё два соседних дня молча
   считаются по разным числам. Параметр необязателен, и когда его не передали,
   поля в записи быть не должно — «неизвестно» нельзя записывать как значение. */
function productsRevisionChecks(): void {
  const idx = products(product('x', { kcal: 200, p: 10, f: 5, c: 20 }))
  const withRev = logMeal(emptyState(), '2026-08-05', 'lunch', meal('lunch', 'обед', 200), idx, 'eaten', 1, 5, 't1', '2026-08-17')
  const entry = withRev.log['2026-08-05'].meals.lunch!
  assert(entry.productsRevision === '2026-08-17', `ревизия справочника ожидалась 2026-08-17, получено ${entry.productsRevision}`)

  const withoutRev = logMeal(emptyState(), '2026-08-05', 'lunch', meal('lunch', 'обед', 200), idx, 'eaten', 1, 5, 't1')
  const bare = withoutRev.log['2026-08-05'].meals.lunch!
  assert(!('productsRevision' in bare), 'без переданной ревизии поля в записи быть не должно')

  group('logMeal: переданная ревизия справочника ложится в запись, непереданная не выдумывается')
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
    slot, id: `${slot}-${productId}`, title, steps: [], items: [{ product: productId, g: 100, where: 'container' }]
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
    id: 'obed-dvukh-pozitsy',
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
  assert(entry.mealId === twoItemMeal.id, `mealId снапшота ожидался ${twoItemMeal.id}, получено ${entry.mealId}`)

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

/* Пропущенный приём — ноль ПОЗИЦИЙ, а не позиции с измеренным нулём. Сохрани мы
   у него known, пропуск выглядел бы полноценным измерением: сумма дня считалась
   бы полной по этим ключам, а выгрузка в Health отправляла бы три десятка
   честных на вид нулей. */
function skippedNutrientsChecks(): void {
  const idx = products(product('x', { kcal: 200, p: 10, f: 5, c: 20 }, { fiber: 4, vitK: 20, sodium: 0 }))
  const state = logMeal(emptyState(), '2026-08-09', 'breakfast', meal('breakfast', 'Завтрак', 200), idx, 'skipped', 0, 9, 't')
  const entry = state.log['2026-08-09'].meals.breakfast!

  assert(entry.nutrients.fiber.known === 1 && entry.nutrients.fiber.total === 1,
    'сам снапшот приёма полноту сохраняет — обнуляется только съеденное')

  const eaten = eatenNutrients(entry)
  for (const key of ['fiber', 'vitK', 'sodium'] as const) {
    assert(eaten[key].value === 0 && eaten[key].known === 0 && eaten[key].total === 0,
      `пропущенный приём обязан дать ноль позиций по «${key}», получено ${JSON.stringify(eaten[key])}`)
  }

  const totals = dayNutrientTotals(state.log['2026-08-09'])
  assert(totals.fiber.known === 0 && totals.fiber.total === 0,
    `день из одного пропущенного приёма не несёт ни одной позиции, получено ${JSON.stringify(totals.fiber)}`)
  group('eatenNutrients: пропущенный приём даёт ноль позиций, а не позиции с измеренным нулём')
}

function dayNutrientTotalsChecks(): void {
  const idx = products(
    product('a', { kcal: 400, p: 20, f: 10, c: 40 }, { fiber: 10, vitK: 30 }),
    product('b', { kcal: 600, p: 30, f: 20, c: 50 }, { fiber: 20 })
  )
  const mealFor = (slot: 'breakfast' | 'lunch', productId: string): Meal => ({
    slot, id: `${slot}-${productId}`, title: slot, steps: [], items: [{ product: productId, g: 100, where: 'container' }]
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

function clearAndFootprintChecks(): void {
  const idx = products(product('x', { kcal: 200, p: 10, f: 5, c: 20 }))
  const state0 = emptyState()
  const state1 = logMeal(state0, '2026-08-05', 'lunch', meal('lunch', 'обед', 200), idx, 'eaten', 1, 5, 't1')
  const state2 = logMeal(state1, '2026-08-06', 'dinner', meal('dinner', 'ужин', 200), idx, 'eaten', 1, 6, 't2')

  const before = logFootprint(state2.log)
  assert(before.days === 2, `в дневнике ожидалось 2 дня, получено ${before.days}`)
  // байты считаются по UTF-8: кириллические названия дают больше байт, чем символов
  const chars = JSON.stringify(state2.log).length
  assert(before.bytes > chars, `UTF-8 байт (${before.bytes}) должно быть больше, чем символов (${chars}) — иначе кириллица посчитана как ASCII`)
  group('logFootprint: считает дни и размер дневника в байтах UTF-8, а не в символах')

  const cleared = clearLog(state2)
  assert(Object.keys(cleared.log).length === 0, 'после clearLog дневник должен быть пуст')
  assert(cleared.settings === state2.settings, 'clearLog не должен трогать настройки')
  assert(Object.keys(state2.log).length === 2, 'clearLog не должен мутировать исходное состояние')
  assert(logFootprint(cleared.log).days === 0 && logFootprint(cleared.log).bytes > 0, 'пустой дневник — это 0 дней и непустой JSON "{}"')
  group('clearLog: стирает дневник целиком, сохраняет настройки, исходное состояние не мутирует')
}

// ---- добавленная сверх меню еда ------------------------------------------------

/** Запись своей еды: снапшот ПОЛНОЙ порции, долю применяет потребитель. */
function customExtra(id: string, kcal: number, fraction: number, nutrients: NutrientTotals = emptyNutrientTotals()): ExtraLogEntry {
  return {
    id,
    slot: 'dinner',
    fraction,
    title: `Добавка ${id}`,
    kbju: { kcal, p: kcal / 20, f: kcal / 40, c: kcal / 10 },
    nutrients,
    loggedAt: '2026-08-05T21:00:00',
    kind: 'custom',
    customFoodId: `food-${id}`,
    source: 'USDA SR Legacy 2018-04'
  }
}

/* Добавленная еда входит в сумму дня той же арифметикой, что и приём: снапшот
   × доля. Полнота складывается вместе с числами — нутриент, которого добавка
   не знает, делает день неполным по этому нутриенту. */
function addExtraChecks(): void {
  const idx = products(product('x', { kcal: 200, p: 10, f: 5, c: 20 }, { fiber: 10 }))
  const state0 = logMeal(emptyState(), '2026-08-05', 'lunch', meal('lunch', 'Обед', 200), idx, 'eaten', 1, 5, 't1')
  const beforeKcal = dayTotal(state0.log['2026-08-05']).kcal

  const extraNutrients: NutrientTotals = { ...emptyNutrientTotals(), fiber: { value: 6, known: 1, total: 1 } }
  const state1 = addExtra(state0, '2026-08-05', customExtra('e1', 400, 0.5, extraNutrients), 5)

  const day = state1.log['2026-08-05']
  assert(day.extras.length === 1, `в дне ожидалась одна добавка, получено ${day.extras.length}`)
  assert(Object.keys(day.meals).length === 1, 'добавленная еда не трогает записи приёмов')
  assert(dayTotal(day).kcal === beforeKcal + 200,
    `сумма дня обязана вырасти ровно на kbju × долю (${beforeKcal} + 200), получено ${dayTotal(day).kcal}`)
  assert(eatenExtraKbju(day.extras[0]).kcal === 200, 'съеденное по добавке — снапшот, умноженный на долю')
  assert(state0.log['2026-08-05'].extras.length === 0, 'addExtra не должен мутировать входной state')

  const totals = dayNutrientTotals(day)
  assert(totals.fiber.value === 10 + 3, `клетчатка дня ожидалась 13 (10 приём + 6 × 0.5), получено ${totals.fiber.value}`)
  assert(totals.fiber.known === 2 && totals.fiber.total === 2, `полнота обязана сложиться (2 из 2), получено ${JSON.stringify(totals.fiber)}`)
  assert(totals.calcium.known === 0 && totals.calcium.total === 1,
    `нутриент, неизвестный ни приёму, ни добавке, остаётся неизвестной позицией, получено ${JSON.stringify(totals.calcium)}`)

  // добавка в день, где записей ещё не было: день заводится вместе с ней
  const fresh = addExtra(emptyState(), '2026-08-09', customExtra('e2', 300, 1), 9)
  assert(fresh.log['2026-08-09'].cycleDay === 9, 'день, заведённый добавкой, несёт переданный день цикла')
  assert(dayTotal(fresh.log['2026-08-09']).kcal === 300, 'сумма дня из одной добавки — её калории целиком')

  // повторное сохранение того же разбора не удваивает калории
  const twice = addExtra(state1, '2026-08-05', customExtra('e1', 400, 1, extraNutrients), 5)
  assert(twice.log['2026-08-05'].extras.length === 1, 'запись с тем же id перезаписывается, а не дублируется')
  assert(dayTotal(twice.log['2026-08-05']).kcal === beforeKcal + 400, 'перезаписанная добавка считается по новой доле')

  group('addExtra: сумма дня растёт на kbju × долю, полнота складывается, повтор id перезаписывает')
}

/* День уходит из дневника только когда пусты И приёмы, И добавленное. Пока в
   дне живёт хоть одна добавка, отмена последнего приёма его не уносит: иначе
   съеденный сверх меню десерт исчезал бы вместе с записью об обеде. */
function removeExtraChecks(): void {
  const idx = products(product('x', { kcal: 200, p: 10, f: 5, c: 20 }))
  let state = logMeal(emptyState(), '2026-08-05', 'lunch', meal('lunch', 'Обед', 200), idx, 'eaten', 1, 5, 't1')
  state = addExtra(state, '2026-08-05', customExtra('e1', 400, 1), 5)
  state = addExtra(state, '2026-08-05', customExtra('e2', 100, 1), 5)

  const afterUnlog = unlogMeal(state, '2026-08-05', 'lunch')
  assert('2026-08-05' in afterUnlog.log, 'день с живыми добавками обязан остаться после отмены последнего приёма')
  assert(afterUnlog.log['2026-08-05'].extras.length === 2, 'отмена приёма не трогает добавленное')
  assert(dayTotal(afterUnlog.log['2026-08-05']).kcal === 500, 'в дне остались только калории добавок')

  const afterOne = removeExtra(afterUnlog, '2026-08-05', 'e1')
  assert(afterOne.log['2026-08-05'].extras.length === 1, 'убирается ровно одна запись')
  assert(afterOne.log['2026-08-05'].extras[0].id === 'e2', 'соседняя добавка не трогается')

  const afterLast = removeExtra(afterOne, '2026-08-05', 'e2')
  assert(!('2026-08-05' in afterLast.log), 'после удаления последней добавки ключ даты обязан исчезнуть — «дня с нулём» не бывает')
  assert(afterOne.log['2026-08-05'].extras.length === 1, 'removeExtra не должен мутировать входной state')

  const unknown = removeExtra(afterOne, '2026-08-05', 'ne-sushchestvuet')
  assert(unknown === afterOne, 'удаление несуществующей записи не создаёт нового состояния')
  const missingDay = removeExtra(afterOne, '2026-01-01', 'e2')
  assert(missingDay === afterOne, 'удаление из дня, которого нет, ничего не меняет')

  group('removeExtra: убирает запись, последняя уносит ключ даты; unlogMeal при живых добавках день оставляет')
}

/* Книга своей еды весит килобайт на компонент и лежит в том же localStorage.
   Человек, который смотрит на размер перед очисткой, обязан видеть её тоже. */
function footprintCountsCustomFoodsChecks(): void {
  const idx = products(product('x', { kcal: 200, p: 10, f: 5, c: 20 }))
  const state = logMeal(emptyState(), '2026-08-05', 'lunch', meal('lunch', 'Обед', 200), idx, 'eaten', 1, 5, 't1')

  const food: CustomFood = {
    id: 'food-tiramisu',
    title: 'Тирамису, порция',
    source: 'USDA SR Legacy 2018-04',
    spec: 1,
    jobId: 'food:11111111-2222-4333-8444-555555555555',
    request: { text: 'тирамису', grams: 120 },
    components: [{
      fdcId: 171843, description: 'Tiramisu', category: 'Sweets', grams: 120,
      per100: { kbju: { kcal: 291, p: 4.9, f: 18.3, c: 26.6 }, micro: { sugar: 20.8 } }
    }],
    createdAt: '2026-08-05T20:55:00'
  }

  const withoutBook = logFootprint(state.log)
  const withBook = logFootprint(state.log, { 'food-tiramisu': food })
  assert(withoutBook.foods === 0 && withBook.foods === 1, `в книге ожидалась одна еда, получено ${withBook.foods}`)
  assert(withBook.days === 1, 'дни считаются по дневнику, книга их число не меняет')
  assert(withBook.bytes > withoutBook.bytes, `книга обязана увеличить размер (${withoutBook.bytes} -> ${withBook.bytes})`)
  group('logFootprint: книга своей еды входит в размер записанного, дни считаются по дневнику')
}

function main(): void {
  console.log('log — дневник: снапшот, перезапись, unlog, суммы')
  snapshotIsFrozenChecks()
  overwriteChecks()
  unlogChecks()
  unlogLastMealRemovesDayChecks()
  productsRevisionChecks()
  skippedChecks()
  mixChecks()
  nutrientSnapshotChecks()
  eatenNutrientsChecks()
  skippedNutrientsChecks()
  dayNutrientTotalsChecks()
  clearAndFootprintChecks()
  addExtraChecks()
  removeExtraChecks()
  footprintCountsCustomFoodsChecks()
  console.log(`\nВсе проверки log пройдены (${passed} групп).`)
}

try {
  main()
} catch (e) {
  console.error('\n✗ ТЕСТ LOG УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}
