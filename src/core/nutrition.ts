/* Чистая арифметика КБЖУ. Никакого округления — это забота UI. */

import { NUTRIENT_KEYS } from './types'
import type { Item, Kbju, Meal, MenuDay, NutrientKey, Nutrients, NutrientTotal, NutrientTotals, Product, ProductIndex } from './types'

function requireProduct(id: string, products: ProductIndex): Product {
  const p = products.get(id)
  if (!p) throw new Error(`Неизвестный продукт: ${id}`)
  return p
}

/** Граммы позиции: из g, либо pieces*pieceG, либо tbsp*tbspG. */
export function itemGrams(item: Item, products: ProductIndex): number {
  const product = requireProduct(item.product, products)
  if (item.g !== undefined) return item.g
  if (item.pieces !== undefined) {
    if (product.pieceG === undefined) {
      throw new Error(`Продукт «${product.name}» не имеет веса штуки (pieceG), но позиция задана в штуках`)
    }
    return item.pieces * product.pieceG
  }
  if (item.tbsp !== undefined) {
    if (product.tbspG === undefined) {
      throw new Error(`Продукт «${product.name}» не имеет веса ложки (tbspG), но позиция задана в ложках`)
    }
    return item.tbsp * product.tbspG
  }
  throw new Error(`У позиции продукта «${product.name}» не задано количество`)
}

/** КБЖУ позиции: per100 * граммы / 100, без округления. */
export function itemKbju(item: Item, products: ProductIndex): Kbju {
  const product = requireProduct(item.product, products)
  const grams = itemGrams(item, products)
  const factor = grams / 100
  return {
    kcal: product.per100.kcal * factor,
    p: product.per100.p * factor,
    f: product.per100.f * factor,
    c: product.per100.c * factor
  }
}

export function addKbju(a: Kbju, b: Kbju): Kbju {
  return { kcal: a.kcal + b.kcal, p: a.p + b.p, f: a.f + b.f, c: a.c + b.c }
}

export function scaleKbju(kbju: Kbju, fraction: number): Kbju {
  return { kcal: kbju.kcal * fraction, p: kbju.p * fraction, f: kbju.f * fraction, c: kbju.c * fraction }
}

const ZERO_KBJU: Kbju = { kcal: 0, p: 0, f: 0, c: 0 }

export function mealKbju(meal: Meal, products: ProductIndex): Kbju {
  return meal.items.reduce((acc, item) => addKbju(acc, itemKbju(item, products)), ZERO_KBJU)
}

export function dayKbju(day: MenuDay, products: ProductIndex): Kbju {
  return day.meals.reduce((acc, meal) => addKbju(acc, mealKbju(meal, products)), ZERO_KBJU)
}

/* ---- микронутриенты ----

   Считаются теми же граммами, что и КБЖУ (itemGrams), но складываются иначе:
   отсутствие числа у позиции нельзя прибавить как ноль — сумма тогда занизится
   молча. Поэтому сумма несёт полноту (см. NutrientTotal в types.ts): value
   складывает только известные значения, known считает, из скольких позиций они
   взяты, total — сколько позиций вошло всего. */

/** Нутриенты позиции: micro100 * граммы / 100. Отсутствующий у продукта ключ
    отсутствует и здесь — подставлять ноль запрещено. */
export function itemNutrients(item: Item, products: ProductIndex): Nutrients {
  const product = requireProduct(item.product, products)
  const factor = itemGrams(item, products) / 100
  const result: Nutrients = {}
  for (const key of NUTRIENT_KEYS) {
    const per100 = product.micro100[key]
    if (per100 === undefined) continue
    result[key] = per100 * factor
  }
  return result
}

/** Пустая сумма: все ключи есть, но ни одного известного значения и ни одной
    позиции. Нейтральный элемент для addNutrientTotals. */
export function emptyNutrientTotals(): NutrientTotals {
  const totals = {} as NutrientTotals
  for (const key of NUTRIENT_KEYS) {
    totals[key] = { value: 0, known: 0, total: 0 }
  }
  return totals
}

/** Добавляет к сумме одну позицию: total растёт всегда, value и known — только
    там, где у позиции есть число. */
export function addItemToTotals(totals: NutrientTotals, nutrients: Nutrients): NutrientTotals {
  const result = {} as NutrientTotals
  for (const key of NUTRIENT_KEYS) {
    const acc = totals[key]
    const value = nutrients[key]
    result[key] = value === undefined
      ? { value: acc.value, known: acc.known, total: acc.total + 1 }
      : { value: acc.value + value, known: acc.known + 1, total: acc.total + 1 }
  }
  return result
}

export function addNutrientTotals(a: NutrientTotals, b: NutrientTotals): NutrientTotals {
  const result = {} as NutrientTotals
  for (const key of NUTRIENT_KEYS) {
    const x = a[key]
    const y = b[key]
    result[key] = { value: x.value + y.value, known: x.known + y.known, total: x.total + y.total }
  }
  return result
}

/** Доля съеденного меняет числа, но НЕ полноту: половина приёма известна ровно
    настолько же, насколько был известен целый. */
export function scaleNutrientTotals(totals: NutrientTotals, fraction: number): NutrientTotals {
  const result = {} as NutrientTotals
  for (const key of NUTRIENT_KEYS) {
    const t = totals[key]
    result[key] = { value: t.value * fraction, known: t.known, total: t.total }
  }
  return result
}

/** Известно ли значение хоть от одной позиции. Голое `value > 0` не годится:
    честный ноль из датасета — тоже знание. */
export function isKnown(total: NutrientTotal): boolean {
  return total.known > 0
}

export function isComplete(total: NutrientTotal): boolean {
  return total.total > 0 && total.known === total.total
}

export function mealNutrients(meal: Meal, products: ProductIndex): NutrientTotals {
  return meal.items.reduce(
    (acc, item) => addItemToTotals(acc, itemNutrients(item, products)),
    emptyNutrientTotals()
  )
}

export function dayNutrients(day: MenuDay, products: ProductIndex): NutrientTotals {
  return day.meals.reduce(
    (acc, meal) => addNutrientTotals(acc, mealNutrients(meal, products)),
    emptyNutrientTotals()
  )
}

/** Ключи с полнотой ниже полной — для экрана и отчётов. */
export function incompleteNutrients(totals: NutrientTotals): NutrientKey[] {
  return NUTRIENT_KEYS.filter(key => !isComplete(totals[key]))
}
