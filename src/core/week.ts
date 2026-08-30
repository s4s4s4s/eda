/* Недельная сводка дневника (чистое ядро, без React/DOM/localStorage).
   Отсутствие записи за день — не ноль: такой день входит в окно с hasLog === false,
   но не участвует ни в одном среднем. Средние по нутриентам считаются только по
   дням, где у нутриента было known > 0 — иначе пропуск данных занижал бы среднее
   так, будто съеденное было измерено и оказалось пустым. */

import { dayNutrientTotals, dayTotal } from './log'
import type { CoverageState } from './norms'
import { NUTRIENT_KEYS, SLOTS } from './types'
import type { AppState, DayLog, Kbju, NutrientKey, NutrientNorms, NutrientTotals, Slot } from './types'

const ZERO_KBJU: Kbju = { kcal: 0, p: 0, f: 0, c: 0 }

export interface DaySummary {
  date: string
  cycleDay: number | null
  hasLog: boolean
  kbju: Kbju
  loggedSlots: Slot[]
  missingSlots: Slot[]
  nutrients: NutrientTotals | null
}

export interface WeekNutrient {
  key: NutrientKey
  daysWithData: number
  avgValue: number | null
  partialDays: number
}

export interface WeekSummary {
  days: DaySummary[]
  daysWithLog: number
  avgKcal: number | null
  avgProteinG: number | null
  nutrients: WeekNutrient[]
}

/** Строка «Итогов недели» — раздел со ВСЕМИ позициями (DESIGN.md, «Итоги
    недели»), а не только систематическими провалами. Норма здесь суточная,
    умноженная на daysWithData — ЧИСЛО ДНЕЙ С ДАННЫМИ ПО ЭТОЙ ПОЗИЦИИ, а не на
    dayCount и не на число записанных дней: иначе нутриент, известный по двум
    дням из семи, читался бы как набранный (или недобранный) за всю неделю. */
export interface WeekCoverage {
  key: NutrientKey
  /** Сумма за дни, по которым данные есть. */
  value: number
  /** Число дней окна с данными по этой позиции. */
  daysWithData: number
  /** Дней в окне всего (для подписи «из 7»). */
  dayCount: number
  /** Сколько из daysWithData несли неполную сумму (known < total). */
  partialDays: number
  /** Норма за daysWithData дней; null — нормы нет или сравнивать нельзя. */
  norm: number | null
  ratio: number | null
  state: CoverageState
  /** Верхний безопасный предел за daysWithData дней (суточный ul × daysWithData).
      null — у нутриента нет ul (см. data/norms.yaml) или данных нет. */
  ul: number | null
  /** value превысил ul. Единственное основание красить полосу красным. */
  overUl: boolean
  /** Уровень снижения риска хронических болезней за daysWithData дней — задан
      только натрию (норм.cdrr), и это НЕ верхний предел безопасности: у натрия
      его нет вовсе. null — у нутриента нет cdrr или данных нет. */
  cdrr: number | null
  /** value превысил cdrr. Никогда не красит полосу — только текстовая оговорка,
      её нельзя путать с overUl. */
  overCdrr: boolean
}

/* Тот же приём, что и в src/core/cycle.ts (localDateToUtcNoon/daysBetween):
   локальная дата переводится в UTC-полдень, чтобы разница/сдвиг дней не плавали
   на переходах DST и на границах месяца/года. */
function localDateToUtcNoon(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Date.UTC(y, m - 1, d, 12)
}

function utcNoonToLocalDate(ms: number): string {
  const dt = new Date(ms)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Локальная дата, сдвинутая на offsetDays (может быть отрицательным). */
function addDaysLocal(dateStr: string, offsetDays: number): string {
  return utcNoonToLocalDate(localDateToUtcNoon(dateStr) + offsetDays * 86_400_000)
}

function summarizeDay(date: string, dayLog: DayLog | undefined): DaySummary {
  if (!dayLog) {
    return {
      date,
      cycleDay: null,
      hasLog: false,
      kbju: ZERO_KBJU,
      loggedSlots: [],
      missingSlots: [...SLOTS],
      nutrients: null
    }
  }
  const loggedSlots = SLOTS.filter((slot) => dayLog.meals[slot] !== undefined)
  const missingSlots = SLOTS.filter((slot) => dayLog.meals[slot] === undefined)
  return {
    date,
    cycleDay: dayLog.cycleDay,
    hasLog: true,
    kbju: dayTotal(dayLog),
    loggedSlots,
    missingSlots,
    nutrients: dayNutrientTotals(dayLog)
  }
}

/** Недельная (или dayCount-дневная) сводка дневника, оканчивающаяся на endDate включительно.
    День без записей присутствует в days с hasLog: false, но не входит ни в одно среднее. */
export function weekSummary(log: AppState['log'], endDate: string, dayCount = 7): WeekSummary {
  const days: DaySummary[] = []
  for (let i = dayCount - 1; i >= 0; i--) {
    const date = addDaysLocal(endDate, -i)
    days.push(summarizeDay(date, log[date]))
  }

  const loggedDays = days.filter((d) => d.hasLog)
  const daysWithLog = loggedDays.length

  const avgKcal = daysWithLog > 0 ? loggedDays.reduce((sum, d) => sum + d.kbju.kcal, 0) / daysWithLog : null
  const avgProteinG = daysWithLog > 0 ? loggedDays.reduce((sum, d) => sum + d.kbju.p, 0) / daysWithLog : null

  const nutrients: WeekNutrient[] = NUTRIENT_KEYS.map((key) => {
    let sum = 0
    let daysWithData = 0
    let partialDays = 0
    for (const d of loggedDays) {
      const total = d.nutrients![key]
      if (total.known > 0) {
        sum += total.value
        daysWithData++
        if (total.known < total.total) partialDays++
      }
    }
    return {
      key,
      daysWithData,
      avgValue: daysWithData > 0 ? sum / daysWithData : null,
      partialDays
    }
  })

  return { days, daysWithLog, avgKcal, avgProteinG, nutrients }
}

/** Итоги недели: все 29 позиций, в порядке NUTRIENT_KEYS, ни одна не пропущена.
    Считает заново по summary.days (а не по WeekNutrient.avgValue), чтобы норма
    окна получалась прямым произведением amount * daysWithData, без обратного
    восстановления суммы делением-и-умножением через среднее. */
export function weekCoverage(summary: WeekSummary, norms: NutrientNorms): WeekCoverage[] {
  const loggedDays = summary.days.filter((d) => d.hasLog)
  const dayCount = summary.days.length

  return NUTRIENT_KEYS.map((key) => {
    let sum = 0
    let daysWithData = 0
    let partialDays = 0
    for (const d of loggedDays) {
      const total = d.nutrients![key]
      if (total.known > 0) {
        sum += total.value
        daysWithData++
        if (total.known < total.total) partialDays++
      }
    }

    const hasData = daysWithData > 0
    const norm = hasData ? (norms[key] ?? null) : null

    let state: CoverageState
    if (!hasData) state = 'no-data'
    else if (norm === null) state = 'no-norm'
    else if (!norm.comparable) state = 'not-comparable'
    else state = 'ok'

    const windowNorm = norm !== null && norm.comparable ? norm.amount * daysWithData : null
    const ratio = windowNorm !== null ? sum / windowNorm : null

    /* ul и cdrr — независимо от comparable: превышение верхнего предела значимо
       само по себе, даже если основную норму (RDA/AI) с приложением сравнивать
       нельзя. Тот же приём умножения на daysWithData, что и у windowNorm. */
    const windowUl = norm !== null && norm.ul !== undefined ? norm.ul * daysWithData : null
    const overUl = windowUl !== null && sum > windowUl

    const windowCdrr = norm !== null && norm.cdrr !== undefined ? norm.cdrr * daysWithData : null
    const overCdrr = windowCdrr !== null && sum > windowCdrr

    return {
      key, value: sum, daysWithData, dayCount, partialDays, norm: windowNorm, ratio, state,
      ul: windowUl, overUl, cdrr: windowCdrr, overCdrr
    }
  })
}
