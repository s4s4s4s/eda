/* Покрытие суточных норм: сумма за день против чисел из data/norms.yaml.
   Чистое ядро — ни React, ни DOM, ни localStorage.

   Главное здесь — то, чего эта функция НЕ делает. Она не подставляет ноль там,
   где данных нет, и не выдаёт процент там, где сравнивать нечего или не с чем:
   «0 % кальция» и «нет данных по кальцию» — разные утверждения, и второе нельзя
   тихо превращать в первое. Поэтому у каждой строки есть состояние (state), а
   ratio имеет право быть null. */

import { NUTRIENT_KEYS } from './types'
import type { NutrientKey, NutrientNorm, NutrientNorms, NutrientTotals } from './types'

/** Почему по строке нет процента (или есть — 'ok'):
    ok             — норма есть, данные есть, процент осмыслен;
    no-norm        — нормы для нутриента нет (см. шапку data/norms.yaml);
    not-comparable — норма есть, но считает не то же самое (comparable: false);
    no-data        — ни одна позиция дня не знала этого нутриента. */
export type CoverageState = 'ok' | 'no-norm' | 'not-comparable' | 'no-data'

export interface NutrientCoverage {
  key: NutrientKey
  /** Сумма за период. null — данных нет вовсе (known === 0), а не ноль. */
  value: number | null
  /** known > 0 && known < total: сумма верна снизу, но неполна. Признак
      самостоятельный — он не отменяет ни value, ни ratio. */
  partial: boolean
  known: number
  total: number
  norm: NutrientNorm | null
  /** value / norm.amount. Не обрезается сверху: 1.4 означает 140 %.
      null везде, где сравнивать нельзя. */
  ratio: number | null
  /** Норма есть, у неё есть верхний предел, и сумма его превысила. */
  overUl: boolean
  state: CoverageState
}

/** Доля нормы для уже известного значения. null — сравнивать с этой нормой
    нельзя (comparable: false). Значение не обрезается ни сверху, ни снизу. */
export function normRatio(norm: NutrientNorm, value: number): number | null {
  if (!norm.comparable) return null
  return value / norm.amount
}

/** Покрытие по всем нутриентам NUTRIENT_KEYS, в их порядке. Ключ присутствует
    всегда — отсутствие данных выражается состоянием, а не пропуском строки. */
export function nutrientCoverage(totals: NutrientTotals, norms: NutrientNorms): NutrientCoverage[] {
  return NUTRIENT_KEYS.map(key => {
    const total = totals[key]
    const norm = norms[key] ?? null
    const hasData = total.known > 0
    const value = hasData ? total.value : null
    const partial = total.known > 0 && total.known < total.total

    let state: CoverageState
    if (!hasData) state = 'no-data'
    else if (norm === null) state = 'no-norm'
    else if (!norm.comparable) state = 'not-comparable'
    else state = 'ok'

    const ratio = value !== null && norm !== null ? normRatio(norm, value) : null
    const overUl = value !== null && norm !== null && norm.ul !== undefined && value > norm.ul

    return { key, value, partial, known: total.known, total: total.total, norm, ratio, overUl, state }
  })
}
