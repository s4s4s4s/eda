/* Выбор блюда из меню, собранного редакциями.

   Меню приходит от диетолога порциями, и присланное не переписывает прежнее:
   каждая порция — редакция со своей датой вступления в силу (см. MenuEdition в
   types.ts и шапку data/menu.yaml). Здесь и только здесь живёт правило, по
   которому из нескольких редакций выбирается одна: экраны и проверки ходят
   через эти функции, а не перебирают editions сами. */

import type { Meal, Menu, MenuDay, MenuEdition, Slot } from './types'

/** Действует ли редакция на дату. Базовая (без from) действует всегда: когда
    она вступила в силу, никто не записал, и дату не выдумываем. */
function inForce(edition: MenuEdition, date: string): boolean {
  return edition.from === undefined || edition.from <= date
}

/** План дня цикла на календарную дату вместе с редакцией, из которой он взят.
    Берётся самая свежая из действующих редакций, которая этот день описывает, —
    редакция вправе описывать не весь цикл, и тогда день продолжает браться из
    предыдущей. undefined означает «на эту дату дня нет ни в одной редакции»;
    разбор меню такого не допускает, но экран обязан пережить и это. */
export function menuDayFor(menu: Menu, date: string, cycleDayNum: number): { day: MenuDay; edition: MenuEdition } | undefined {
  for (let i = menu.editions.length - 1; i >= 0; i--) {
    const edition = menu.editions[i]
    if (!inForce(edition, date)) continue
    const day = edition.days.find(d => d.day === cycleDayNum)
    if (day) return { day, edition }
  }
  return undefined
}

/** Приём на дату. Обёртка над menuDayFor: экранам почти всегда нужен именно
    приём, и лишний поиск по слоту в каждом месте — лишний шанс разойтись. */
export function mealFor(menu: Menu, date: string, cycleDayNum: number, slot: Slot): Meal | undefined {
  return menuDayFor(menu, date, cycleDayNum)?.day.meals.find(m => m.slot === slot)
}

/** Где блюдо стоит в цикле: день и приём. */
export interface MealPlace {
  day: number
  slot: Slot
}

/** Блюдо меню вместе со всеми местами, где оно встречается. */
export interface MealEntry {
  meal: Meal
  places: MealPlace[]
}

/** Все блюда всех редакций, по одному на id. Нужно книге предпочтений: человек
    оценивает блюдо, а не редакцию, и список блюд не должен ни двоиться, ни
    терять прошлые.

    Редакции обходятся от старой к новой, поэтому порядок строк — порядок
    первого появления блюда в меню, а сама запись блюда берётся из самой свежей
    редакции, где этот id встречается: человек ищет глазами то, что видит на
    экране сегодня. Место (день + приём) не задваивается, если раскладка блюда
    поменялась, а место осталось прежним.

    Склейка живёт здесь, а не в экране книги: правило выбора редакции одно на
    приложение, и второе его место рано или поздно разойдётся с первым. */
export function allMeals(menu: Menu): MealEntry[] {
  const byId = new Map<string, MealEntry>()
  for (const edition of menu.editions) {
    for (const day of edition.days) {
      for (const meal of day.meals) {
        const entry = byId.get(meal.id)
        if (entry === undefined) {
          byId.set(meal.id, { meal, places: [{ day: day.day, slot: meal.slot }] })
          continue
        }
        entry.meal = meal
        if (!entry.places.some(p => p.day === day.day && p.slot === meal.slot)) {
          entry.places.push({ day: day.day, slot: meal.slot })
        }
      }
    }
  }
  return [...byId.values()]
}
