/* Загрузка и сохранение AppState в localStorage.
   Чистые функции (defaultState/serialize/deserialize) не трогают браузер и
   тестируются напрямую. loadState/saveState — тонкие обёртки поверх них,
   единственные, кто знает про localStorage.

   Правило deserialize: НИКОГДА не бросать исключение наружу. Человек стоит
   с телефоном у стола — уронить приложение из-за кривого JSON хуже, чем
   потерять одну запись дневника. Что чинится молча, а что откатывается к
   дефолту — см. комментарии внутри deserialize. */

import { NUTRIENT_KEYS } from '../core/types.ts'
import type { AppState, DayLog, MealLogEntry, NutrientTotals, Preferences, Settings } from '../core/types.ts'
import { todayLocal } from '../core/cycle.ts'
import { emptyNutrientTotals } from '../core/nutrition.ts'

/** Ключ localStorage — единственное место, где он назван. */
export const STORAGE_KEY = 'eda.state.v1'

/** Текущая версия формата AppState. Меняется только вместе с миграцией ниже.
    v1 -> v2: у записи приёма появился снапшот нутриентов (MealLogEntry.nutrients).
    v2 -> v3: появилась книга предпочтений (AppState.preferences) и снапшот
    идентификатора блюда в записи дневника (MealLogEntry.mealId). У записей
    версии 2 идентификатора не было — они получают пустую строку (см.
    комментарий к MealLogEntry.mealId в types.ts): по названию блюдо не
    восстанавливается, совпадение названий не есть тождество блюд.
    Ключ localStorage при этом НЕ меняется: он адресует хранилище, а не формат,
    и его смена означала бы потерю уже записанных дней. */
export const CURRENT_VERSION = 3

/** Дефолтные настройки, пустой дневник и пустая книга предпочтений — то, с чем
    открывается приложение в первый раз или после потери состояния. */
export function defaultState(): AppState {
  const settings: Settings = {
    cycleStartDate: todayLocal(new Date()),
    cycleShift: 0,
    targetKcal: 3200,
    targetProteinG: 120,
    shortcutName: ''
  }
  return {
    version: CURRENT_VERSION,
    settings,
    log: {},
    preferences: { ingredients: {}, dishes: {} }
  }
}

export function serialize(state: AppState): string {
  return JSON.stringify(state)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isSlotStatus(v: unknown): v is 'eaten' | 'partial' | 'skipped' {
  return v === 'eaten' || v === 'partial' || v === 'skipped'
}

function isKbju(v: unknown): boolean {
  if (!isPlainObject(v)) return false
  return typeof v.kcal === 'number' && typeof v.p === 'number' && typeof v.f === 'number' && typeof v.c === 'number'
}

/** Проверяет и чинит снапшот нутриентов записи. Запись версии 1 нутриентов не
    содержит вовсе — она получает пустую сумму: known === 0 по всем ключам, то
    есть честное «нет данных». Подставлять нули как значения нельзя: прошлое
    выглядело бы посчитанным, не будучи им. Так же трактуется и повреждённый
    ключ — отдельный нутриент вырождается в «нет данных», вся запись выживает. */
function sanitizeNutrients(v: unknown): NutrientTotals {
  if (!isPlainObject(v)) return emptyNutrientTotals()
  const totals = {} as NutrientTotals
  for (const key of NUTRIENT_KEYS) {
    const raw = v[key]
    if (isPlainObject(raw) && typeof raw.value === 'number' && typeof raw.known === 'number' && typeof raw.total === 'number') {
      totals[key] = { value: raw.value, known: raw.known, total: raw.total }
    } else {
      totals[key] = { value: 0, known: 0, total: 0 }
    }
  }
  return totals
}

/** Проверяет и чинит одну запись MealLogEntry. Возвращает null, если запись
    настолько повреждена, что её нельзя восстановить (в этом случае приём
    просто выпадает из дневника — остальной день сохраняется). */
function sanitizeMealEntry(v: unknown): MealLogEntry | null {
  if (!isPlainObject(v)) return null
  const slot = v.slot
  if (typeof slot !== 'string') return null
  if (!isSlotStatus(v.status)) return null
  if (typeof v.fraction !== 'number') return null
  if (!isKbju(v.kbju)) return null
  if (typeof v.title !== 'string') return null
  if (typeof v.loggedAt !== 'string') return null
  return {
    slot: slot as never,
    // запись версии 2 и старше mealId не несёт — пустая строка значит
    // «нельзя привязать к блюду», см. комментарий MealLogEntry.mealId.
    mealId: typeof v.mealId === 'string' ? v.mealId : '',
    status: v.status,
    fraction: v.fraction,
    kbju: v.kbju as { kcal: number; p: number; f: number; c: number },
    nutrients: sanitizeNutrients(v.nutrients),
    title: v.title,
    loggedAt: v.loggedAt
  }
}

/** Проверяет и чинит один DayLog: битые/чужеродные приёмы внутри дня молча
    отбрасываются, сам день сохраняется, если у него есть валидный cycleDay. */
function sanitizeDayLog(v: unknown): DayLog | null {
  if (!isPlainObject(v)) return null
  if (typeof v.cycleDay !== 'number') return null
  const rawMeals = isPlainObject(v.meals) ? v.meals : {}
  const meals: DayLog['meals'] = {}
  for (const [slotKey, entryRaw] of Object.entries(rawMeals)) {
    const entry = sanitizeMealEntry(entryRaw)
    if (entry && entry.slot === slotKey) {
      meals[entry.slot] = entry
    }
  }
  return { cycleDay: v.cycleDay, meals }
}

/** Проверяет и чинит весь log: сутки, которые нельзя восстановить, молча
    выпадают, остальные сохраняются. Так миграция и починка мусора не теряют
    весь дневник целиком из-за одной побитой даты. */
function sanitizeLog(v: unknown): AppState['log'] {
  if (!isPlainObject(v)) return {}
  const result: AppState['log'] = {}
  for (const [date, dayRaw] of Object.entries(v)) {
    const day = sanitizeDayLog(dayRaw)
    if (day) result[date] = day
  }
  return result
}

/** Проверяет и чинит Settings: отсутствующее или неверного типа поле молча
    заменяется дефолтным значением — настройки не стоит терять целиком
    из-за одного кривого поля. */
function sanitizeSettings(v: unknown): Settings {
  const def = defaultState().settings
  if (!isPlainObject(v)) return def
  return {
    cycleStartDate: typeof v.cycleStartDate === 'string' && v.cycleStartDate ? v.cycleStartDate : def.cycleStartDate,
    cycleShift: typeof v.cycleShift === 'number' ? v.cycleShift : def.cycleShift,
    targetKcal: typeof v.targetKcal === 'number' ? v.targetKcal : def.targetKcal,
    targetProteinG: typeof v.targetProteinG === 'number' ? v.targetProteinG : def.targetProteinG,
    shortcutName: typeof v.shortcutName === 'string' ? v.shortcutName : def.shortcutName
  }
}

/** Проверяет и чинит книгу предпочтений. Запись, которую нельзя доверять
    целиком, выпадает вместе с ключом — она не чинится подстановкой:
    - ingredients принимает только значения 'love' и 'avoid', любой другой
      мусор (в том числе прежнее третье значение) выбрасывается вместе с ключом;
    - dishes принимает запись, только если score — целое 1..10, comment —
      строка, ratedAt — строка; иначе вся запись выпадает.
    Состояние версии 2 и старше preferences не несёт вовсе — sanitizePreferences
    на входе undefined отдаёт пустую книгу, ровно как defaultState(). */
function sanitizePreferences(v: unknown): Preferences {
  const ingredientsRaw = isPlainObject(v) && isPlainObject(v.ingredients) ? v.ingredients : {}
  const ingredients: Preferences['ingredients'] = {}
  for (const [key, stance] of Object.entries(ingredientsRaw)) {
    if (stance === 'love' || stance === 'avoid') ingredients[key] = stance
  }

  const dishesRaw = isPlainObject(v) && isPlainObject(v.dishes) ? v.dishes : {}
  const dishes: Preferences['dishes'] = {}
  for (const [key, ratingRaw] of Object.entries(dishesRaw)) {
    if (!isPlainObject(ratingRaw)) continue
    const score = ratingRaw.score
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 10) continue
    if (typeof ratingRaw.comment !== 'string') continue
    if (typeof ratingRaw.ratedAt !== 'string') continue
    dishes[key] = { score, comment: ratingRaw.comment, ratedAt: ratingRaw.ratedAt }
  }

  return { ingredients, dishes }
}

/** Миграция состояния произвольной старой версии к CURRENT_VERSION.
    Все шаги «vN -> vN+1» на сегодня выражаются через sanitize*-функции: они
    достраивают недостающие поля (v1 -> v2 — снапшот нутриентов, v2 -> v3 —
    книга предпочтений и mealId записи) и чинят битые, не теряя уже записанных
    дней. Появится шаг, который так не выражается, — он встаёт сюда явной
    цепочкой до вызова sanitize*. */
function migrate(raw: Record<string, unknown>): AppState {
  return {
    version: CURRENT_VERSION,
    settings: sanitizeSettings(raw.settings),
    log: sanitizeLog(raw.log),
    preferences: sanitizePreferences(raw.preferences)
  }
}

/** Разбирает сохранённый текст в валидный AppState. Никогда не бросает:
    - text === null/пустая строка/невалидный JSON -> дефолт (нечего чинить);
    - JSON не объект (массив, число, строка, null) -> дефолт;
    - version отсутствует или ниже текущей -> миграция (чинит поля молча);
    - version выше текущей (открыли старую сборку на новом состоянии) ->
      дефолт, ключ localStorage при этом НЕ трогаем (это забота saveState),
      чтобы будущая сборка, знающая эту версию, не потеряла данные. */
export function deserialize(text: string | null): AppState {
  if (!text) return defaultState()

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return defaultState()
  }

  if (!isPlainObject(parsed)) return defaultState()

  const version = typeof parsed.version === 'number' ? parsed.version : 0
  if (version > CURRENT_VERSION) return defaultState()

  return migrate(parsed)
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** Читает состояние из localStorage. Недоступность хранилища (приватный
    режим Safari, отключённые куки) тоже не должна ронять приложение. */
export function loadState(): AppState {
  const storage = getLocalStorage()
  if (!storage) return defaultState()
  let text: string | null
  try {
    text = storage.getItem(STORAGE_KEY)
  } catch {
    text = null
  }
  return deserialize(text)
}

/** Итог сохранения. Провал возвращается наружу, а не глотается: не сохранённая
    запись означает, что дневник разойдётся с тем, что человек видит на экране,
    и он обязан об этом узнать. Экран при этом падать не должен — отсюда результат,
    а не исключение. */
export type SaveResult = { ok: true } | { ok: false; error: string }

/** Причины отказа, которые реально случаются: переполнена квота (годы записей),
    приватный режим Safari, отключённые данные сайта. */
export function saveState(state: AppState): SaveResult {
  const storage = getLocalStorage()
  if (!storage) {
    return { ok: false, error: 'Хранилище браузера недоступно — записи не сохраняются.' }
  }
  try {
    storage.setItem(STORAGE_KEY, serialize(state))
    return { ok: true }
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    const quota = name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
    return {
      ok: false,
      error: quota
        ? 'Хранилище браузера переполнено — запись не сохранена. Выгрузите день кнопкой «выгрузить день» и очистите дневник в настройках.'
        : 'Не удалось сохранить запись в хранилище браузера.'
    }
  }
}
