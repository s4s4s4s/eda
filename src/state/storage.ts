/* Загрузка и сохранение AppState в localStorage.
   Чистые функции (defaultState/serialize/deserialize) не трогают браузер и
   тестируются напрямую. loadState/saveState — тонкие обёртки поверх них,
   единственные, кто знает про localStorage.

   Правило deserialize: НИКОГДА не бросать исключение наружу. Человек стоит
   с телефоном у стола — уронить приложение из-за кривого JSON хуже, чем
   потерять одну запись дневника. Что чинится молча, а что откатывается к
   дефолту — см. комментарии внутри deserialize. */

import { NUTRIENT_KEYS, SLOTS } from '../core/types.ts'
import type { AppState, DayLog, MealLogEntry, MealStatus, NutrientTotal, NutrientTotals, Preferences, Settings, Slot } from '../core/types.ts'
import { todayLocal } from '../core/cycle.ts'

/** Ключ localStorage — единственное место, где он назван. */
export const STORAGE_KEY = 'eda.state.v1'

/** Куда loadState кладёт дословную копию последнего текста хранилища, при
    чтении которого что-то потерялось: он не разобрался целиком (source
    'corrupt') либо разобрался, но часть записей не пережила санитизацию
    (dropped > 0). Отдельный ключ, а не перезапись основного: разбирать
    потерю можно только по исходному тексту, а не по уже почищенному
    состоянию, где потерянное уже не найти. */
export const BACKUP_KEY = STORAGE_KEY + '.backup'

/** Текущая версия формата AppState. Меняется только вместе с миграцией ниже.
    v1 -> v2: у записи приёма появился снапшот нутриентов (MealLogEntry.nutrients).
    v2 -> v3: появилась книга предпочтений (AppState.preferences) и снапшот
    идентификатора блюда в записи дневника (MealLogEntry.mealId). У записей
    версии 2 идентификатора не было — они получают пустую строку (см.
    комментарий к MealLogEntry.mealId в types.ts): по названию блюдо не
    восстанавливается, совпадение названий не есть тождество блюд.
    v3 -> v4: у Settings появился cycleStartConfirmed — человек ещё не
    подтвердил, что дата первого дня цикла верна. У состояний версии 3 и
    старше этот вопрос никогда не задавался, а дата на экране уже какое-то
    время как настоящая: они получают true, а не false, — иначе баннер
    «сегодня — день 1» появился бы человеку, который цикл давно ведёт.
    Ключ localStorage при этом НЕ меняется: он адресует хранилище, а не формат,
    и его смена означала бы потерю уже записанных дней. */
export const CURRENT_VERSION = 4

/** Дефолтные настройки, пустой дневник и пустая книга предпочтений — то, с чем
    открывается приложение в первый раз или после потери состояния. */
export function defaultState(): AppState {
  const settings: Settings = {
    cycleStartDate: todayLocal(new Date()),
    cycleShift: 0,
    targetKcal: 3200,
    targetProteinG: 120,
    shortcutName: '',
    // первый запуск — вопрос ещё не задан, баннер на главном экране спросит.
    cycleStartConfirmed: false
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

/** Снапшота по этому нутриенту у записи НЕТ — но сам приём был съеден и в сумму
    дня входит. Поэтому запись входит одной НЕИЗВЕСТНОЙ позицией: known 0 при
    total 1 (семантика описана у NutrientTotal.total в types.ts).

    Ноль позиций (`total: 0`) здесь был бы враньём — тем самым, из-за которого
    день без целого приёма печатался как полный: addNutrientTotals складывает
    total, при нулевом слагаемом известность дня остаётся known === total, и
    isComplete говорит «сумма собрана по всем позициям», хотя целый приём в неё
    не вошёл. Одна неизвестная позиция ломает это равенство и делает сумму тем,
    чем она есть, — нижней границей. */
const UNKNOWN_POSITION: NutrientTotal = { value: 0, known: 0, total: 1 }

/** Ключа нет в формате записи: запись сделана сборкой, которая этого нутриента
    ещё не знала (записи до появления оставшихся ключей знают 29 из 40), либо
    нутриентов у неё нет вовсе (версия 1 формата). */
function nutrientKeyAbsent(): NutrientTotal {
  return { ...UNKNOWN_POSITION }
}

/** Ключ есть, но его содержимому нельзя верить. Исход тот же, что у
    отсутствующего ключа, и это не совпадение: обе ветки означают ровно одно —
    «сколько этого нутриента было в приёме, приложение не знает». Разными их
    держит только причина, и она важна для чтения кода, а не для арифметики:
    первая — законная история формата, вторая — порча данных. */
function nutrientKeyCorrupt(): NutrientTotal {
  return { ...UNKNOWN_POSITION }
}

/** Тройка value/known/total осмысленна: числа конечные, счётчики целые и
    неотрицательные, известных позиций не больше, чем всех, значение не
    отрицательно (отрицательных нутриентов не бывает). */
function isValidNutrientTotal(raw: Record<string, unknown>): boolean {
  const { value, known, total } = raw
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false
  if (typeof known !== 'number' || !Number.isInteger(known) || known < 0) return false
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) return false
  return known <= total
}

/** Проверяет и чинит снапшот нутриентов записи. Отсутствующий и повреждённый
    ключ дают неизвестную позицию (см. UNKNOWN_POSITION): вся запись при этом
    выживает — портится полнота одного нутриента, а не дневник. */
function sanitizeNutrients(v: unknown): NutrientTotals {
  const totals = {} as NutrientTotals
  // карты нутриентов нет вовсе — запись версии 1 формата: все ключи отсутствуют
  const map = isPlainObject(v) ? v : {}
  for (const key of NUTRIENT_KEYS) {
    const raw = map[key]
    if (raw === undefined) {
      totals[key] = nutrientKeyAbsent()
    } else if (isPlainObject(raw) && isValidNutrientTotal(raw)) {
      totals[key] = { value: raw.value as number, known: raw.known as number, total: raw.total as number }
    } else {
      totals[key] = nutrientKeyCorrupt()
    }
  }
  return totals
}

function isSlot(v: unknown): v is Slot {
  return typeof v === 'string' && (SLOTS as readonly string[]).includes(v)
}

/** Доля съеденного ВЫВОДИТСЯ ИЗ СТАТУСА, а не берётся из хранилища. «Съел» —
    это ровно один приём, «пропустил» — ровно ноль, что бы ни лежало в поле
    fraction: доля тут не самостоятельные данные, а следствие статуса, и
    расхождение между ними означает порчу, а не второе мнение.
    Осмысленный выбор остаётся только у «съел часть»: строго между нулём и
    единицей. Число вне этого промежутка (fraction 3 превращало снапшот в 800
    ккал в 2400) не зажимается до границы — зажатое значение выдумано ровно так
    же, как исходное. Запись с такой долей возвращает null и отбрасывается. */
function resolveFraction(status: MealStatus, raw: unknown): number | null {
  if (status === 'eaten') return 1
  if (status === 'skipped') return 0
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return raw > 0 && raw < 1 ? raw : null
}

/** Проверяет и чинит одну запись MealLogEntry. Возвращает null, если запись
    настолько повреждена, что её нельзя восстановить (в этом случае приём
    просто выпадает из дневника — остальной день сохраняется, а сам факт потери
    считается, см. LoadResult.dropped).

    Слот проверяется на членство в SLOTS, а не на «это строка»: чужеродный слот
    («brunch») ни в один список на экране не попадает — SLOTS закрыт, — но
    калории его записи молча вошли бы в сумму дня. Невидимое слагаемое хуже
    потерянной записи. */
function sanitizeMealEntry(v: unknown): MealLogEntry | null {
  if (!isPlainObject(v)) return null
  const slot = v.slot
  if (!isSlot(slot)) return null
  if (!isSlotStatus(v.status)) return null
  const fraction = resolveFraction(v.status, v.fraction)
  if (fraction === null) return null
  if (!isKbju(v.kbju)) return null
  if (typeof v.title !== 'string') return null
  if (typeof v.loggedAt !== 'string') return null
  return {
    slot,
    // запись версии 2 и старше mealId не несёт — пустая строка значит
    // «нельзя привязать к блюду», см. комментарий MealLogEntry.mealId.
    mealId: typeof v.mealId === 'string' ? v.mealId : '',
    status: v.status,
    fraction,
    kbju: v.kbju as { kcal: number; p: number; f: number; c: number },
    nutrients: sanitizeNutrients(v.nutrients),
    title: v.title,
    loggedAt: v.loggedAt,
    // ревизия справочника переносится как есть и не выдумывается: её отсутствие
    // означает «по какому справочнику считан снапшот — неизвестно».
    ...(typeof v.productsRevision === 'string' ? { productsRevision: v.productsRevision } : {})
  }
}

/** Итог санитизации куска дневника: что уцелело и сколько записей приёмов не
    пережило проверку. Число потерь доходит до экрана (LoadResult.dropped) —
    молча потерянная запись означает, что дневник разошёлся с тем, что человек
    помнит про свой день, а он об этом не узнал. */
interface SanitizedDay {
  day: DayLog | null
  dropped: number
}

/** Проверяет и чинит один DayLog. Битые и чужеродные приёмы отбрасываются и
    считаются; день пропадает (null) только тогда, когда ни одной записи в нём
    не осталось: день с нулём приёмов — это день БЕЗ ЗАПИСЕЙ, а не день, в
    который ничего не съедено (см. summarizeDay в src/core/week.ts).

    Битый cycleDay день больше НЕ уносит: номер дня цикла — косметика (по нему
    подписывают «день 3»), а записи приёмов — данные о еде. Терять съеденное
    из-за испорченной подписи нельзя, поэтому неверный номер становится null
    (DayLog.cycleDay допускает его намеренно), а записи остаются. */
function sanitizeDayLog(v: unknown): SanitizedDay {
  if (!isPlainObject(v)) return { day: null, dropped: 0 }
  const cycleDay = typeof v.cycleDay === 'number' && Number.isInteger(v.cycleDay) ? v.cycleDay : null
  const rawMeals = isPlainObject(v.meals) ? v.meals : {}
  const meals: DayLog['meals'] = {}
  let dropped = 0
  for (const [slotKey, entryRaw] of Object.entries(rawMeals)) {
    const entry = sanitizeMealEntry(entryRaw)
    // запись под чужим ключом («lunch: {slot: dinner}») недостоверна целиком:
    // неизвестно, что из двух верно, а гадать — значит переставлять еду по дню.
    if (!entry || entry.slot !== slotKey) {
      dropped++
      continue
    }
    meals[entry.slot] = entry
  }
  if (Object.keys(meals).length === 0) return { day: null, dropped }
  return { day: { cycleDay, meals }, dropped }
}

interface SanitizedLog {
  log: AppState['log']
  dropped: number
}

/** Проверяет и чинит весь log: сутки, от которых ничего не осталось, выпадают,
    остальные сохраняются. Так миграция и починка мусора не теряют весь дневник
    целиком из-за одной побитой даты. */
function sanitizeLog(v: unknown): SanitizedLog {
  if (!isPlainObject(v)) return { log: {}, dropped: 0 }
  const log: AppState['log'] = {}
  let dropped = 0
  for (const [date, dayRaw] of Object.entries(v)) {
    const { day, dropped: dayDropped } = sanitizeDayLog(dayRaw)
    dropped += dayDropped
    if (day) log[date] = day
  }
  return { log, dropped }
}

/** Проверяет и чинит Settings: отсутствующее или неверного типа поле молча
    заменяется дефолтным значением — настройки не стоит терять целиком
    из-за одного кривого поля.

    `cycleStartConfirmed` — особый случай: значения нет у состояний версии 3
    и старше, потому что вопрос им никогда не задавался. Для них отсутствующее
    поле значит не «первый запуск», а «человек уже жил с этой датой» — им
    подставляется `legacyConfirmed` (true при миграции со старой версии),
    а не дефолтное `false`. */
function sanitizeSettings(v: unknown, legacyConfirmed: boolean): Settings {
  const def = defaultState().settings
  if (!isPlainObject(v)) return { ...def, cycleStartConfirmed: legacyConfirmed }
  return {
    cycleStartDate: typeof v.cycleStartDate === 'string' && v.cycleStartDate ? v.cycleStartDate : def.cycleStartDate,
    cycleShift: typeof v.cycleShift === 'number' ? v.cycleShift : def.cycleShift,
    targetKcal: typeof v.targetKcal === 'number' ? v.targetKcal : def.targetKcal,
    targetProteinG: typeof v.targetProteinG === 'number' ? v.targetProteinG : def.targetProteinG,
    shortcutName: typeof v.shortcutName === 'string' ? v.shortcutName : def.shortcutName,
    cycleStartConfirmed: typeof v.cycleStartConfirmed === 'boolean' ? v.cycleStartConfirmed : legacyConfirmed
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
    книга предпочтений и mealId записи, v3 -> v4 — cycleStartConfirmed) и
    чинят битые, не теряя уже записанных дней. Появится шаг, который так не
    выражается, — он встаёт сюда явной цепочкой до вызова sanitize*.
    `rawVersion` — версия ДО миграции: только по ней sanitizeSettings отличает
    «поле никогда не существовало» (состояние версии 3 и старше) от «поле
    было и потерялось» на состоянии уже текущей версии. */
function migrate(raw: Record<string, unknown>, rawVersion: number): { state: AppState; dropped: number } {
  const { log, dropped } = sanitizeLog(raw.log)
  const state: AppState = {
    version: CURRENT_VERSION,
    settings: sanitizeSettings(raw.settings, rawVersion < 4),
    log,
    preferences: sanitizePreferences(raw.preferences)
  }
  return { state, dropped }
}

/** Источник состояния, которое отдаёт loadState/deserialize:
    - 'stored' — прочитано и (при необходимости) мигрировано из хранилища;
    - 'default' — хранилище пусто, читать нечего, или содержимое битое
      настолько, что чинить нечего (не JSON, не объект и т.п.);
    - 'newer-version' — хранилище держит состояние версии выше CURRENT_VERSION
      (человек открыл старую сборку поверх данных новой). Это НЕ то же самое,
      что 'default': дефолт здесь возвращается только чтобы отрисовать экран,
      а не потому что данных нет. Вызывающий обязан считать это состояние
      неавторитетным (не сохранять!) — иначе дефолт молча затрёт то, что
      записала более новая сборка;
    - 'corrupt' — в хранилище лежит текст, который не разбирается как JSON
      (оборванная запись, чужая программа, битый профиль браузера). Дефолт
      здесь тоже возвращается только чтобы отрисовать экран, но, в отличие от
      'newer-version', автосохранение поверх ДОПУСТИМО: разбирать в хранилище
      нечего, а дословная копия исходного текста уже отложена под BACKUP_KEY
      (это делает loadState). Разница ровно в этом:
      'newer-version' — данные целы и понятны другой сборке, их нельзя трогать;
      'corrupt' — данные не читаются никем, и держать хранилище нерабочим,
      запрещая записывать новые дни, значит терять ещё и будущее. Источник
      'stored' с dropped > 0 подчиняется тому же правилу ДОПУСТИМОСТИ записи:
      часть записей потеряна, но остальное состояние читается и авторитетно. */
export type StateSource = 'stored' | 'default' | 'newer-version' | 'corrupt'

export interface LoadResult {
  state: AppState
  source: StateSource
  /** Сколько записей приёмов не пережило санитизацию: чужой слот, доля вне
      (0, 1) у «съел часть», непоправимо битая запись. Ноль у всех источников,
      кроме 'stored', — там, где ничего не разбиралось, нечего и терять. */
  dropped: number
}

/** Разбирает сохранённый текст в валидный AppState. Никогда не бросает:
    - text === null/пустая строка -> дефолт (читать нечего);
    - текст не разбирается как JSON -> дефолт с source 'corrupt'; копию текста
      откладывает вызывающий (loadState), потому что deserialize — чистая
      функция и о хранилище не знает;
    - JSON не объект (массив, число, строка, null) -> дефолт: сохранять тут
      нечего, дневника в таком значении нет по устройству;
    - version отсутствует или ниже текущей -> миграция (чинит поля молча);
    - version выше текущей (открыли старую сборку на новом состоянии) ->
      дефолт с source 'newer-version'. Ключ localStorage при этом НЕ трогаем
      (это забота вызывающего — см. App.tsx, автосохранение выключается
      целиком), чтобы будущая сборка, знающая эту версию, не потеряла данные. */
export function deserialize(text: string | null): LoadResult {
  if (!text) return { state: defaultState(), source: 'default', dropped: 0 }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { state: defaultState(), source: 'corrupt', dropped: 0 }
  }

  if (!isPlainObject(parsed)) return { state: defaultState(), source: 'default', dropped: 0 }

  const version = typeof parsed.version === 'number' ? parsed.version : 0
  if (version > CURRENT_VERSION) return { state: defaultState(), source: 'newer-version', dropped: 0 }

  const { state, dropped } = migrate(parsed, version)
  return { state, source: 'stored', dropped }
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** Читает состояние из localStorage. Недоступность хранилища (приватный
    режим Safari, отключённые куки) тоже не должна ронять приложение —
    трактуется как 'default', сохранять всё равно некуда. */
export function loadState(): LoadResult {
  const storage = getLocalStorage()
  if (!storage) return { state: defaultState(), source: 'default', dropped: 0 }
  let text: string | null
  try {
    text = storage.getItem(STORAGE_KEY)
  } catch {
    text = null
  }
  const result = deserialize(text)
  // копия нужна ровно тогда, когда что-то потерялось при чтении: текст не
  // разобрался целиком ('corrupt') либо разобрался, но часть записей не
  // пережила санитизацию (dropped > 0). До первого автосохранения текст с
  // отброшенными записями ещё цел на диске — после него уже нет.
  if (text !== null && (result.source === 'corrupt' || result.dropped > 0)) backupText(storage, text)
  return result
}

/** Откладывает дословную копию текста хранилища, при чтении которого что-то
    потерялось, под BACKUP_KEY — до того, как автосохранение запишет поверх
    уже почищенное состояние. Копия хранит ПОСЛЕДНИЙ такой текст: разбирать
    имеет смысл именно тот, который сломал загрузку сейчас.

    Провал самой копии проглатывается сознательно и это единственное такое
    место: канала сообщить о нём нет (loadState обязана вернуть состояние и не
    бросать), а падение здесь означало бы белый экран вместо работающего
    приложения на телефоне у стола. Хуже копии, которую не удалось сделать,
    только приложение, которое из-за этого не открылось. */
function backupText(storage: Storage, text: string): void {
  try {
    storage.setItem(BACKUP_KEY, text)
  } catch {
    /* хранилище переполнено или недоступно на запись — сохранить копию нечем */
  }
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
