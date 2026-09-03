/* Чистые операции над дневником. Никакого localStorage — состояние иммутабельно:
   каждая функция возвращает новый объект, входной не мутируется. */

import { addNutrientTotals, emptyNutrientTotals, mealKbju, mealNutrients, scaleNutrientTotals } from './nutrition'
import type { AppState, DayLog, ExtraLogEntry, Kbju, Meal, MealLogEntry, MealStatus, NutrientTotals, ProductIndex, Slot } from './types'

const ZERO_KBJU: Kbju = { kcal: 0, p: 0, f: 0, c: 0 }

/** Записывает приём в дневник даты date. Снапшотит КБЖУ полного приёма и cycleDay
    дня — правка меню задним числом уже записанные дни не переписывает. Повторная
    запись того же приёма на ту же дату перезаписывает старую запись.

    productsRevision — ревизия справочника, по которой посчитан снапшот. Параметр
    необязателен потому, что вызывающий может её не знать (справочник собран
    сборкой без поля revision), а выдумывать отметку нельзя: отсутствие поля
    честно означает «по какому справочнику считано — неизвестно». */
export function logMeal(
  state: AppState,
  date: string,
  slot: Slot,
  meal: Meal,
  products: ProductIndex,
  status: MealStatus,
  fraction: number,
  cycleDayForDate: number,
  loggedAt: string,
  productsRevision?: string
): AppState {
  const kbju = mealKbju(meal, products)
  const nutrients = mealNutrients(meal, products)
  const entry: MealLogEntry = {
    slot,
    mealId: meal.id,
    status,
    fraction,
    kbju,
    nutrients,
    title: meal.title,
    loggedAt,
    // поле не пишется вовсе, когда ревизия не передана: `productsRevision: undefined`
    // пережил бы JSON.stringify как отсутствие ключа, но до сериализации выглядел
    // бы как «ревизия есть и она пустая» для всякого, кто проверяет `in`.
    ...(productsRevision !== undefined ? { productsRevision } : {})
  }
  const existingDay: DayLog = state.log[date] ?? { cycleDay: cycleDayForDate, meals: {}, extras: [] }
  const newDay: DayLog = {
    cycleDay: existingDay.cycleDay,
    meals: { ...existingDay.meals, [slot]: entry },
    extras: existingDay.extras
  }
  return {
    ...state,
    log: { ...state.log, [date]: newDay }
  }
}

/** Удаляет запись о приёме slot на дату date. Если записи о дате не было — не меняет ничего.

    Опустевший день уходит из дневника вместе с ключом даты: день, в котором не
    осталось ни одной записи, — это день БЕЗ ЗАПИСЕЙ, а не день с нулём. Оставь
    мы пустой объект, недельная сводка считала бы его записанным и делила бы
    среднее на лишний день (два дня по 3000 ккал и один отменённый дали бы
    «2000 в среднем»). Отмена записи не должна занижать съеденное. */
export function unlogMeal(state: AppState, date: string, slot: Slot): AppState {
  const existingDay = state.log[date]
  if (!existingDay) return state
  const newMeals = { ...existingDay.meals }
  delete newMeals[slot]
  return replaceDay(state, date, { cycleDay: existingDay.cycleDay, meals: newMeals, extras: existingDay.extras })
}

/** Кладёт день на место или убирает его вместе с ключом даты, если в нём не
    осталось ни записей приёмов, ни добавленной еды. Пустой день не хранится
    (см. unlogMeal), и добавленная еда — такая же запись дня, как приём: день,
    в котором остался только съеденный сверх меню десерт, — записанный день. */
function replaceDay(state: AppState, date: string, day: DayLog): AppState {
  const newLog = { ...state.log }
  if (Object.keys(day.meals).length === 0 && day.extras.length === 0) {
    delete newLog[date]
  } else {
    newLog[date] = day
  }
  return { ...state, log: newLog }
}

/** Записывает добавленную еду в день date. Запись с тем же id перезаписывается
    (повторное сохранение одного разбора не удваивает калории), новая встаёт в
    конец — порядок списка на экране повторяет порядок добавления. */
export function addExtra(state: AppState, date: string, extra: ExtraLogEntry, cycleDayForDate: number): AppState {
  const existingDay: DayLog = state.log[date] ?? { cycleDay: cycleDayForDate, meals: {}, extras: [] }
  const known = existingDay.extras.findIndex(e => e.id === extra.id)
  const extras = known === -1
    ? [...existingDay.extras, extra]
    : existingDay.extras.map(e => (e.id === extra.id ? extra : e))
  return replaceDay(state, date, { cycleDay: existingDay.cycleDay, meals: existingDay.meals, extras })
}

/** Убирает добавленную еду из дня. День уходит из дневника вместе с ключом
    даты, если после этого в нём не осталось ни приёмов, ни добавленного, — по
    той же причине, что и в unlogMeal. */
export function removeExtra(state: AppState, date: string, extraId: string): AppState {
  const existingDay = state.log[date]
  if (!existingDay) return state
  const extras = existingDay.extras.filter(e => e.id !== extraId)
  if (extras.length === existingDay.extras.length) return state
  return replaceDay(state, date, { cycleDay: existingDay.cycleDay, meals: existingDay.meals, extras })
}

/** Стирает дневник целиком, сохраняя настройки. Нужен, когда хранилище браузера
    переполнено: без этой операции единственным выходом остаётся очистка данных
    сайта, которая уносит и настройки. Дни сохраняются только здесь, поэтому
    вызывать её можно лишь по явному подтверждению человека. */
export function clearLog(state: AppState): AppState {
  return { ...state, log: {} }
}

/** Сколько дней, своих блюд и байт занимает записанное. Байты считаются по
    UTF-8 того же JSON, который уходит в localStorage, — иначе кириллические
    названия приёмов занижают оценку вдвое.

    Книга своей еды входит в тот же счёт: одна разобранная еда с компонентами
    и их per100 весит около килобайта, и человек, который смотрит на размер
    перед очисткой, обязан видеть её тоже. Аргумент необязателен потому, что
    вызывающий может спрашивать именно про дневник; пустая книга — «книгу не
    считаем», а не «книга пуста». */
export function logFootprint(
  log: AppState['log'],
  customFoods: AppState['customFoods'] = {}
): { days: number; foods: number; bytes: number } {
  const days = Object.keys(log).length
  const foods = Object.keys(customFoods).length
  const encoder = new TextEncoder()
  const bytes = encoder.encode(JSON.stringify(log)).length
    + (foods > 0 ? encoder.encode(JSON.stringify(customFoods)).length : 0)
  return { days, foods, bytes }
}

/** Съеденное по одной записи: снапшот КБЖУ, умноженный на долю. */
export function eatenKbju(entry: MealLogEntry): Kbju {
  const factor = entry.fraction
  return {
    kcal: entry.kbju.kcal * factor,
    p: entry.kbju.p * factor,
    f: entry.kbju.f * factor,
    c: entry.kbju.c * factor
  }
}

/** Съеденное по одной добавленной записи. Арифметика та же, что у приёма
    меню: снапшот полной порции × доля. */
export function eatenExtraKbju(extra: ExtraLogEntry): Kbju {
  const factor = extra.fraction
  return {
    kcal: extra.kbju.kcal * factor,
    p: extra.kbju.p * factor,
    f: extra.kbju.f * factor,
    c: extra.kbju.c * factor
  }
}

/** Съеденные нутриенты по одной добавленной записи — см. eatenNutrients. */
export function eatenExtraNutrients(extra: ExtraLogEntry): NutrientTotals {
  return scaleNutrientTotals(extra.nutrients, extra.fraction)
}

/** Сумма съеденного за день: записанные приёмы плюс добавленная еда. Второе
    слагаемое обязательно — иначе съеденный сверх меню десерт не попадал бы ни
    в панель «за день», ни в неделю, ни в выгрузку. */
export function dayTotal(dayLog: DayLog): Kbju {
  let total = ZERO_KBJU
  for (const slot of Object.keys(dayLog.meals) as Slot[]) {
    const entry = dayLog.meals[slot]
    if (!entry) continue
    const eaten = eatenKbju(entry)
    total = { kcal: total.kcal + eaten.kcal, p: total.p + eaten.p, f: total.f + eaten.f, c: total.c + eaten.c }
  }
  for (const extra of dayLog.extras) {
    const eaten = eatenExtraKbju(extra)
    total = { kcal: total.kcal + eaten.kcal, p: total.p + eaten.p, f: total.f + eaten.f, c: total.c + eaten.c }
  }
  return total
}

/** Съеденные нутриенты по одной записи: снапшот, умноженный на долю. Полнота от
    доли не зависит — кроме пропущенного приёма (доля 0), который даёт ноль
    позиций, а не позиции с измеренным нулём; см. scaleNutrientTotals. */
export function eatenNutrients(entry: MealLogEntry): NutrientTotals {
  return scaleNutrientTotals(entry.nutrients, entry.fraction)
}

/** Сумма съеденных нутриентов за день: приёмы и добавленная еда. Полнота
    складывается вместе с числами: день, где один приём не знал витамина K,
    остаётся неполным по витамину K — и добавленная еда, которая его не знает,
    делает день неполным ровно так же. */
export function dayNutrientTotals(dayLog: DayLog): NutrientTotals {
  let total = emptyNutrientTotals()
  for (const slot of Object.keys(dayLog.meals) as Slot[]) {
    const entry = dayLog.meals[slot]
    if (!entry) continue
    total = addNutrientTotals(total, eatenNutrients(entry))
  }
  for (const extra of dayLog.extras) {
    total = addNutrientTotals(total, eatenExtraNutrients(extra))
  }
  return total
}
