/**
 * Тесты хранилища состояния (src/state/storage.ts): дефолт, serialize/deserialize
 * round-trip, устойчивость к мусору, миграция. Никакого localStorage — только
 * чистые функции. Гоняется node-ом после сборки esbuild: `npm run test:storage`.
 */
import { CURRENT_VERSION, defaultState, deserialize, serialize } from '../src/state/storage'
import { emptyNutrientTotals } from '../src/core/nutrition'
import { NUTRIENT_KEYS } from '../src/core/types'
import type { AppState } from '../src/core/types'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}
function group(name: string): void { console.log(`  ok ${name}`); passed++ }

// ---- дефолтное состояние валидно -----------------------------------------

function defaultStateChecks(): void {
  const s = defaultState()
  assert(s.version === CURRENT_VERSION, `version ожидалась ${CURRENT_VERSION}, получено ${s.version}`)
  assert(typeof s.settings.cycleStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.settings.cycleStartDate),
    `cycleStartDate должна быть YYYY-MM-DD, получено ${s.settings.cycleStartDate}`)
  assert(s.settings.cycleShift === 0, 'cycleShift по умолчанию 0')
  assert(s.settings.targetKcal === 3200, `targetKcal по умолчанию 3200, получено ${s.settings.targetKcal}`)
  assert(s.settings.shortcutName === '', 'shortcutName по умолчанию пустая строка')
  assert(Object.keys(s.log).length === 0, 'дневник по умолчанию пуст')
  assert(Object.keys(s.preferences.ingredients).length === 0, 'ingredients по умолчанию пуст')
  assert(Object.keys(s.preferences.dishes).length === 0, 'dishes по умолчанию пуст')
  group('defaultState: валидное дефолтное состояние')
}

// ---- serialize -> deserialize даёт то же самое ---------------------------

function roundTripChecks(): void {
  const original = defaultState()
  original.settings.cycleStartDate = '2026-08-01'
  original.settings.cycleShift = -1
  original.settings.targetKcal = 3100
  original.settings.shortcutName = 'ЗаписатьЕду'
  original.log['2026-08-05'] = {
    cycleDay: 5,
    meals: {
      lunch: {
        slot: 'lunch',
        mealId: 'obed-losos-kinoa',
        status: 'partial',
        fraction: 0.5,
        kbju: { kcal: 400, p: 20, f: 10, c: 40 },
        nutrients: {
          ...emptyNutrientTotals(),
          fiber: { value: 12.5, known: 2, total: 3 },
          sodium: { value: 0, known: 3, total: 3 }
        },
        title: 'Обед',
        loggedAt: '2026-08-05T13:00:00'
      }
    }
  }
  original.preferences = {
    ingredients: { tofu: 'avoid', losos: 'love' },
    dishes: {
      'obed-losos-kinoa': { score: 8, comment: 'вкусно, но соли многовато', ratedAt: '2026-08-05T13:05:00' }
    }
  }

  const restored = deserialize(serialize(original))
  assert(JSON.stringify(restored) === JSON.stringify(original), 'round-trip serialize/deserialize должен вернуть то же состояние')
  group('serialize -> deserialize: round-trip сохраняет состояние')
}

// ---- мусор не роняет ------------------------------------------------------

function garbageChecks(): void {
  const cases: { name: string; input: string | null }[] = [
    { name: 'null', input: null },
    { name: 'пустая строка', input: '' },
    { name: 'невалидный JSON', input: '{' },
    { name: 'JSON-массив', input: '[]' },
    { name: 'объект без settings', input: JSON.stringify({ version: 1, log: {} }) },
    { name: 'версия из будущего', input: JSON.stringify({ version: 999, settings: { cycleStartDate: '2026-01-01', cycleShift: 0, targetKcal: 3200, shortcutName: '' }, log: {} }) }
  ]

  for (const c of cases) {
    let result: AppState | undefined
    let threw = false
    try {
      result = deserialize(c.input)
    } catch {
      threw = true
    }
    assert(!threw, `deserialize не должен бросать исключение на входе «${c.name}»`)
    assert(!!result && typeof result.version === 'number', `deserialize должен вернуть рабочий AppState на входе «${c.name}»`)
    assert(!!result && typeof result.settings.cycleStartDate === 'string' && result.settings.cycleStartDate.length > 0,
      `deserialize должен вернуть валидные settings на входе «${c.name}»`)
    assert(!!result && typeof result.log === 'object', `deserialize должен вернуть валидный log на входе «${c.name}»`)
  }

  group('deserialize: мусор (null/пусто/невалидный JSON/массив/без settings/будущая версия) не роняет')
}

// ---- миграция сохраняет уже записанные дни дневника ----------------------

function migrationPreservesLogChecks(): void {
  // «состояние старой версии»: version ниже текущей, но структура полей та же,
  // что и сейчас (единственная реальная миграция сегодня — починка/докомплектация полей)
  const oldState = {
    version: 0,
    settings: { cycleStartDate: '2026-07-01', cycleShift: 2, targetKcal: 3000, shortcutName: '' },
    log: {
      '2026-07-10': {
        cycleDay: 2,
        meals: {
          breakfast: {
            slot: 'breakfast',
            status: 'eaten',
            fraction: 1,
            kbju: { kcal: 500, p: 25, f: 15, c: 50 },
            title: 'Завтрак',
            loggedAt: '2026-07-10T08:00:00'
          }
        }
      }
    }
  }

  const migrated = deserialize(JSON.stringify(oldState))
  assert(migrated.version === CURRENT_VERSION, `после миграции версия должна стать ${CURRENT_VERSION}, получено ${migrated.version}`)
  assert(!!migrated.log['2026-07-10'], 'миграция должна сохранить уже записанный день дневника')
  assert(migrated.log['2026-07-10'].meals.breakfast?.title === 'Завтрак', 'миграция должна сохранить содержимое записи приёма')
  assert(migrated.log['2026-07-10'].meals.breakfast?.kbju.kcal === 500, 'миграция должна сохранить КБЖУ записи')
  assert(migrated.settings.cycleShift === 2, 'миграция должна сохранить настройки из старого состояния')

  group('deserialize: миграция со старой версии сохраняет уже записанные дни дневника')
}

// ---- миграция v1 -> v2: у старых записей не было нутриентов ------------------

/* Запись версии 1 нутриентов не содержит вовсе. Дорисовать ей нули значило бы
   объявить прошлое посчитанным: в дневнике появились бы «0 мг кальция» там, где
   на деле не считали ничего. Правильный исход — пустая сумма: known === 0. */
function migrationV1ToV2Checks(): void {
  const v1 = {
    version: 1,
    settings: { cycleStartDate: '2026-07-01', cycleShift: 1, targetKcal: 3100, shortcutName: 'ЗаписатьЕду' },
    log: {
      '2026-07-11': {
        cycleDay: 3,
        meals: {
          lunch: {
            slot: 'lunch',
            status: 'partial',
            fraction: 0.5,
            kbju: { kcal: 980, p: 60, f: 40, c: 90 },
            title: 'Лосось с киноа',
            loggedAt: '2026-07-11T13:00:00'
          },
          dinner: {
            slot: 'dinner',
            status: 'eaten',
            fraction: 1,
            kbju: { kcal: 850, p: 55, f: 30, c: 70 },
            title: 'Индейка с гречкой',
            loggedAt: '2026-07-11T19:00:00'
          }
        }
      }
    }
  }

  const migrated = deserialize(JSON.stringify(v1))
  assert(migrated.version === CURRENT_VERSION, `версия после миграции ожидалась ${CURRENT_VERSION}, получено ${migrated.version}`)

  const day = migrated.log['2026-07-11']
  assert(!!day, 'день, записанный в версии 1, обязан пережить миграцию')
  assert(Object.keys(day.meals).length === 2, `оба приёма должны сохраниться, получено ${Object.keys(day.meals).length}`)

  const lunch = day.meals.lunch!
  assert(lunch.kbju.kcal === 980 && lunch.kbju.p === 60 && lunch.kbju.f === 40 && lunch.kbju.c === 90,
    `КБЖУ обеда обязано сохраниться дословно, получено ${JSON.stringify(lunch.kbju)}`)
  assert(lunch.fraction === 0.5 && lunch.status === 'partial' && lunch.title === 'Лосось с киноа',
    'остальные поля записи тоже сохраняются')
  assert(day.meals.dinner!.kbju.kcal === 850, 'КБЖУ ужина обязано сохраниться')
  assert(migrated.settings.shortcutName === 'ЗаписатьЕду', 'настройки версии 1 сохраняются')

  assert(!!lunch.nutrients, 'после миграции у записи обязан появиться снапшот нутриентов')
  assert(Object.keys(lunch.nutrients).length === 29, `в снапшоте ожидалось 29 ключей, получено ${Object.keys(lunch.nutrients).length}`)
  assert(NUTRIENT_KEYS.every(k => lunch.nutrients[k].known === 0 && lunch.nutrients[k].total === 0),
    'нутриенты записи версии 1 обязаны стать пустыми с нулевой известностью, а не нулевыми значениями')

  group('deserialize: миграция v1 -> v2 сохраняет дни и КБЖУ, нутриенты становятся пустыми (known = 0)')
}

// ---- миграция v2 -> v3: preferences и mealId появляются, дневник не теряется ---

/* Состояние версии 2 не знает ни preferences, ни MealLogEntry.mealId. После
   миграции дневник обязан выжить целиком (оба дня), preferences — появиться
   пустой книгой, а mealId у поднятых записей — стать пустой строкой (запись
   нельзя привязать к блюду задним числом, см. комментарий в types.ts). */
function migrationV2ToV3Checks(): void {
  const v2 = {
    version: 2,
    settings: { cycleStartDate: '2026-08-01', cycleShift: 0, targetKcal: 3200, shortcutName: '' },
    log: {
      '2026-08-10': {
        cycleDay: 1,
        meals: {
          breakfast: {
            slot: 'breakfast',
            status: 'eaten',
            fraction: 1,
            kbju: { kcal: 500, p: 25, f: 15, c: 50 },
            nutrients: {},
            title: 'Овсянка',
            loggedAt: '2026-08-10T08:00:00'
          }
        }
      },
      '2026-08-11': {
        cycleDay: 2,
        meals: {
          lunch: {
            slot: 'lunch',
            status: 'partial',
            fraction: 0.5,
            kbju: { kcal: 900, p: 55, f: 35, c: 80 },
            nutrients: {},
            title: 'Плов',
            loggedAt: '2026-08-11T13:00:00'
          }
        }
      }
    }
  }

  const migrated = deserialize(JSON.stringify(v2))
  assert(migrated.version === CURRENT_VERSION, `версия после миграции ожидалась ${CURRENT_VERSION}, получено ${migrated.version}`)
  assert(Object.keys(migrated.log).length === 2, `дневник версии 2 обязан пережить миграцию целиком (2 дня), получено ${Object.keys(migrated.log).length}`)
  assert(migrated.log['2026-08-10'].meals.breakfast?.title === 'Овсянка', 'содержимое первого дня сохранилось')
  assert(migrated.log['2026-08-11'].meals.lunch?.kbju.kcal === 900, 'КБЖУ второго дня сохранилось')
  assert(migrated.log['2026-08-10'].meals.breakfast?.mealId === '', `у записи версии 2 mealId обязан стать пустой строкой, получено «${migrated.log['2026-08-10'].meals.breakfast?.mealId}»`)
  assert(migrated.log['2026-08-11'].meals.lunch?.mealId === '', `у записи версии 2 mealId обязан стать пустой строкой, получено «${migrated.log['2026-08-11'].meals.lunch?.mealId}»`)
  assert(Object.keys(migrated.preferences.ingredients).length === 0, 'у состояния версии 2 не было preferences — ingredients после миграции пуст')
  assert(Object.keys(migrated.preferences.dishes).length === 0, 'у состояния версии 2 не было preferences — dishes после миграции пуст')

  group('deserialize: миграция v2 -> v3 поднимает состояние версии 2 без потерь — дневник цел, mealId пустые, preferences пустые')
}

// ---- ingredients: мусорное значение теряет только испорченный ключ -----------

function ingredientsGarbageChecks(): void {
  const raw = {
    version: CURRENT_VERSION,
    settings: { cycleStartDate: '2026-08-01', cycleShift: 0, targetKcal: 3200, shortcutName: '' },
    log: {},
    preferences: {
      ingredients: { losos: 'love', tofu: 'avoid', brokkoli: 'neutral', ogurets: 42, pomidor: null },
      dishes: {}
    }
  }

  const result = deserialize(JSON.stringify(raw))
  assert(result.preferences.ingredients.losos === 'love', 'валидная запись love сохраняется')
  assert(result.preferences.ingredients.tofu === 'avoid', 'валидная запись avoid сохраняется')
  assert(!('brokkoli' in result.preferences.ingredients), 'значение вне love/avoid ("neutral") выбрасывается вместе с ключом')
  assert(!('ogurets' in result.preferences.ingredients), 'числовое значение выбрасывается вместе с ключом')
  assert(!('pomidor' in result.preferences.ingredients), 'null выбрасывается вместе с ключом')
  assert(Object.keys(result.preferences.ingredients).length === 2, `ожидались только 2 валидных ключа, получено ${JSON.stringify(result.preferences.ingredients)}`)

  group('preferences.ingredients: значение-мусор теряет только испорченный ключ, остальные выживают')
}

// ---- dishes: битый балл или тип теряют запись целиком -------------------------

function dishesGarbageChecks(): void {
  const raw = {
    version: CURRENT_VERSION,
    settings: { cycleStartDate: '2026-08-01', cycleShift: 0, targetKcal: 3200, shortcutName: '' },
    log: {},
    preferences: {
      ingredients: {},
      dishes: {
        'blyudo-nol': { score: 0, comment: 'ноль недопустим', ratedAt: '2026-08-01T10:00:00' },
        'blyudo-odinnadtsat': { score: 11, comment: 'больше десяти недопустимо', ratedAt: '2026-08-01T10:00:00' },
        'blyudo-drob': { score: 7.5, comment: 'дробный балл недопустим', ratedAt: '2026-08-01T10:00:00' },
        'blyudo-stroka': { score: '8', comment: 'балл строкой недопустим', ratedAt: '2026-08-01T10:00:00' },
        'blyudo-validnoe': { score: 8, comment: 'ровно то, что нужно', ratedAt: '2026-08-01T10:00:00' }
      }
    }
  }

  const result = deserialize(JSON.stringify(raw))
  assert(!('blyudo-nol' in result.preferences.dishes), 'score === 0 недопустим (нуля-оценки не существует)')
  assert(!('blyudo-odinnadtsat' in result.preferences.dishes), 'score === 11 выходит за пределы 1..10')
  assert(!('blyudo-drob' in result.preferences.dishes), 'дробный score недопустим')
  assert(!('blyudo-stroka' in result.preferences.dishes), 'score строкой недопустим')
  assert(result.preferences.dishes['blyudo-validnoe']?.score === 8, 'валидная запись сохраняется')
  assert(Object.keys(result.preferences.dishes).length === 1, `ожидалась ровно 1 валидная запись, получено ${JSON.stringify(result.preferences.dishes)}`)

  group('preferences.dishes: балл вне 1..10, дробный или нечисловой роняет только эту запись')
}

function main(): void {
  console.log('storage — хранилище состояния: дефолт, round-trip, мусор, миграция')
  defaultStateChecks()
  roundTripChecks()
  garbageChecks()
  migrationPreservesLogChecks()
  migrationV1ToV2Checks()
  migrationV2ToV3Checks()
  ingredientsGarbageChecks()
  dishesGarbageChecks()
  console.log(`\nВсе проверки storage пройдены (${passed} групп).`)
}

try {
  main()
} catch (e) {
  console.error('\n✗ ТЕСТ STORAGE УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}
