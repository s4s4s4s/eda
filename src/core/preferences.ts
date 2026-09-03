/* Книга предпочтений: отношение к ингредиентам и оценки блюд.
   Чистое ядро — ни React, ни DOM, ни localStorage, ни Date.now() внутри функций:
   время приходит параметром (nowIso). Все функции возвращают НОВЫЕ объекты,
   входные аргументы не мутируют.

   Нейтральное состояние ингредиента и «не оценено» у блюда — это ОТСУТСТВИЕ
   записи, а не третье значение: setStance(prefs, id, null) и clearRating
   удаляют ключ, а не пишут undefined. Хранилище не должно копить строки
   «всё равно». */

import type { DishRating, IngredientStance, Meal, Preferences } from './types'

export function emptyPreferences(): Preferences {
  return { ingredients: {}, dishes: {} }
}

export function stanceOf(prefs: Preferences, productId: string): IngredientStance | undefined {
  return prefs.ingredients[productId]
}

/** stance === null снимает отметку: ключ удаляется из объекта, а не получает
    значение undefined — иначе Object.keys начал бы врать о числе отметок. */
export function setStance(prefs: Preferences, productId: string, stance: IngredientStance | null): Preferences {
  const ingredients = { ...prefs.ingredients }
  if (stance === null) {
    delete ingredients[productId]
  } else {
    ingredients[productId] = stance
  }
  return { ...prefs, ingredients }
}

export function ratingOf(prefs: Preferences, mealId: string): DishRating | undefined {
  return prefs.dishes[mealId]
}

/** Балл — целое 1..10, 0 не бывает: «не оценено» значит «записи нет». Пустой
    mealId тоже ошибка — оценка обязана быть привязана к конкретному блюду.

    `ratedAt` двигается вперёд, только когда двигается сам балл (или когда
    оценки раньше не было): правка одного комментария при том же балле не
    должна выглядеть как повторная оценка блюда — иначе набор текста в поле
    комментария перетирал бы время оценки при каждом нажатии клавиши. */
export function rateDish(prefs: Preferences, mealId: string, score: number, comment: string, nowIso: string): Preferences {
  if (mealId === '') {
    throw new Error('rateDish: mealId не может быть пустым')
  }
  if (!Number.isInteger(score) || score < 1 || score > 10) {
    throw new Error(`rateDish: балл должен быть целым числом от 1 до 10, получено ${String(score)}`)
  }
  const prev = prefs.dishes[mealId]
  const ratedAt = prev && prev.score === score ? prev.ratedAt : nowIso
  const dishes = { ...prefs.dishes, [mealId]: { score, comment, ratedAt } }
  return { ...prefs, dishes }
}

export function clearRating(prefs: Preferences, mealId: string): Preferences {
  const dishes = { ...prefs.dishes }
  delete dishes[mealId]
  return { ...prefs, dishes }
}

/** Продукты приёма, разложенные по отметке — в порядке meal.items, без
    повторов (позиция может встречаться дважды, отметка нужна одна). */
export function mealStances(meal: Meal, prefs: Preferences): { loved: string[]; avoided: string[] } {
  const loved: string[] = []
  const avoided: string[] = []
  const seen = new Set<string>()
  for (const item of meal.items) {
    if (seen.has(item.product)) continue
    seen.add(item.product)
    const stance = stanceOf(prefs, item.product)
    if (stance === 'love') loved.push(item.product)
    else if (stance === 'avoid') avoided.push(item.product)
  }
  return { loved, avoided }
}
