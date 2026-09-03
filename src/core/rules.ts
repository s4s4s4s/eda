/* Проверка меню на соответствие нормам порций и калорийности. Все пороги — в
   LIMITS ниже, правь их только здесь. Правило на приём молчит, если продукта
   с нужным тегом в приёме нет вовсе — это не нарушение, а «блюдо без этого
   ингредиента сегодня». Правила на день безусловны. */

import { dayKbju, itemGrams, mealKbju } from './nutrition'
import { SLOT_TITLE } from './types'
import type { Item, Meal, Menu, MenuDay, MenuEdition, Product, ProductIndex, Slot, Violation } from './types'

export const LIMITS = {
  /** Ровные нормы порций по тегу продукта, граммы. */
  portionG: {
    fish: 170,
    chicken: 170,
    turkey: 170,
    beef: 190,
    grain: 130,
    tvorog: 150,
    'greek-yogurt': 200,
    nuts: 40
  } as Record<string, number>,
  legumesG: { min: 100, max: 120 },
  brazilPieces: 2,
  /* Лён, чиа и масло сравниваются в ГРАММАХ, а не в ложках, хотя нормы заданы
     диетологом ложками. Ложка — мера записи, а не свойство еды: то же масло
     можно записать и «1 ст. л.», и «13.5 г», и проверка, считающая только поле
     tbsp, на втором варианте молча увидела бы ноль и отрапортовала «масла нет».
     Числа ниже — те же нормы, переведённые по мерам самого справочника:
     лён 1 ст. л. = 7 г, чиа 2 ст. л. = 12 г каждая, масло 3 ст. л. = 13.5 г каждая. */
  flaxG: 7,
  chiaG: 24,
  dayOilG: 40.5,
  dayBerriesG: 125,
  dayKcal: { min: 3050, max: 3350, target: 3200 },
  mealKcalMin: { breakfast: 800, lunch: 800, dinner: 800, snack: 350 } as Record<Slot, number>,
  /** Допуск на сравнение граммов/ложек/штук — защита от плавающей точки, не поблажка. */
  gramsTolerance: 0.5,
  /** Допуск на сравнение калорий — та же защита. */
  kcalTolerance: 1
} as const

const TAG_LABEL: Record<string, string> = {
  fish: 'рыба',
  chicken: 'курица',
  turkey: 'индейка',
  beef: 'говядина',
  grain: 'крупа',
  legumes: 'бобовые',
  tvorog: 'творог',
  'greek-yogurt': 'греческий йогурт',
  nuts: 'орехи',
  brazil: 'бразильский орех',
  flax: 'лён',
  chia: 'чиа',
  oil: 'масло',
  berries: 'ягоды'
}

function label(tag: string): string {
  return TAG_LABEL[tag] ?? tag
}

function itemsWithTag(meal: Meal, products: ProductIndex, tag: string): { item: Item; product: Product }[] {
  const result: { item: Item; product: Product }[] = []
  for (const item of meal.items) {
    const product = products.get(item.product)
    if (product && product.tags.includes(tag)) result.push({ item, product })
  }
  return result
}

function sumTagGrams(meal: Meal, products: ProductIndex, tag: string, exclude?: string): number {
  return itemsWithTag(meal, products, tag)
    .filter(({ product }) => !exclude || !product.tags.includes(exclude))
    .reduce((acc, { item }) => acc + itemGrams(item, products), 0)
}

function sumTagPieces(meal: Meal, products: ProductIndex, tag: string): number {
  return itemsWithTag(meal, products, tag).reduce((acc, { item }) => acc + (item.pieces ?? 0), 0)
}

function mealScope(day: number, slot: Slot): Violation['scope'] {
  return { kind: 'meal', day, slot }
}

function dayScope(day: number): Violation['scope'] {
  return { kind: 'day', day }
}

/** Точная норма по граммам: молчит, если тега в приёме нет (сумма 0). */
function checkExactGrams(
  meal: Meal, day: number, products: ProductIndex, tag: string, norm: number, rule: string, exclude?: string
): Violation | null {
  const actual = sumTagGrams(meal, products, tag, exclude)
  if (actual <= LIMITS.gramsTolerance) return null
  if (Math.abs(actual - norm) <= LIMITS.gramsTolerance) return null
  return {
    rule,
    scope: mealScope(day, meal.slot),
    message: `День ${day}, ${SLOT_TITLE[meal.slot]}: ${label(tag)} ${round(actual)} г, норма ${norm} г`
  }
}

function checkRangeGrams(
  meal: Meal, day: number, products: ProductIndex, tag: string, min: number, max: number, rule: string
): Violation | null {
  const actual = sumTagGrams(meal, products, tag)
  if (actual <= LIMITS.gramsTolerance) return null
  if (actual >= min - LIMITS.gramsTolerance && actual <= max + LIMITS.gramsTolerance) return null
  return {
    rule,
    scope: mealScope(day, meal.slot),
    message: `День ${day}, ${SLOT_TITLE[meal.slot]}: ${label(tag)} ${round(actual)} г, норма ${min}–${max} г`
  }
}

function checkExactPieces(meal: Meal, day: number, products: ProductIndex, tag: string, norm: number, rule: string): Violation | null {
  const actual = sumTagPieces(meal, products, tag)
  if (itemsWithTag(meal, products, tag).length === 0) return null
  if (Math.abs(actual - norm) <= LIMITS.gramsTolerance) return null
  return {
    rule,
    scope: mealScope(day, meal.slot),
    message: `День ${day}, ${SLOT_TITLE[meal.slot]}: ${label(tag)} ${round(actual)} шт., норма ${norm} шт.`
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function checkMeal(meal: Meal, day: number, products: ProductIndex): Violation[] {
  const violations: Violation[] = []

  for (const tag of ['fish', 'chicken', 'turkey', 'beef', 'tvorog', 'greek-yogurt'] as const) {
    const v = checkExactGrams(meal, day, products, tag, LIMITS.portionG[tag], `portion.${tag}`)
    if (v) violations.push(v)
  }

  // крупа: только в обед и ужин — на завтрак это каша, у неё своя норма
  if (meal.slot === 'lunch' || meal.slot === 'dinner') {
    const v = checkExactGrams(meal, day, products, 'grain', LIMITS.portionG.grain, 'portion.grain')
    if (v) violations.push(v)
  }

  const legumes = checkRangeGrams(meal, day, products, 'legumes', LIMITS.legumesG.min, LIMITS.legumesG.max, 'portion.legumes')
  if (legumes) violations.push(legumes)

  // орехи без бразильского — у бразильского своя норма (штуки, а не граммы)
  const nuts = checkExactGrams(meal, day, products, 'nuts', LIMITS.portionG.nuts, 'portion.nuts', 'brazil')
  if (nuts) violations.push(nuts)

  const brazil = checkExactPieces(meal, day, products, 'brazil', LIMITS.brazilPieces, 'portion.brazil')
  if (brazil) violations.push(brazil)

  const flax = checkExactGrams(meal, day, products, 'flax', LIMITS.flaxG, 'portion.flax')
  if (flax) violations.push(flax)

  const chia = checkExactGrams(meal, day, products, 'chia', LIMITS.chiaG, 'portion.chia')
  if (chia) violations.push(chia)

  return violations
}

function checkMealCalories(meal: Meal, day: number, products: ProductIndex): Violation[] {
  const kbju = mealKbju(meal, products)
  const min = LIMITS.mealKcalMin[meal.slot]
  if (kbju.kcal < min - LIMITS.kcalTolerance) {
    return [{
      rule: 'meal.kcal.low',
      scope: mealScope(day, meal.slot),
      message: `День ${day}, ${SLOT_TITLE[meal.slot]}: ${round(kbju.kcal)} ккал, минимум ${min} ккал`
    }]
  }
  return []
}

function checkDayOil(day: MenuDay, products: ProductIndex): Violation[] {
  const total = day.meals.reduce((acc, meal) => acc + sumTagGrams(meal, products, 'oil'), 0)
  if (Math.abs(total - LIMITS.dayOilG) <= LIMITS.gramsTolerance) return []
  return [{
    rule: 'day.oil',
    scope: dayScope(day.day),
    message: `День ${day.day}: масло ${round(total)} г за день, норма ${LIMITS.dayOilG} г`
  }]
}

function checkDayBerries(day: MenuDay, products: ProductIndex): Violation[] {
  const violations: Violation[] = []
  const perMeal = day.meals.map(meal => ({ meal, grams: sumTagGrams(meal, products, 'berries') }))
  const total = perMeal.reduce((acc, m) => acc + m.grams, 0)
  const mealsWithBerries = perMeal.filter(m => m.grams > LIMITS.gramsTolerance).length

  if (Math.abs(total - LIMITS.dayBerriesG) > LIMITS.gramsTolerance) {
    violations.push({
      rule: 'day.berries.amount',
      scope: dayScope(day.day),
      message: `День ${day.day}: ягоды ${round(total)} г за день, норма ${LIMITS.dayBerriesG} г`
    })
  }
  if (mealsWithBerries !== 1) {
    violations.push({
      rule: 'day.berries.spread',
      scope: dayScope(day.day),
      message: `День ${day.day}: ягоды встречаются в ${mealsWithBerries} приёмах, должны быть ровно в одном`
    })
  }
  return violations
}

function checkDayFlax(day: MenuDay, products: ProductIndex): Violation[] {
  const hasFlax = day.meals.some(meal => itemsWithTag(meal, products, 'flax').length > 0)
  if (hasFlax) return []
  return [{
    rule: 'day.flax.missing',
    scope: dayScope(day.day),
    message: `День ${day.day}: в дне нет льна ни в одном приёме`
  }]
}

function checkDayCalories(day: MenuDay, products: ProductIndex): Violation[] {
  const kbju = dayKbju(day, products)
  const { min, max } = LIMITS.dayKcal
  if (kbju.kcal < min - LIMITS.kcalTolerance) {
    return [{
      rule: 'day.kcal.low',
      scope: dayScope(day.day),
      message: `День ${day.day}: ${round(kbju.kcal)} ккал за день, ниже коридора ${min}–${max} ккал`
    }]
  }
  if (kbju.kcal > max + LIMITS.kcalTolerance) {
    return [{
      rule: 'day.kcal.high',
      scope: dayScope(day.day),
      message: `День ${day.day}: ${round(kbju.kcal)} ккал за день, выше коридора ${min}–${max} ккал`
    }]
  }
  return []
}

export function checkDay(day: MenuDay, products: ProductIndex): Violation[] {
  const violations: Violation[] = []

  for (const meal of day.meals) {
    violations.push(...checkMeal(meal, day.day, products))
    violations.push(...checkMealCalories(meal, day.day, products))
  }

  violations.push(...checkDayOil(day, products))
  violations.push(...checkDayBerries(day, products))
  violations.push(...checkDayFlax(day, products))
  violations.push(...checkDayCalories(day, products))

  return violations
}

/** Проверяет одну редакцию меню. Редакция — это то, что диетолог прислал одной
    порцией, и разбирать нарушения имеет смысл именно по ней: «в новой неделе
    крупа 80 г вместо 130» — сообщение о неделе, а не о дне вообще. */
export function checkEdition(edition: MenuEdition, products: ProductIndex): Violation[] {
  return edition.days.flatMap(day => checkDay(day, products))
}

/** Проверяет все редакции подряд. Дни с одинаковым номером из разных редакций
    проверяются каждый сам по себе: они и есть разные раскладки одного дня. */
export function checkMenu(menu: Menu, products: ProductIndex): Violation[] {
  return menu.editions.flatMap(edition => checkEdition(edition, products))
}
