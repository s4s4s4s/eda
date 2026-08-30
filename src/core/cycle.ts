/* Цикл готовки: день цикла, партия готовки, текущий приём по времени суток. */

import type { Slot } from './types'

/** Локальная дата -> UTC-полдень, чтобы разница дней не плавала на переходах DST/полуночи. */
function localDateToUtcNoon(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Date.UTC(y, m - 1, d, 12)
}

function daysBetween(fromDate: string, toDate: string): number {
  const ms = localDateToUtcNoon(toDate) - localDateToUtcNoon(fromDate)
  return Math.round(ms / 86_400_000)
}

/** Неотрицательный остаток от деления (в отличие от %, никогда не даёт отрицательное). */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

/** День цикла (1..cycleDays) на дату today, с учётом ручного сдвига shift (в днях). */
export function cycleDay(startDate: string, today: string, shift: number, cycleDays: number): number {
  const diff = daysBetween(startDate, today) + shift
  return mod(diff, cycleDays) + 1
}

/** Партия готовки (1..4): дни 1-4 цикла и дни 5-8 цикла дают одну и ту же партию. */
export function batchDay(cycleDayNum: number): number {
  return mod(cycleDayNum - 1, 4) + 1
}

/* Пороги приёмов пищи, в минутах от полуночи. Значение — начало интервала. */
export const BREAKFAST_START_MIN = 5 * 60
export const LUNCH_START_MIN = 11 * 60
export const DINNER_START_MIN = 16 * 60
export const SNACK_START_MIN = 20 * 60

/** Текущий приём пищи по времени суток (минуты от полуночи, 0..1439). */
export function currentSlot(minutesOfDay: number): Slot {
  if (minutesOfDay >= SNACK_START_MIN) return 'snack'
  if (minutesOfDay >= DINNER_START_MIN) return 'dinner'
  if (minutesOfDay >= LUNCH_START_MIN) return 'lunch'
  if (minutesOfDay >= BREAKFAST_START_MIN) return 'breakfast'
  return 'snack'
}

/** Локальная дата (YYYY-MM-DD) для Date, по её локальным полям (не UTC). */
export function todayLocal(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
