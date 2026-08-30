/* Чистые операции над дневником. Никакого localStorage — состояние иммутабельно:
   каждая функция возвращает новый объект, входной не мутируется. */

import { addNutrientTotals, emptyNutrientTotals, mealKbju, mealNutrients, scaleNutrientTotals } from './nutrition'
import type { AppState, DayLog, Kbju, Meal, MealLogEntry, MealStatus, NutrientTotals, ProductIndex, Slot } from './types'

const ZERO_KBJU: Kbju = { kcal: 0, p: 0, f: 0, c: 0 }

/** Записывает приём в дневник даты date. Снапшотит КБЖУ полного приёма и cycleDay
    дня — правка меню задним числом уже записанные дни не переписывает. Повторная
    запись того же приёма на ту же дату перезаписывает старую запись. */
export function logMeal(
  state: AppState,
  date: string,
  slot: Slot,
  meal: Meal,
  products: ProductIndex,
  status: MealStatus,
  fraction: number,
  cycleDayForDate: number,
  loggedAt: string
): AppState {
  const kbju = mealKbju(meal, products)
  const nutrients = mealNutrients(meal, products)
  const entry: MealLogEntry = {
    slot,
    status,
    fraction,
    kbju,
    nutrients,
    title: meal.title,
    loggedAt
  }
  const existingDay: DayLog = state.log[date] ?? { cycleDay: cycleDayForDate, meals: {} }
  const newDay: DayLog = {
    cycleDay: existingDay.cycleDay,
    meals: { ...existingDay.meals, [slot]: entry }
  }
  return {
    ...state,
    log: { ...state.log, [date]: newDay }
  }
}

/** Удаляет запись о приёме slot на дату date. Если записи о дате не было — не меняет ничего. */
export function unlogMeal(state: AppState, date: string, slot: Slot): AppState {
  const existingDay = state.log[date]
  if (!existingDay) return state
  const newMeals = { ...existingDay.meals }
  delete newMeals[slot]
  const newDay: DayLog = { cycleDay: existingDay.cycleDay, meals: newMeals }
  return {
    ...state,
    log: { ...state.log, [date]: newDay }
  }
}

/** Стирает дневник целиком, сохраняя настройки. Нужен, когда хранилище браузера
    переполнено: без этой операции единственным выходом остаётся очистка данных
    сайта, которая уносит и настройки. Дни сохраняются только здесь, поэтому
    вызывать её можно лишь по явному подтверждению человека. */
export function clearLog(state: AppState): AppState {
  return { ...state, log: {} }
}

/** Сколько дней и байт занимает дневник. Байты считаются по UTF-8 того же
    JSON, который уходит в localStorage, — иначе кириллические названия
    приёмов занижают оценку вдвое. */
export function logFootprint(log: AppState['log']): { days: number; bytes: number } {
  const days = Object.keys(log).length
  const bytes = new TextEncoder().encode(JSON.stringify(log)).length
  return { days, bytes }
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

/** Сумма съеденного за день по всем записанным приёмам. */
export function dayTotal(dayLog: DayLog): Kbju {
  let total = ZERO_KBJU
  for (const slot of Object.keys(dayLog.meals) as Slot[]) {
    const entry = dayLog.meals[slot]
    if (!entry) continue
    const eaten = eatenKbju(entry)
    total = { kcal: total.kcal + eaten.kcal, p: total.p + eaten.p, f: total.f + eaten.f, c: total.c + eaten.c }
  }
  return total
}

/** Съеденные нутриенты по одной записи: снапшот, умноженный на долю. Полнота
    от доли не зависит — см. scaleNutrientTotals. */
export function eatenNutrients(entry: MealLogEntry): NutrientTotals {
  return scaleNutrientTotals(entry.nutrients, entry.fraction)
}

/** Сумма съеденных нутриентов за день. Полнота складывается вместе с числами:
    день, где один приём не знал витамина K, остаётся неполным по витамину K. */
export function dayNutrientTotals(dayLog: DayLog): NutrientTotals {
  let total = emptyNutrientTotals()
  for (const slot of Object.keys(dayLog.meals) as Slot[]) {
    const entry = dayLog.meals[slot]
    if (!entry) continue
    total = addNutrientTotals(total, eatenNutrients(entry))
  }
  return total
}
