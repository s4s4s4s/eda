/**
 * Тесты выбора блюда из меню, собранного редакциями (src/core/menu.ts): какая
 * редакция действует на дату, дни, которых редакция не описывает, и сборка
 * allMeals без дублей. Гоняются node-ом после сборки esbuild: `npm run test:menu`.
 */
import { allMeals, mealFor, menuDayFor } from '../src/core/menu'
import type { Meal, Menu, MenuDay, MenuEdition, Slot } from '../src/core/types'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}
function group(name: string): void { console.log(`  ok ${name}`); passed++ }

function meal(id: string, title: string, slot: Slot = 'breakfast'): Meal {
  return { id, slot, title, steps: [], items: [] }
}

function day(dayNum: number, meals: Meal[]): MenuDay {
  return { day: dayNum, meals }
}

function edition(title: string, days: MenuDay[], from?: string): MenuEdition {
  return from === undefined ? { title, days } : { title, days, from }
}

// ---- базовая редакция действует, пока новая не вступила в силу -----------------------

function baseBeforeNewChecks(): void {
  const menu: Menu = {
    cycleDays: 8,
    editions: [
      edition('база', [day(1, [meal('a1', 'база день1')])]),
      edition('свежая от 10 сентября', [day(1, [meal('a1', 'свежая день1')])], '2026-09-10')
    ]
  }

  const found = menuDayFor(menu, '2026-09-09', 1)
  assert(found !== undefined, 'день 1 на 09.09 должен находиться')
  assert(found!.edition.title === 'база', `09.09 (за день до вступления новой) ожидалась база, получено ${found!.edition.title}`)
  assert(found!.day.meals[0].title === 'база день1', `блюдо ожидалось из базовой редакции, получено ${found!.day.meals[0].title}`)

  group('дата раньше from новой редакции — берётся база')
}

// ---- граница вступления в силу включающая -----------------------------------------

function inclusiveBoundaryChecks(): void {
  const menu: Menu = {
    cycleDays: 8,
    editions: [
      edition('база', [day(1, [meal('a1', 'база день1')])]),
      edition('свежая от 10 сентября', [day(1, [meal('a1', 'свежая день1')])], '2026-09-10')
    ]
  }

  const found = menuDayFor(menu, '2026-09-10', 1)
  assert(found !== undefined, 'день 1 на 10.09 должен находиться')
  assert(found!.edition.title === 'свежая от 10 сентября', `10.09 (день вступления в силу) ожидалась новая редакция, получено ${found!.edition.title}`)

  group('дата === from новой редакции — граница включающая, действует уже новая')
}

// ---- день, которого новая редакция не описывает, берётся из предыдущей ---------------

function fallbackToOlderChecks(): void {
  const menu: Menu = {
    cycleDays: 8,
    editions: [
      edition('база', [day(1, [meal('a1', 'база день1')]), day(2, [meal('a2', 'база день2')])]),
      edition('свежая от 10 сентября', [day(1, [meal('a1', 'свежая день1')])], '2026-09-10') // день 2 не описан
    ]
  }

  const found = menuDayFor(menu, '2026-09-15', 2)
  assert(found !== undefined, 'день 2 должен находиться в базовой редакции')
  assert(found!.edition.title === 'база', `день 2, не описанный новой редакцией, ожидался из базы, получено ${found!.edition.title}`)
  assert(found!.day.meals[0].title === 'база день2', `блюдо дня 2 ожидалось из базы, получено ${found!.day.meals[0].title}`)

  group('день, которого новая редакция не описывает, продолжает браться из предыдущей')
}

// ---- три редакции: берётся самая свежая из действующих --------------------------------

function latestOfThreeChecks(): void {
  const menu: Menu = {
    cycleDays: 8,
    editions: [
      edition('база', [day(1, [meal('a1', 'база')])]),
      edition('средняя от 5 сентября', [day(1, [meal('a1', 'средняя')])], '2026-09-05'),
      edition('свежая от 20 сентября', [day(1, [meal('a1', 'свежая')])], '2026-09-20')
    ]
  }

  const found = menuDayFor(menu, '2026-09-15', 1)
  assert(found !== undefined, 'день 1 на 15.09 должен находиться')
  assert(found!.edition.title === 'средняя от 5 сентября',
    `15.09 (между средней и свежей) ожидалась средняя редакция, получено ${found!.edition.title}`)
  assert(found!.day.meals[0].title === 'средняя', `блюдо ожидалось из средней редакции, получено ${found!.day.meals[0].title}`)

  group('три редакции: выбирается самая свежая из действующих, не последняя в массиве и не первая подходящая')
}

// ---- день, которого нет ни в одной редакции ------------------------------------------

function missingDayChecks(): void {
  const menu: Menu = {
    cycleDays: 8,
    editions: [
      edition('база', [day(1, [meal('a1', 'база день1')])])
    ]
  }

  const found = menuDayFor(menu, '2026-09-15', 5)
  assert(found === undefined, `дня 5, которого нет ни в одной редакции, не должно находиться, получено ${JSON.stringify(found)}`)

  group('menuDayFor возвращает undefined для номера дня, которого нет ни в одной редакции')
}

// ---- все редакции с from, все в будущем -----------------------------------------------

function allEditionsFutureChecks(): void {
  const menu: Menu = {
    cycleDays: 8,
    editions: [
      edition('первая будущая', [day(1, [meal('a1', 'первая')])], '2026-10-01'),
      edition('вторая будущая', [day(1, [meal('a1', 'вторая')])], '2026-10-15')
    ]
  }

  const found = menuDayFor(menu, '2026-09-15', 1)
  assert(found === undefined, `при всех редакциях в будущем ожидался undefined, получено ${JSON.stringify(found)}`)

  group('меню, где все редакции ещё не вступили в силу, даёт undefined, а не падает')
}

// ---- mealFor: слот из выбранной редакции и undefined для отсутствующего слота --------

function mealForChecks(): void {
  const menu: Menu = {
    cycleDays: 8,
    editions: [
      edition('база', [day(1, [{ id: 'b1', slot: 'breakfast', title: 'завтрак база', steps: [], items: [] }])])
    ]
  }

  const found = mealFor(menu, '2026-09-15', 1, 'breakfast')
  assert(found !== undefined, 'завтрак дня 1 должен находиться')
  assert(found!.title === 'завтрак база', `mealFor ожидал завтрак базы, получено ${found!.title}`)

  const missing = mealFor(menu, '2026-09-15', 1, 'lunch')
  assert(missing === undefined, `обеда в этом дне нет, ожидался undefined, получено ${JSON.stringify(missing)}`)

  group('mealFor: отдаёт приём нужного слота, undefined для слота, которого в дне нет')
}

// ---- allMeals: без дублей, самая свежая версия, старые id не теряются -----------------

function allMealsChecks(): void {
  const menu: Menu = {
    cycleDays: 8,
    editions: [
      edition('база', [
        day(1, [meal('shared', 'старая версия'), meal('onlyOld', 'только в базе')])
      ]),
      edition('свежая от 5 сентября', [
        day(1, [meal('shared', 'новая версия')])
      ], '2026-09-05')
    ]
  }

  const list = allMeals(menu)
  const ids = list.map((e) => e.meal.id).sort()
  assert(ids.length === new Set(ids).size, `id не должны повторяться, получено ${JSON.stringify(ids)}`)
  assert(JSON.stringify(ids) === JSON.stringify(['onlyOld', 'shared']), `ожидались id [onlyOld, shared], получено ${JSON.stringify(ids)}`)

  const shared = list.find((e) => e.meal.id === 'shared')!
  assert(shared.meal.title === 'новая версия', `для id shared ожидалась версия из самой свежей редакции, получено ${shared.meal.title}`)

  const onlyOld = list.find((e) => e.meal.id === 'onlyOld')!
  assert(onlyOld.meal.title === 'только в базе', 'блюдо, которое есть только в старой редакции, не должно теряться')

  assert(JSON.stringify(list.map((e) => e.meal.id)) === JSON.stringify(['shared', 'onlyOld']),
    `порядок строк — порядок первого появления в меню, получено ${JSON.stringify(list.map((e) => e.meal.id))}`)

  group('allMeals: без дублей id, версия из самой свежей редакции, блюда только из старой не теряются')
}

// ---- allMeals: места блюда собираются со всех редакций и не двоятся ------------------

function allMealsPlacesChecks(): void {
  const menu: Menu = {
    cycleDays: 8,
    editions: [
      edition('база', [
        day(1, [meal('shared', 'старая версия')]),
        day(3, [meal('shared', 'она же в среду')])
      ]),
      edition('свежая от 5 сентября', [
        day(1, [meal('shared', 'новая версия')]),
        day(5, [meal('shared', 'она же на ужин', 'dinner')])
      ], '2026-09-05')
    ]
  }

  const shared = allMeals(menu).find((e) => e.meal.id === 'shared')!
  const places = shared.places.map((p) => `${p.day}/${p.slot}`)
  assert(JSON.stringify(places) === JSON.stringify(['1/breakfast', '3/breakfast', '5/dinner']),
    `места должны собираться со всех редакций без дублей, получено ${JSON.stringify(places)}`)

  group('allMeals: места собираются со всех редакций, повтор дня и приёма не двоится')
}

function main(): void {
  console.log('menu — выбор дня/приёма из меню, собранного редакциями')
  baseBeforeNewChecks()
  inclusiveBoundaryChecks()
  fallbackToOlderChecks()
  latestOfThreeChecks()
  missingDayChecks()
  allEditionsFutureChecks()
  mealForChecks()
  allMealsChecks()
  allMealsPlacesChecks()
  console.log(`\nВсе проверки menu пройдены (${passed} групп).`)
}

try {
  main()
} catch (e) {
  console.error('\n✗ ТЕСТ MENU УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}
