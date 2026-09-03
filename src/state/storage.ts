/* Загрузка и сохранение AppState в localStorage.
   Чистые функции (defaultState/serialize/deserialize) не трогают браузер и
   тестируются напрямую. loadState/saveState — тонкие обёртки поверх них,
   единственные, кто знает про localStorage.

   Правило deserialize: НИКОГДА не бросать исключение наружу. Человек стоит
   с телефоном у стола — уронить приложение из-за кривого JSON хуже, чем
   потерять одну запись дневника. Что чинится молча, а что откатывается к
   дефолту — см. комментарии внутри deserialize. */

import { NUTRIENT_KEYS, SLOTS } from '../core/types.ts'
import type {
  AppState, CustomFood, DayLog, ExtraLogEntry, FoodComponent, FoodRequest, FoodRequestStatus, FoodResultOk,
  Kbju, MealLogEntry, MealStatus, Nutrients, NutrientTotal, NutrientTotals, Preferences, Settings, Slot
} from '../core/types.ts'
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
    v4 -> v5: появилась еда сверх меню (DayLog.extras), книга своей еды
    (AppState.customFoods), очередь заказов на разбор (AppState.foodRequests)
    и токен Штурмана (Settings.shturmanToken). Все четыре поля у состояний
    версии 4 и старше просто отсутствуют и достраиваются пустыми: пустой
    список добавленного — это правда про день, записанный до появления
    добавления, а не потеря. Ни одна запись приёмов при этом не трогается.
    Ключ localStorage при этом НЕ меняется: он адресует хранилище, а не формат,
    и его смена означала бы потерю уже записанных дней. */
export const CURRENT_VERSION = 5

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
    cycleStartConfirmed: false,
    // токен вводит человек в настройках; пусто — разбор своей еды не настроен.
    shturmanToken: ''
  }
  return {
    version: CURRENT_VERSION,
    settings,
    log: {},
    preferences: { ingredients: {}, dishes: {} },
    customFoods: {},
    foodRequests: []
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

/** Числа КБЖУ обязаны быть конечными: NaN или Infinity, попав в снапшот,
    отравляют не одну запись, а каждую сумму, куда она входит, — день, неделю и
    выгрузку, — и делают это молча, показывая «NaN ккал» вместо числа. Запись с
    таким КБЖУ восстановлению не подлежит и отбрасывается (считаясь в dropped).
    Через JSON такие значения приходят как null и до typeof-проверки не доживают,
    но состояние попадает сюда и напрямую (deserialize зовут тестами и
    инструментами), а проверка стоит копейки. */
function isKbju(v: unknown): v is Kbju {
  if (!isPlainObject(v)) return false
  return isFiniteNumber(v.kcal) && isFiniteNumber(v.p) && isFiniteNumber(v.f) && isFiniteNumber(v.c)
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
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

/** Доля добавленной еды: строго в (0, 1]. Нуля здесь нет в отличие от приёма
    меню — «добавил и не съел» выражается отсутствием записи, а не записью с
    нулём, — и выводить долю не из чего: статуса у добавленной еды нет по
    устройству. Поэтому число берётся из поля, но проверяется на пределы; всё
    остальное (в том числе доля 2, превращающая 300 ккал в 600) — порча, и
    запись отбрасывается, а не зажимается к границе. */
function isExtraFraction(v: unknown): v is number {
  return isFiniteNumber(v) && v > 0 && v <= 1
}

/** Проверяет и чинит одну запись добавленной еды. null — запись недостоверна
    целиком и выпадает (считаясь в dropped).

    Обязательные по виду поля (mealId/fromCycleDay/fromSlot у 'menu',
    customFoodId/source у 'custom') именно обязательны, и это не строгость ради
    строгости: формат существует только с версии 5, приложение всегда пишет их
    целиком, и отсутствие любого из них означает, что запись собрана не им.
    Достроить их нечем — «день 0, завтрак» была бы выдуманной подписью к чужой
    еде, а к съеденному ничего выдуманного приписывать нельзя.

    Снапшот нутриентов, наоборот, чинится: он проходит тот же sanitizeNutrients,
    что и у приёма, и отсутствующий ключ даёт неизвестную позицию, а не ноль. */
function sanitizeExtraEntry(v: unknown): ExtraLogEntry | null {
  if (!isPlainObject(v)) return null
  if (!isNonEmptyString(v.id)) return null
  if (!isSlot(v.slot)) return null
  if (!isExtraFraction(v.fraction)) return null
  if (typeof v.title !== 'string') return null
  if (!isKbju(v.kbju)) return null
  if (typeof v.loggedAt !== 'string') return null

  const base = {
    id: v.id,
    slot: v.slot,
    fraction: v.fraction,
    title: v.title,
    kbju: v.kbju,
    nutrients: sanitizeNutrients(v.nutrients),
    loggedAt: v.loggedAt
  }

  if (v.kind === 'menu') {
    if (typeof v.mealId !== 'string') return null
    if (typeof v.fromCycleDay !== 'number' || !Number.isInteger(v.fromCycleDay)) return null
    if (!isSlot(v.fromSlot)) return null
    return {
      ...base,
      kind: 'menu',
      mealId: v.mealId,
      fromCycleDay: v.fromCycleDay,
      fromSlot: v.fromSlot,
      // ревизия переносится как есть и не выдумывается — как у MealLogEntry
      ...(typeof v.productsRevision === 'string' ? { productsRevision: v.productsRevision } : {})
    }
  }

  if (v.kind === 'custom') {
    if (!isNonEmptyString(v.customFoodId)) return null
    if (typeof v.source !== 'string') return null
    return { ...base, kind: 'custom', customFoodId: v.customFoodId, source: v.source }
  }

  // вид неизвестен — экран не знает, как такую запись показать, а калории её
  // вошли бы в сумму дня незримо. Невидимое слагаемое хуже потерянной записи.
  return null
}

interface SanitizedExtras {
  extras: ExtraLogEntry[]
  dropped: number
}

/** Проверяет и чинит список добавленной еды дня. Записи с одинаковым id
    схлопываются до первой: id — то, чем запись убирают с экрана, и вторая с
    тем же id либо не убралась бы вовсе, либо унесла бы соседнюю.

    Не-массив на входе даёт пустой список без счётчика потерь — считать там
    нечего (ровно как у meals, где не-объект даёт пустой набор приёмов):
    отсутствие поля у состояния версии 4 и мусор вместо него неразличимы, а
    выдуманное число потерь хуже отсутствующего. */
function sanitizeExtras(v: unknown): SanitizedExtras {
  if (!Array.isArray(v)) return { extras: [], dropped: 0 }
  const extras: ExtraLogEntry[] = []
  const seen = new Set<string>()
  let dropped = 0
  for (const raw of v) {
    const extra = sanitizeExtraEntry(raw)
    if (!extra || seen.has(extra.id)) {
      dropped++
      continue
    }
    seen.add(extra.id)
    extras.push(extra)
  }
  return { extras, dropped }
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
  const { extras, dropped: extrasDropped } = sanitizeExtras(v.extras)
  let dropped = extrasDropped
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
  // день исчезает, только когда пусты И приёмы, И добавленное: день, в котором
  // остался один съеденный сверх меню десерт, — записанный день с данными.
  if (Object.keys(meals).length === 0 && extras.length === 0) return { day: null, dropped }
  return { day: { cycleDay, meals, extras }, dropped }
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
    cycleStartConfirmed: typeof v.cycleStartConfirmed === 'boolean' ? v.cycleStartConfirmed : legacyConfirmed,
    // токена нет у состояний версии 4 и старше — пусто честно означает
    // «разбор своей еды не настроен»; подставлять сюда нечего.
    shturmanToken: typeof v.shturmanToken === 'string' ? v.shturmanToken : def.shturmanToken
  }
}

/* ---- своя еда: книга и очередь заказов ----

   Обе структуры новые (версия 5), у старых состояний их просто нет. Правило то
   же, что и в дневнике: недостоверная запись выпадает целиком и СЧИТАЕТСЯ
   (LoadResult.dropped), а не чинится подстановкой. Своя еда — это числа, по
   которым человек считает съеденное; еда с потерянным компонентом занизила бы
   день молча, выглядя при этом исправной. */

/** Частичная карта нутриентов на 100 г (Product.micro100 и
    FoodComponent.per100.micro). Ключ с недостоверным числом ВЫБРАСЫВАЕТСЯ, а не
    обнуляется: отсутствие ключа означает «датасет этого не знает», и сумма
    честно считает такую позицию неизвестной (known не растёт). Ноль на этом
    месте был бы измеренным нулём — той самой ложью, ради которой заведена
    полнота known/total. Ключи вне NUTRIENT_KEYS отбрасываются: их не знает
    ни один экран, а расхождение со справочником — рассинхрон кода, не данные. */
function sanitizeMicro(v: unknown): Nutrients {
  const micro: Nutrients = {}
  if (!isPlainObject(v)) return micro
  for (const key of NUTRIENT_KEYS) {
    const value = v[key]
    if (isFiniteNumber(value) && value >= 0) micro[key] = value
  }
  return micro
}

/** Компонент своей еды: строка USDA с граммовкой и числами на 100 г. null —
    компонент недостоверен, и вместе с ним отбрасывается вся еда: сумма по
    неполному составу — не «почти верная», а неверная. */
function sanitizeFoodComponent(v: unknown): FoodComponent | null {
  if (!isPlainObject(v)) return null
  if (!isFiniteNumber(v.fdcId) || !Number.isInteger(v.fdcId) || v.fdcId <= 0) return null
  if (typeof v.description !== 'string') return null
  if (typeof v.category !== 'string') return null
  if (!isFiniteNumber(v.grams) || v.grams <= 0) return null
  if (!isPlainObject(v.per100) || !isKbju(v.per100.kbju)) return null
  return {
    fdcId: v.fdcId,
    description: v.description,
    category: v.category,
    grams: v.grams,
    ...(typeof v.note === 'string' ? { note: v.note } : {}),
    per100: { kbju: v.per100.kbju, micro: sanitizeMicro(v.per100.micro) }
  }
}

/** О чём человек спрашивал. Граммовка необязательна (её могли не называть):
    недостоверное число становится null — «вес не задавали», — а не выдуманным
    весом. Само по себе это подпись к разбору, а не источник чисел. */
function sanitizeFoodRequestBody(v: unknown): { text: string; grams: number | null } | null {
  if (!isPlainObject(v)) return null
  if (typeof v.text !== 'string') return null
  return { text: v.text, grams: isFiniteNumber(v.grams) && v.grams > 0 ? v.grams : null }
}

function sanitizeCustomFood(v: unknown): CustomFood | null {
  if (!isPlainObject(v)) return null
  if (!isNonEmptyString(v.id)) return null
  if (typeof v.title !== 'string') return null
  if (typeof v.source !== 'string') return null
  if (!isFiniteNumber(v.spec)) return null
  if (typeof v.jobId !== 'string') return null
  if (typeof v.createdAt !== 'string') return null
  const request = sanitizeFoodRequestBody(v.request)
  if (!request) return null
  if (!Array.isArray(v.components) || v.components.length === 0) return null
  const components: FoodComponent[] = []
  for (const raw of v.components) {
    const component = sanitizeFoodComponent(raw)
    if (!component) return null
    components.push(component)
  }
  return { id: v.id, title: v.title, source: v.source, spec: v.spec, jobId: v.jobId, request, components, createdAt: v.createdAt }
}

interface SanitizedCustomFoods {
  customFoods: AppState['customFoods']
  dropped: number
}

/** Книга своей еды. Запись под чужим ключом («a: {id: b}») недостоверна целиком
    по той же причине, что и приём под чужим слотом: неизвестно, что из двух
    верно, а ссылки записей дневника держатся именно за ключ. */
function sanitizeCustomFoods(v: unknown): SanitizedCustomFoods {
  if (!isPlainObject(v)) return { customFoods: {}, dropped: 0 }
  const customFoods: AppState['customFoods'] = {}
  let dropped = 0
  for (const [key, raw] of Object.entries(v)) {
    const food = sanitizeCustomFood(raw)
    if (!food || food.id !== key) {
      dropped++
      continue
    }
    customFoods[key] = food
  }
  return { customFoods, dropped }
}

function isFoodRequestStatus(v: unknown): v is FoodRequestStatus {
  return v === 'pending' || v === 'done' || v === 'failed' || v === 'expired'
}

/** Готовый разбор внутри заказа. Проверяется целиком: это те самые числа,
    которые человек нажатием «Сохранить и записать» превратит в запись дневника.
    Снапшот нутриентов чинится общей sanitizeNutrients — отсутствующий ключ даёт
    неизвестную позицию, а не ноль. */
function sanitizeFoodResult(v: unknown): FoodResultOk | null {
  if (!isPlainObject(v)) return null
  if (v.ok !== true) return null
  if (!isFiniteNumber(v.spec)) return null
  if (typeof v.source !== 'string') return null
  if (typeof v.title !== 'string') return null
  if (!isKbju(v.kbju)) return null
  const request = sanitizeFoodRequestBody(v.request)
  if (!request) return null
  if (!Array.isArray(v.components) || v.components.length === 0) return null
  const components: FoodComponent[] = []
  for (const raw of v.components) {
    const component = sanitizeFoodComponent(raw)
    if (!component) return null
    components.push(component)
  }
  return {
    ok: true,
    spec: v.spec,
    source: v.source,
    title: v.title,
    request,
    components,
    kbju: v.kbju,
    nutrients: sanitizeNutrients(v.nutrients)
  }
}

/** Заказ на разбор. Недостоверный выпадает целиком и считается: очередь — не
    дневник, потерянный заказ означает лишь «спроси заново», а заказ с битым
    полем показал бы человеку состояние, которого нет.

    'done' без разобранного результата — как раз такой случай: сохранять из
    него нечего, а «готово» на экране было бы враньём. */
function sanitizeFoodRequest(v: unknown): FoodRequest | null {
  if (!isPlainObject(v)) return null
  if (!isNonEmptyString(v.id)) return null
  if (typeof v.text !== 'string') return null
  if (typeof v.askedAt !== 'string') return null
  if (!isFoodRequestStatus(v.status)) return null
  if (!isPlainObject(v.target) || !isNonEmptyString(v.target.date) || !isSlot(v.target.slot)) return null

  const result = v.result === undefined ? null : sanitizeFoodResult(v.result)
  if (v.result !== undefined && !result) return null
  if (v.status === 'done' && !result) return null

  return {
    id: v.id,
    text: v.text,
    grams: isFiniteNumber(v.grams) && v.grams > 0 ? v.grams : null,
    askedAt: v.askedAt,
    target: { date: v.target.date, slot: v.target.slot },
    status: v.status,
    ...(result ? { result } : {}),
    ...(typeof v.error === 'string' ? { error: v.error } : {}),
    // «сколько секунд назад компьютер выходил на связь» — сведение прошлого
    // опроса; недостоверное число становится null («неизвестно»), а не нулём,
    // который читался бы как «компьютер на связи прямо сейчас».
    pcAgo: isFiniteNumber(v.pcAgo) ? v.pcAgo : null,
    ...(typeof v.lastPolledAt === 'string' ? { lastPolledAt: v.lastPolledAt } : {})
  }
}

interface SanitizedFoodRequests {
  foodRequests: FoodRequest[]
  dropped: number
}

/** Очередь заказов. Порядок сохраняется — он повторяет порядок обращений
    человека; заказы с повторяющимся id схлопываются до первого, как и записи
    добавленной еды: по id заказ опрашивают и убирают. */
function sanitizeFoodRequests(v: unknown): SanitizedFoodRequests {
  if (!Array.isArray(v)) return { foodRequests: [], dropped: 0 }
  const foodRequests: FoodRequest[] = []
  const seen = new Set<string>()
  let dropped = 0
  for (const raw of v) {
    const request = sanitizeFoodRequest(raw)
    if (!request || seen.has(request.id)) {
      dropped++
      continue
    }
    seen.add(request.id)
    foodRequests.push(request)
  }
  return { foodRequests, dropped }
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
  const { log, dropped: logDropped } = sanitizeLog(raw.log)
  const { customFoods, dropped: foodsDropped } = sanitizeCustomFoods(raw.customFoods)
  const { foodRequests, dropped: requestsDropped } = sanitizeFoodRequests(raw.foodRequests)
  const state: AppState = {
    version: CURRENT_VERSION,
    settings: sanitizeSettings(raw.settings, rawVersion < 4),
    log,
    preferences: sanitizePreferences(raw.preferences),
    customFoods,
    foodRequests
  }
  // потери книги и очереди считаются вместе с потерями дневника: полоса на
  // экране говорит про «записи дневника или своей еды» одной строкой, и
  // отдельный счётчик, о котором никто не спрашивает, был бы молчанием.
  return { state, dropped: logDropped + foodsDropped + requestsDropped }
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
  /** Сколько записей не пережило санитизацию: чужой слот, доля вне (0, 1) у
      «съел часть», непоправимо битая запись приёма или добавленной еды, еда
      книги с потерянным компонентом, заказ разбора с битым полем. Одно число
      на всё записанное намеренно — человеку важно «часть записей потеряна, вот
      копия исходного текста», а не в какой именно структуре. Ноль у всех
      источников, кроме 'stored', — там, где ничего не разбиралось, нечего и
      терять. */
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
        ? 'Хранилище браузера переполнено — запись не сохранена. Выгрузите день кнопкой «выгрузить день», затем очистите дневник в настройках или удалите лишнее из книги своей еды.'
        : 'Не удалось сохранить запись в хранилище браузера.'
    }
  }
}
