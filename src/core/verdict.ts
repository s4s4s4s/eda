/* Плюсы и минусы одного приёма — DESIGN.md, раздел «Плюсы и минусы приёма».
   Чистое ядро — ни React, ни DOM, ни localStorage.

   Правила заданы в DESIGN.md и здесь не изобретаются заново:
   - плюс: нутриент закрывает >= 30 % суточной нормы (не более пяти, по убыванию
     доли) либо ингредиент отмечен «люблю»;
   - минус: ингредиент отмечен «не ем»; нутриент перешёл верхний безопасный
     предел за один приём; натрий выше порога CDRR (это не предел безопасности,
     у натрия его нет); больше половины состава без данных.
   «Мало кальция в завтраке» минусом не является — норма суточная, а не на приём. */

import { mealStances } from './preferences'
import { NUTRIENT_KEYS } from './types'
import type { Meal, NutrientKey, NutrientNorms, NutrientTotals, Preferences } from './types'

/** Доля суточной нормы, с которой нутриент засчитывается плюсом приёма. */
export const PLUS_RATIO = 0.30
/** Не больше стольки нутриентных плюсов в одном приёме — иначе список тонет. */
export const MAX_PLUS_NUTRIENTS = 5
/** Ниже этой доли известных нутриентов состав приёма считается недостоверным. */
export const MIN_COVERAGE = 0.5

export type MealPlus =
  | { kind: 'nutrient'; key: NutrientKey; ratio: number }
  | { kind: 'loved'; products: string[] }

export type MealMinus =
  | { kind: 'avoided'; products: string[] }
  | { kind: 'over-ul'; key: NutrientKey; value: number; ul: number }
  | { kind: 'sodium-cdrr'; value: number; cdrr: number }
  | { kind: 'low-coverage'; known: number; total: number }

export interface MealVerdict {
  pros: MealPlus[]
  cons: MealMinus[]
}

function nutrientPluses(nutrients: NutrientTotals, norms: NutrientNorms): MealPlus[] {
  const candidates: { key: NutrientKey; ratio: number }[] = []
  for (const key of NUTRIENT_KEYS) {
    const norm = norms[key]
    if (norm === undefined || !norm.comparable) continue
    const total = nutrients[key]
    if (total.known === 0) continue
    const ratio = total.value / norm.amount
    if (ratio >= PLUS_RATIO) candidates.push({ key, ratio })
  }
  candidates.sort((a, b) => b.ratio - a.ratio)
  return candidates.slice(0, MAX_PLUS_NUTRIENTS).map(c => ({ kind: 'nutrient', key: c.key, ratio: c.ratio }))
}

function overUlMinuses(nutrients: NutrientTotals, norms: NutrientNorms): MealMinus[] {
  const result: MealMinus[] = []
  for (const key of NUTRIENT_KEYS) {
    const norm = norms[key]
    if (norm === undefined || norm.ul === undefined) continue
    const total = nutrients[key]
    if (total.known === 0) continue
    if (total.value > norm.ul) {
      result.push({ kind: 'over-ul', key, value: total.value, ul: norm.ul })
    }
  }
  return result
}

function sodiumMinus(nutrients: NutrientTotals, norms: NutrientNorms): MealMinus | null {
  const norm = norms.sodium
  if (norm === undefined || norm.cdrr === undefined) return null
  const total = nutrients.sodium
  if (total.known === 0) return null
  if (total.value > norm.cdrr) {
    return { kind: 'sodium-cdrr', value: total.value, cdrr: norm.cdrr }
  }
  return null
}

/** Полнота состава приёма — по сумме known/total ВСЕХ нутриентов, а не по
    одному: одна недостающая позиция не должна красить весь приём минусом. */
function coverageMinus(nutrients: NutrientTotals): MealMinus | null {
  let known = 0
  let total = 0
  for (const key of NUTRIENT_KEYS) {
    known += nutrients[key].known
    total += nutrients[key].total
  }
  if (total === 0) return null
  if (known / total < MIN_COVERAGE) {
    return { kind: 'low-coverage', known, total }
  }
  return null
}

export function mealVerdict(meal: Meal, nutrients: NutrientTotals, norms: NutrientNorms, prefs: Preferences): MealVerdict {
  const { loved, avoided } = mealStances(meal, prefs)

  const pros: MealPlus[] = [...nutrientPluses(nutrients, norms)]
  if (loved.length > 0) pros.push({ kind: 'loved', products: loved })

  const cons: MealMinus[] = []
  if (avoided.length > 0) cons.push({ kind: 'avoided', products: avoided })
  cons.push(...overUlMinuses(nutrients, norms))
  const sodium = sodiumMinus(nutrients, norms)
  if (sodium !== null) cons.push(sodium)
  const coverage = coverageMinus(nutrients)
  if (coverage !== null) cons.push(coverage)

  return { pros, cons }
}
