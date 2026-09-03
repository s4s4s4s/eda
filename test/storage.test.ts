/**
 * Тесты хранилища состояния (src/state/storage.ts): дефолт, serialize/deserialize
 * round-trip, устойчивость к мусору, миграция, loadState/saveState поверх
 * фейкового localStorage. Гоняется node-ом после сборки esbuild: `npm run test:storage`.
 */
import { BACKUP_KEY, CURRENT_VERSION, defaultState, deserialize, loadState, saveState, serialize, STORAGE_KEY } from '../src/state/storage'
import { emptyNutrientTotals, isComplete } from '../src/core/nutrition'
import { dayNutrientTotals, dayTotal } from '../src/core/log'
import { NUTRIENT_KEYS } from '../src/core/types'
import type { AppState, NutrientTotals } from '../src/core/types'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}
function group(name: string): void { console.log(`  ok ${name}`); passed++ }

/** Фейковый localStorage — Storage целиком в памяти, без браузера. Используется
    только тестами loadState/saveState; чистые функции (deserialize/serialize)
    его не видят вовсе. */
class FakeStorage implements Storage {
  private data = new Map<string, string>()
  get length(): number { return this.data.size }
  clear(): void { this.data.clear() }
  getItem(key: string): string | null { return this.data.has(key) ? this.data.get(key)! : null }
  key(index: number): string | null { return Array.from(this.data.keys())[index] ?? null }
  removeItem(key: string): void { this.data.delete(key) }
  setItem(key: string, value: string): void { this.data.set(key, value) }
}

function withFakeStorage(fn: (storage: FakeStorage) => void): void {
  const storage = new FakeStorage()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })
  try {
    fn(storage)
  } finally {
    if (original) {
      Object.defineProperty(globalThis, 'localStorage', original)
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage
    }
  }
}

// ---- дефолтное состояние валидно -----------------------------------------

function defaultStateChecks(): void {
  const s = defaultState()
  assert(s.version === CURRENT_VERSION, `version ожидалась ${CURRENT_VERSION}, получено ${s.version}`)
  assert(typeof s.settings.cycleStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.settings.cycleStartDate),
    `cycleStartDate должна быть YYYY-MM-DD, получено ${s.settings.cycleStartDate}`)
  assert(s.settings.cycleShift === 0, 'cycleShift по умолчанию 0')
  assert(s.settings.targetKcal === 3200, `targetKcal по умолчанию 3200, получено ${s.settings.targetKcal}`)
  assert(s.settings.shortcutName === '', 'shortcutName по умолчанию пустая строка')
  assert(s.settings.cycleStartConfirmed === false, 'cycleStartConfirmed по умолчанию false — вопрос ещё не задан')
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
  original.settings.cycleStartConfirmed = true
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
  assert(restored.source === 'stored', `source ожидался 'stored', получено '${restored.source}'`)
  assert(JSON.stringify(restored.state) === JSON.stringify(original), 'round-trip serialize/deserialize должен вернуть то же состояние')
  group('serialize -> deserialize: round-trip сохраняет состояние')
}

// ---- мусор не роняет ------------------------------------------------------

function garbageChecks(): void {
  const cases: { name: string; input: string | null }[] = [
    { name: 'null', input: null },
    { name: 'пустая строка', input: '' },
    { name: 'невалидный JSON', input: '{' },
    { name: 'JSON-массив', input: '[]' },
    { name: 'объект без settings', input: JSON.stringify({ version: 1, log: {} }) }
  ]

  for (const c of cases) {
    let result: AppState | undefined
    let threw = false
    try {
      result = deserialize(c.input).state
    } catch {
      threw = true
    }
    assert(!threw, `deserialize не должен бросать исключение на входе «${c.name}»`)
    assert(!!result && typeof result.version === 'number', `deserialize должен вернуть рабочий AppState на входе «${c.name}»`)
    assert(!!result && typeof result.settings.cycleStartDate === 'string' && result.settings.cycleStartDate.length > 0,
      `deserialize должен вернуть валидные settings на входе «${c.name}»`)
    assert(!!result && typeof result.log === 'object', `deserialize должен вернуть валидный log на входе «${c.name}»`)
  }

  group('deserialize: мусор (null/пусто/невалидный JSON/массив/без settings) не роняет')
}

// ---- версия из будущего: дефолт с честным источником, хранилище не трогаем ----

function newerVersionChecks(): void {
  const input = JSON.stringify({
    version: CURRENT_VERSION + 1,
    settings: {
      cycleStartDate: '2026-01-01', cycleShift: 0, targetKcal: 3200, targetProteinG: 120,
      shortcutName: '', cycleStartConfirmed: true
    },
    log: {},
    preferences: { ingredients: {}, dishes: {} }
  })

  const result = deserialize(input)
  assert(result.source === 'newer-version', `source ожидался 'newer-version', получено '${result.source}'`)
  assert(result.state.version === CURRENT_VERSION, 'дефолт при newer-version несёт текущую версию сборки')
  group('deserialize: версия из будущего отдаёт source «newer-version» и дефолтное состояние')

  withFakeStorage(storage => {
    storage.setItem(STORAGE_KEY, input)
    const loaded = loadState()
    assert(loaded.source === 'newer-version', 'loadState тоже отдаёт «newer-version»')
    assert(storage.getItem(STORAGE_KEY) === input, 'loadState НЕ должен менять содержимое хранилища при newer-version')
    group('loadState: версия из будущего НЕ трогает содержимое localStorage')
  })
}

// ---- loadState/saveState поверх фейкового localStorage --------------------

function loadSaveRoundTripChecks(): void {
  withFakeStorage(storage => {
    const empty = loadState()
    assert(empty.source === 'default', 'пустое хранилище даёт source «default»')
    assert(empty.state.version === CURRENT_VERSION, 'пустое хранилище даёт дефолт текущей версии')

    const toSave = defaultState()
    toSave.settings.targetKcal = 2900
    const saveResult = saveState(toSave)
    assert(saveResult.ok, 'saveState в фейковое хранилище обязан пройти успешно')

    const reloaded = loadState()
    assert(reloaded.source === 'stored', 'после saveState загрузка отдаёт source «stored»')
    assert(reloaded.state.settings.targetKcal === 2900, 'после saveState загруженное состояние совпадает с сохранённым')
    assert(storage.getItem(STORAGE_KEY) !== null, 'saveState реально пишет в STORAGE_KEY')
  })

  group('loadState/saveState: запись и чтение через фейковый localStorage совпадают')
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

  const migrated = deserialize(JSON.stringify(oldState)).state
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
   на деле не считали ничего. Правильный исход — НЕИЗВЕСТНАЯ ПОЗИЦИЯ: known 0
   при total 1 (см. NutrientTotal.total в types.ts). Ноль позиций (total 0) был
   бы враньём другого рода: приём выпал бы из отношения known/total, и день, в
   который он входит, читался бы как полностью посчитанный. */
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

  const migrated = deserialize(JSON.stringify(v1)).state
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
  assert(Object.keys(lunch.nutrients).length === NUTRIENT_KEYS.length, `в снапшоте ожидалось ${NUTRIENT_KEYS.length} ключей, получено ${Object.keys(lunch.nutrients).length}`)
  assert(NUTRIENT_KEYS.every(k => lunch.nutrients[k].known === 0 && lunch.nutrients[k].total === 1),
    `нутриенты записи версии 1 обязаны войти одной неизвестной позицией (known 0, total 1), получено ${JSON.stringify(lunch.nutrients.fiber)}`)
  assert(NUTRIENT_KEYS.every(k => lunch.nutrients[k].value === 0),
    'значение неизвестной позиции — ноль-заглушка, а не результат')

  group('deserialize: миграция v1 -> v2 сохраняет дни и КБЖУ, нутриенты становятся неизвестной позицией (known 0, total 1)')
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

  const migrated = deserialize(JSON.stringify(v2)).state
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

// ---- миграция v3 -> v4: cycleStartConfirmed появляется как true у старых состояний ----

/* Состояния версии 3 и старше вопроса «верна ли дата старта цикла» никогда не
   видели. Раз человек уже какое-то время жил с этой датой, подставлять ему
   false и включать баннер первого запуска было бы неправдой — подставляется
   true. Состояние уже текущей версии, где поле явно записано false, обязано
   сохранить именно false: миграция смотрит на версию ДО себя, а не гадает. */
function migrationV3ToV4Checks(): void {
  const v3 = {
    version: 3,
    settings: { cycleStartDate: '2026-08-20', cycleShift: 0, targetKcal: 3200, targetProteinG: 120, shortcutName: '' },
    log: {},
    preferences: { ingredients: {}, dishes: {} }
  }

  const migrated = deserialize(JSON.stringify(v3)).state
  assert(migrated.version === CURRENT_VERSION, `версия после миграции ожидалась ${CURRENT_VERSION}, получено ${migrated.version}`)
  assert(migrated.settings.cycleStartConfirmed === true,
    `у состояния версии 3 cycleStartConfirmed обязан стать true, получено ${migrated.settings.cycleStartConfirmed}`)
  group('deserialize: миграция v3 -> v4 ставит cycleStartConfirmed = true (вопрос никогда не задавался)')

  const freshFalse = {
    version: CURRENT_VERSION,
    settings: {
      cycleStartDate: '2026-08-20', cycleShift: 0, targetKcal: 3200, targetProteinG: 120,
      shortcutName: '', cycleStartConfirmed: false
    },
    log: {},
    preferences: { ingredients: {}, dishes: {} }
  }
  const stillFalse = deserialize(JSON.stringify(freshFalse)).state
  assert(stillFalse.settings.cycleStartConfirmed === false,
    'состояние уже текущей версии с явным false обязано остаться false, а не подняться до true')
  group('deserialize: состояние текущей версии с явным cycleStartConfirmed = false его не теряет')
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

  const result = deserialize(JSON.stringify(raw)).state
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

  const result = deserialize(JSON.stringify(raw)).state
  assert(!('blyudo-nol' in result.preferences.dishes), 'score === 0 недопустим (нуля-оценки не существует)')
  assert(!('blyudo-odinnadtsat' in result.preferences.dishes), 'score === 11 выходит за пределы 1..10')
  assert(!('blyudo-drob' in result.preferences.dishes), 'дробный score недопустим')
  assert(!('blyudo-stroka' in result.preferences.dishes), 'score строкой недопустим')
  assert(result.preferences.dishes['blyudo-validnoe']?.score === 8, 'валидная запись сохраняется')
  assert(Object.keys(result.preferences.dishes).length === 1, `ожидалась ровно 1 валидная запись, получено ${JSON.stringify(result.preferences.dishes)}`)

  group('preferences.dishes: балл вне 1..10, дробный или нечисловой роняет только эту запись')
}

// ---- запись без снапшота нутриента входит в сумму неизвестной позицией -------

/* Главная находка аудита: запись, у которой снапшота нутриента нет (сделана
   сборкой, знавшей 29 ключей из 40, или не знавшей их вовсе), считалась «нулём
   позиций». Сумма дня тогда сходилась сама с собой — known === total, — и
   экран печатал полное на вид число, хотя целый приём в него не вошёл. */

/** Снапшот, в котором известны первые `keyCount` ключей по одной позиции; про
    остальные ключи запись не знает вовсе — их в снапшоте НЕТ. */
function snapshotOfFirstKeys(keyCount: number): Record<string, { value: number; known: number; total: number }> {
  const snapshot: Record<string, { value: number; known: number; total: number }> = {}
  for (const key of NUTRIENT_KEYS.slice(0, keyCount)) {
    snapshot[key] = { value: 1, known: 1, total: 1 }
  }
  return snapshot
}

function storedEntry(slot: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slot,
    mealId: `${slot}-blyudo`,
    status: 'eaten',
    fraction: 1,
    kbju: { kcal: 500, p: 25, f: 15, c: 50 },
    title: `Приём ${slot}`,
    loggedAt: '2026-08-20T08:00:00',
    ...extra
  }
}

function storedState(log: Record<string, unknown>): string {
  return JSON.stringify({
    version: CURRENT_VERSION,
    settings: {
      cycleStartDate: '2026-08-01', cycleShift: 0, targetKcal: 3200, targetProteinG: 120,
      shortcutName: '', cycleStartConfirmed: true
    },
    log,
    preferences: { ingredients: {}, dishes: {} }
  })
}

function nutrientGapMakesDayIncompleteChecks(): void {
  // (а) старая запись без nutrients + свежая полная запись
  const mixed = deserialize(storedState({
    '2026-08-20': {
      cycleDay: 1,
      meals: {
        breakfast: storedEntry('breakfast'), // поля nutrients нет вовсе
        lunch: storedEntry('lunch', { nutrients: snapshotOfFirstKeys(NUTRIENT_KEYS.length) })
      }
    }
  })).state

  const day = mixed.log['2026-08-20']
  assert(!!day && Object.keys(day.meals).length === 2, 'обе записи обязаны пережить санитизацию')

  const totals: NutrientTotals = dayNutrientTotals(day)
  assert(NUTRIENT_KEYS.every(k => totals[k].known === 1 && totals[k].total === 2),
    `день из старой и свежей записи ожидал полноту 1/2 по каждому ключу, получено ${JSON.stringify(totals.calcium)}`)
  assert(NUTRIENT_KEYS.every(k => totals[k].known < totals[k].total), 'known обязан быть меньше total по каждому ключу')
  assert(NUTRIENT_KEYS.every(k => !isComplete(totals[k])),
    'день, в который целый приём вошёл без снапшота, НЕ может считаться полным ни по одному нутриенту')
  group('sanitizeNutrients: запись без снапшота делает сумму дня неполной по каждому ключу (known < total)')

  // (б) снапшот старого формата — 29 ключей из 40 — плюс свежая полная запись
  const partial = deserialize(storedState({
    '2026-08-21': {
      cycleDay: 2,
      meals: {
        breakfast: storedEntry('breakfast', { nutrients: snapshotOfFirstKeys(29) }),
        lunch: storedEntry('lunch', { nutrients: snapshotOfFirstKeys(NUTRIENT_KEYS.length) })
      }
    }
  })).state

  const partialTotals = dayNutrientTotals(partial.log['2026-08-21'])
  const knownByBoth = NUTRIENT_KEYS.slice(0, 29)
  const knownByFreshOnly = NUTRIENT_KEYS.slice(29)
  assert(knownByBoth.every(k => partialTotals[k].known === 2 && partialTotals[k].total === 2),
    `ключи, известные обеим записям, ожидали полноту 2/2, получено ${JSON.stringify(partialTotals[knownByBoth[0]])}`)
  assert(knownByFreshOnly.length === NUTRIENT_KEYS.length - 29, 'контроль: новых ключей ровно 11')
  assert(knownByFreshOnly.every(k => partialTotals[k].known === 1 && partialTotals[k].total === 2),
    `у новых ключей total обязан быть «известные позиции + 1», получено ${JSON.stringify(partialTotals[knownByFreshOnly[0]])}`)
  group('sanitizeNutrients: снапшот на 29 ключей — у 11 новых ключей total = известные позиции + 1')

  // (в) контроль: день из одной старой записи — ноль известных при одной позиции
  const onlyOld = deserialize(storedState({
    '2026-08-22': { cycleDay: 3, meals: { breakfast: storedEntry('breakfast') } }
  })).state

  const oldTotals = dayNutrientTotals(onlyOld.log['2026-08-22'])
  assert(NUTRIENT_KEYS.every(k => oldTotals[k].known === 0 && oldTotals[k].total === 1),
    `день из одной старой записи ожидал known 0 при total 1, получено ${JSON.stringify(oldTotals.calcium)}`)
  assert(NUTRIENT_KEYS.every(k => !isComplete(oldTotals[k])), 'день без единого снапшота не может быть полным')
  group('sanitizeNutrients: день из одной старой записи — known 0, total 1 (не «ноль позиций»)')
}

// ---- повреждённый ключ снапшота ведёт себя как отсутствующий -----------------

function corruptNutrientKeyChecks(): void {
  const state = deserialize(storedState({
    '2026-08-23': {
      cycleDay: 4,
      meals: {
        breakfast: storedEntry('breakfast', {
          nutrients: {
            fiber: { value: 10, known: 1, total: 1 },
            calcium: { value: '200', known: 1, total: 1 },       // значение строкой
            iron: { value: -5, known: 1, total: 1 },              // отрицательное значение
            vitC: { value: 1, known: 3, total: 2 },               // известных больше, чем всех
            vitD: { value: Number.POSITIVE_INFINITY, known: 1, total: 1 }, // JSON.stringify даст null
            zinc: 42                                             // вообще не объект
          }
        })
      }
    }
  })).state

  const entry = state.log['2026-08-23'].meals.breakfast!
  assert(entry.nutrients.fiber.value === 10 && entry.nutrients.fiber.known === 1 && entry.nutrients.fiber.total === 1,
    `целый ключ обязан сохраниться дословно, получено ${JSON.stringify(entry.nutrients.fiber)}`)
  for (const key of ['calcium', 'iron', 'vitC', 'vitD', 'zinc'] as const) {
    assert(entry.nutrients[key].known === 0 && entry.nutrients[key].total === 1 && entry.nutrients[key].value === 0,
      `повреждённый ключ «${key}» обязан стать неизвестной позицией (0, 0, 1), получено ${JSON.stringify(entry.nutrients[key])}`)
  }
  group('sanitizeNutrients: повреждённый ключ становится неизвестной позицией, соседние ключи и вся запись выживают')
}

// ---- слот вне SLOTS и доля вне (0, 1) роняют запись и считаются --------------

function droppedEntriesChecks(): void {
  const result = deserialize(storedState({
    '2026-08-24': {
      cycleDay: 5,
      meals: {
        breakfast: storedEntry('breakfast'),
        brunch: storedEntry('brunch', { kbju: { kcal: 900, p: 40, f: 30, c: 80 } }), // слота нет в SLOTS
        lunch: storedEntry('lunch', { status: 'partial', fraction: 3, kbju: { kcal: 800, p: 40, f: 20, c: 90 } }),
        dinner: storedEntry('dinner', { status: 'partial', fraction: 0, kbju: { kcal: 700, p: 35, f: 25, c: 70 } }),
        snack: storedEntry('snack', { kbju: { kcal: 300, p: 10, f: 10, c: 40 } })
      }
    }
  }))

  const day = result.state.log['2026-08-24']
  assert(!!day, 'день с двумя целыми записями обязан выжить')
  assert(!('brunch' in day.meals), 'слот вне SLOTS не имеет права остаться в дневнике')
  assert(day.meals.lunch === undefined, 'запись «съел часть» с долей 3 отбрасывается, а не зажимается до 1')
  assert(day.meals.dinner === undefined, 'запись «съел часть» с долей 0 отбрасывается: доля 0 — это не «часть»')
  assert(day.meals.breakfast?.kbju.kcal === 500 && day.meals.snack?.kbju.kcal === 300,
    'валидные соседи битых записей обязаны выжить целиком')
  assert(result.dropped === 3, `отброшенных записей ожидалось 3 (brunch, доля 3, доля 0), получено ${result.dropped}`)

  const total = dayTotal(day)
  assert(total.kcal === 800, `в сумму дня обязаны войти только уцелевшие записи (500 + 300 = 800), получено ${total.kcal}`)
  group('sanitizeMealEntry: слот вне SLOTS и доля вне (0, 1) отбрасываются и считаются, соседи выживают')
}

// ---- доля выводится из статуса, а не берётся из хранилища --------------------

function fractionFromStatusChecks(): void {
  const state = deserialize(storedState({
    '2026-08-25': {
      cycleDay: 6,
      meals: {
        breakfast: storedEntry('breakfast', { status: 'eaten', fraction: 0.25 }),
        lunch: storedEntry('lunch', { status: 'skipped', fraction: 1 }),
        dinner: storedEntry('dinner', { status: 'partial', fraction: 0.5 })
      }
    }
  })).state

  const meals = state.log['2026-08-25'].meals
  assert(meals.breakfast?.fraction === 1, `«съел» обязан дать долю 1 независимо от поля, получено ${meals.breakfast?.fraction}`)
  assert(meals.lunch?.fraction === 0, `«пропустил» обязан дать долю 0 независимо от поля, получено ${meals.lunch?.fraction}`)
  assert(meals.dinner?.fraction === 0.5, `«съел часть» сохраняет свою долю, получено ${meals.dinner?.fraction}`)
  group('sanitizeMealEntry: доля выводится из статуса (eaten -> 1, skipped -> 0), «часть» сохраняет своё число')
}

// ---- битый cycleDay больше не уносит день целиком ---------------------------

function brokenCycleDayKeepsDayChecks(): void {
  const result = deserialize(storedState({
    '2026-08-26': { cycleDay: 'третий', meals: { breakfast: storedEntry('breakfast') } },
    '2026-08-27': { cycleDay: 2.5, meals: { lunch: storedEntry('lunch') } },
    '2026-08-28': { meals: { dinner: storedEntry('dinner') } }
  }))

  for (const date of ['2026-08-26', '2026-08-27', '2026-08-28']) {
    const day = result.state.log[date]
    assert(!!day, `день ${date} обязан пережить битый номер дня цикла — записи о еде важнее подписи`)
    assert(day.cycleDay === null, `битый cycleDay обязан стать null, получено ${JSON.stringify(day.cycleDay)}`)
    assert(Object.keys(day.meals).length === 1, `запись приёма за ${date} обязана сохраниться`)
  }
  assert(result.dropped === 0, `битый номер дня — не потерянная запись, dropped ожидался 0, получено ${result.dropped}`)
  group('sanitizeDayLog: невалидный cycleDay даёт null и НЕ уносит записи дня')
}

// ---- день, из которого выпали все записи, исчезает вместе с ключом ----------

function emptyDayDropsChecks(): void {
  const result = deserialize(storedState({
    '2026-08-29': { cycleDay: 7, meals: { brunch: storedEntry('brunch') } },
    '2026-08-30': { cycleDay: 8, meals: {} },
    '2026-08-31': { cycleDay: 9, meals: { snack: storedEntry('snack') } }
  }))

  assert(!('2026-08-29' in result.state.log), 'день, у которого не осталось ни одной записи, — день БЕЗ записей, ключа быть не должно')
  assert(!('2026-08-30' in result.state.log), 'день с пустым meals не хранится: он не «день с нулём»')
  assert('2026-08-31' in result.state.log, 'день с уцелевшей записью остаётся')
  assert(result.dropped === 1, `отброшенных записей ожидалась 1 (brunch), получено ${result.dropped}`)
  group('sanitizeDayLog: день без уцелевших записей выпадает из дневника целиком')
}

// ---- нечитаемое хранилище: копия текста и разрешённое автосохранение --------

function corruptStorageChecks(): void {
  const broken = '{"version":4,"log":{"2026-08-20":{"cycleDay":1,"meals":{"breakfast":{"slot":"break'

  const direct = deserialize(broken)
  assert(direct.source === 'corrupt', `source нечитаемого текста ожидался 'corrupt', получено '${direct.source}'`)
  assert(direct.state.version === CURRENT_VERSION, 'при нечитаемом хранилище возвращается дефолт текущей версии')
  assert(direct.dropped === 0, 'разбирать было нечего — отброшенных записей нет')
  group('deserialize: текст, который не разбирается как JSON, даёт source «corrupt»')

  withFakeStorage(storage => {
    storage.setItem(STORAGE_KEY, broken)
    const loaded = loadState()
    assert(loaded.source === 'corrupt', `loadState тоже обязан отдать 'corrupt', получено '${loaded.source}'`)
    assert(storage.getItem(BACKUP_KEY) === broken,
      `под ключом копии обязан лежать исходный текст дословно, получено ${JSON.stringify(storage.getItem(BACKUP_KEY))}`)
    assert(storage.getItem(STORAGE_KEY) === broken, 'сама loadState основной ключ не переписывает — это дело автосохранения')

    // копия отложена, значит запись поверх допустима (в отличие от newer-version)
    const saved = saveState(loaded.state)
    assert(saved.ok, 'после corrupt сохранять разрешено — терять нечего, копия лежит')
    assert(storage.getItem(BACKUP_KEY) === broken, 'автосохранение не трогает копию нечитаемого текста')
    group('loadState: нечитаемое хранилище копируется под BACKUP_KEY дословно, запись поверх разрешена')
  })

  withFakeStorage(storage => {
    storage.setItem(STORAGE_KEY, '[]')
    const loaded = loadState()
    assert(loaded.source === 'default', `валидный JSON, но не объект, остаётся 'default', получено '${loaded.source}'`)
    assert(storage.getItem(BACKUP_KEY) === null, 'копия делается только с текста, который не разобрался: в «[]» дневника нет по устройству')
    group('loadState: валидный JSON-не-объект остаётся «default» и копии не порождает')
  })
}

// ---- отброшенные записи: копия текста тоже откладывается, source остаётся 'stored' ----

/* До первого автосохранения текст с отброшенными записями ещё цел на диске —
   после него уже нет (автосохранение перезапишет STORAGE_KEY уже почищенным
   состоянием). Копия под BACKUP_KEY — единственный способ разобрать, что
   именно было потеряно, поэтому loadState обязана отложить её так же, как
   при 'corrupt', хотя источник здесь остаётся 'stored': состояние читается и
   авторитетно, потеряна только часть записей. */
function droppedBacksUpTextChecks(): void {
  const text = storedState({
    '2026-09-02': {
      cycleDay: 1,
      meals: {
        breakfast: storedEntry('breakfast'),
        brunch: storedEntry('brunch') // слота нет в SLOTS — будет отброшена
      }
    }
  })

  withFakeStorage(storage => {
    storage.setItem(STORAGE_KEY, text)
    const loaded = loadState()
    assert(loaded.source === 'stored', `dropped > 0 не меняет source, ожидался 'stored', получено '${loaded.source}'`)
    assert(loaded.dropped === 1, `отброшенных записей ожидалась 1, получено ${loaded.dropped}`)
    assert(storage.getItem(BACKUP_KEY) === text,
      `при dropped > 0 под ключом копии обязан лежать исходный текст дословно, получено ${JSON.stringify(storage.getItem(BACKUP_KEY))}`)
    group('loadState: dropped > 0 откладывает копию текста под BACKUP_KEY, source остаётся «stored»')
  })

  withFakeStorage(storage => {
    // контроль: без потерь копии быть не должно вовсе
    storage.setItem(STORAGE_KEY, storedState({
      '2026-09-03': { cycleDay: 2, meals: { breakfast: storedEntry('breakfast') } }
    }))
    const loaded = loadState()
    assert(loaded.dropped === 0, 'контроль: запись без потерь не должна ничего отбрасывать')
    assert(storage.getItem(BACKUP_KEY) === null, 'без потерь копия текста не создаётся')
    group('loadState: dropped === 0 копию текста не создаёт')
  })
}

// ---- ревизия справочника переживает загрузку -------------------------------

function productsRevisionChecks(): void {
  const state = deserialize(storedState({
    '2026-09-01': {
      cycleDay: 1,
      meals: {
        breakfast: storedEntry('breakfast', { productsRevision: '2026-08-17' }),
        lunch: storedEntry('lunch'),
        dinner: storedEntry('dinner', { productsRevision: 42 })
      }
    }
  })).state

  const meals = state.log['2026-09-01'].meals
  assert(meals.breakfast?.productsRevision === '2026-08-17', `ревизия обязана сохраниться дословно, получено ${meals.breakfast?.productsRevision}`)
  assert(meals.lunch !== undefined && !('productsRevision' in meals.lunch), 'у записи без ревизии поле не появляется')
  assert(meals.dinner !== undefined && !('productsRevision' in meals.dinner), 'нестроковая ревизия выбрасывается, а не подставляется числом')
  group('sanitizeMealEntry: ревизия справочника переносится строкой, отсутствующая не выдумывается')
}

function main(): void {
  console.log('storage — хранилище состояния: дефолт, round-trip, мусор, миграция, loadState/saveState')
  defaultStateChecks()
  roundTripChecks()
  garbageChecks()
  newerVersionChecks()
  loadSaveRoundTripChecks()
  migrationPreservesLogChecks()
  migrationV1ToV2Checks()
  migrationV2ToV3Checks()
  migrationV3ToV4Checks()
  ingredientsGarbageChecks()
  dishesGarbageChecks()
  nutrientGapMakesDayIncompleteChecks()
  corruptNutrientKeyChecks()
  droppedEntriesChecks()
  fractionFromStatusChecks()
  brokenCycleDayKeepsDayChecks()
  emptyDayDropsChecks()
  corruptStorageChecks()
  droppedBacksUpTextChecks()
  productsRevisionChecks()
  console.log(`\nВсе проверки storage пройдены (${passed} групп).`)
}

try {
  main()
} catch (e) {
  console.error('\n✗ ТЕСТ STORAGE УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}
