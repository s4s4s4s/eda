/* Общее для сводки дня и экрана приёма: окно времени приёма (для заголовка
   MealScreen и карточек DaySummary) и тип прогресса одного слота дня — им
   пользуются App.tsx (собирает), DaySummary.tsx и SlotSwitch.tsx (читают). */

import {
  BREAKFAST_START_MIN, DINNER_START_MIN, LUNCH_START_MIN, SNACK_START_MIN
} from '../core/cycle.ts'
import type { MealStatus, Slot } from '../core/types.ts'

function minutesToClock(min: number): string {
  const h = Math.floor(min / 60) % 24
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export const SLOT_TIME_RANGE: Record<Slot, string> = {
  breakfast: `${minutesToClock(BREAKFAST_START_MIN)}–${minutesToClock(LUNCH_START_MIN)}`,
  lunch: `${minutesToClock(LUNCH_START_MIN)}–${minutesToClock(DINNER_START_MIN)}`,
  dinner: `${minutesToClock(DINNER_START_MIN)}–${minutesToClock(SNACK_START_MIN)}`,
  snack: `${minutesToClock(SNACK_START_MIN)}–${minutesToClock(BREAKFAST_START_MIN)}`
}

/** Состояние одного приёма в прогрессе дня. Запланированное берётся из меню,
    съеденное — из дневника с уже применённой долей. `status === undefined`
    означает «ещё не записан», и это не то же самое, что «пропущен». */
/** Подпись статуса записи — одна на сводку (aria-label сегментов прогресса)
    и на экран приёма (строка над «Отменить запись»). */
export const STATUS_LABEL: Record<MealStatus, string> = {
  eaten: 'Съедено целиком',
  partial: 'Съедена часть',
  skipped: 'Пропущено'
}

export interface DaySlotProgress {
  slot: Slot
  /** Название блюда меню на этот приём; если меню нет, но приём уже записан —
      название из снапшота записи. undefined — ни меню, ни записи нет. */
  title: string | undefined
  plannedKcal: number
  eatenKcal: number
  status: MealStatus | undefined
  /** Доля записанного приёма — та же величина, что и `MealLogEntry.fraction`.
      Нужна, чтобы строка-подпись под «Микронутриентами» могла написать
      «обед (½)» так же, как подписаны варианты в панели действий. Пока
      `status === undefined`, значение не читается. */
  fraction: number | undefined
  /** Ревизия справочника, по которой посчитан снапшот этой записи — та же
      величина, что и `MealLogEntry.productsRevision`. undefined значит либо
      «слот не записан», либо «запись сделана до появления ревизии» — оба
      случая читаются одинаково: по каким числам считано, неизвестно. */
  productsRevision: string | undefined
  /** Съеденное сверх меню, отнесённое к этому слоту (сумма kbju.kcal × fraction
      по ExtraLogEntry.slot === slot). Не входит в plannedKcal — план всегда
      идёт из меню, добавленное лишь заполняет заливку сегмента сверх него. */
  extrasKcal: number
}
