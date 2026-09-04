/* Шторка «Добавить блюдо из другого дня»: перенос блюда меню в выбранный
   день (по умолчанию сегодня) сверх плана. Каркас — общий Sheet.tsx. Доля — тот же словарь FRACTIONS, что и у
   «Съел часть» на главном экране, с добавленным значением 1 («целиком»):
   доля не должна значить разное в разных местах экрана.

   Число складывается кнопкой «Записать», которая зовёт onAdd(fromCycleDay,
   meal, { date, slot }, fraction) — сам снапшот (menuExtraFrom) и запись в
   дневник (addExtra) делает App.tsx: там же живёт productsRevision и
   cycleDayForDate, здесь их нет и быть не должно. */

import { useState } from 'react'
import { mealFor } from '../core/menu.ts'
import { mealKbju as computeMealKbju } from '../core/nutrition.ts'
import { SLOT_TITLE, SLOTS } from '../core/types.ts'
import type { Meal, Menu, ProductIndex, Slot } from '../core/types.ts'
import { FRACTIONS, fractionLabel } from './fractions.ts'
import Sheet from './Sheet.tsx'

interface AddFromMenuSheetProps {
  menu: Menu
  products: ProductIndex
  /** Длина цикла — сколько чипов дней рисовать. */
  cycleDays: number
  /** День цикла, который идёт сегодня — он отмечен среди чипов, но не выбран
      автоматически: перенос обычно берут именно из ДРУГОГО дня. */
  currentCycleDay: number
  /** Дата записи по умолчанию — сегодняшняя; в шторке её можно поменять.
      Выбранная дата определяет и редакцию меню у исходного дня (см. menuDayFor). */
  defaultDate: string
  /** Приём, в который запись попадёт по умолчанию — обычно текущий приём
      экрана, с которого открыта шторка. */
  defaultSlot: Slot
  onAdd: (fromCycleDay: number, meal: Meal, target: { date: string; slot: Slot }, fraction: number) => void
  onClose: () => void
}

/** Доля переноса: то же, что «Съел часть», плюс «целиком» — перенесённое
    блюдо чаще всего съедают полностью, и это обязано быть первым выбором,
    а не спрятанным среди долей приёма. */
const ADD_FRACTIONS: number[] = [1, ...FRACTIONS.map(f => f.value)]

function round(n: number): number {
  return Math.round(n)
}

export default function AddFromMenuSheet({
  menu, products, cycleDays, currentCycleDay, defaultDate, defaultSlot, onAdd, onClose
}: AddFromMenuSheetProps) {
  const [sourceDay, setSourceDay] = useState(currentCycleDay)
  const [sourceSlot, setSourceSlot] = useState<Slot | null>(null)
  const [targetSlot, setTargetSlot] = useState<Slot>(defaultSlot)
  const [targetDate, setTargetDate] = useState(defaultDate)
  const [fraction, setFraction] = useState(1)

  const dayChips = Array.from({ length: cycleDays }, (_, i) => i + 1)

  function handlePickDay(day: number): void {
    setSourceDay(day)
    setSourceSlot(null)
  }

  const selectedMeal = sourceSlot ? mealFor(menu, targetDate, sourceDay, sourceSlot) : undefined
  // Очищенное поле даты отдаёт '' — записывать «в никуда» нельзя.
  const canSubmit = sourceSlot !== null && selectedMeal !== undefined && targetDate !== ''

  function handleSubmit(): void {
    if (!selectedMeal || sourceSlot === null || targetDate === '') return
    onAdd(sourceDay, selectedMeal, { date: targetDate, slot: targetSlot }, fraction)
  }

  return (
    <Sheet title="Добавить блюдо из другого дня" onClose={onClose}>
      <div className="add-from-menu">
        <div className="field">
          <span className="field__label">День цикла</span>
          <div className="add-from-menu__days" role="group" aria-label="День цикла">
            {dayChips.map(day => (
              <button
                key={day}
                type="button"
                className={day === sourceDay ? 'chip chip--tap chip--selected' : 'chip chip--tap'}
                aria-pressed={day === sourceDay}
                onClick={() => handlePickDay(day)}
              >
                {day}
                {day === currentCycleDay && <span className="add-from-menu__today-dot" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Приём в этот день</span>
          <ul className="add-from-menu__slots">
            {SLOTS.map(slot => {
              const meal = mealFor(menu, targetDate, sourceDay, slot)
              const selected = sourceSlot === slot
              return (
                <li key={slot}>
                  <button
                    type="button"
                    className={`add-from-menu__slot${selected ? ' add-from-menu__slot--selected' : ''}${meal ? '' : ' add-from-menu__slot--empty'}`}
                    aria-pressed={selected}
                    disabled={!meal}
                    onClick={() => setSourceSlot(slot)}
                  >
                    <span className="add-from-menu__slot-title">{SLOT_TITLE[slot]}</span>
                    {meal
                      ? <span className="add-from-menu__slot-meal">{meal.title} · {round(computeMealKbju(meal, products).kcal)} ккал</span>
                      : <span className="add-from-menu__slot-empty">в меню на этот день такого приёма нет</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="field">
          <span className="field__label">Доля</span>
          <div className="add-from-menu__fractions" role="group" aria-label="Доля">
            {ADD_FRACTIONS.map(value => (
              <button
                key={value}
                type="button"
                className={value === fraction ? 'chip chip--tap chip--selected nums' : 'chip chip--tap nums'}
                aria-pressed={value === fraction}
                onClick={() => setFraction(value)}
              >
                {fractionLabel(value)}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field__label">Дата записи</span>
          <input
            type="date"
            className="field__input"
            value={targetDate}
            onChange={e => setTargetDate(e.target.value)}
          />
        </label>

        <div className="field">
          <span className="field__label">Записать в приём</span>
          <div className="add-from-menu__target" role="group" aria-label="Целевой приём">
            {SLOTS.map(slot => (
              <button
                key={slot}
                type="button"
                className={slot === targetSlot ? 'chip chip--tap chip--selected' : 'chip chip--tap'}
                aria-pressed={slot === targetSlot}
                onClick={() => setTargetSlot(slot)}
              >
                {SLOT_TITLE[slot]}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="btn btn--primary add-from-menu__submit"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          Записать
        </button>
      </div>
    </Sheet>
  )
}
