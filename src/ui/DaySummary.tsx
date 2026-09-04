/* Сводка дня — новый главный экран (DESIGN.md, «Навигация: сводка первая»).
   Сверху вниз: прогресс дня (перенесён из MealScreen.tsx без изменений),
   четыре карточки приёмов со статусом и кнопкой «Съел» у незаписанных,
   «Добавлено» с двумя кнопками (перенесён без изменений разметки и
   aria-label — на них завязан сценарий снимков), микронутриенты за день. */

import { SLOT_TITLE, SLOTS } from '../core/types.ts'
import type { ExtraLogEntry, MealStatus, NutrientNorms, NutrientTotals, Slot } from '../core/types.ts'
import { fractionLabel } from './fractions.ts'
import { NutrientsBlock } from './NutrientsBlock.tsx'
import { SLOT_TIME_RANGE, STATUS_LABEL } from './slots.ts'
import type { DaySlotProgress } from './slots.ts'

interface DaySummaryProps {
  daySlots: DaySlotProgress[]
  /** Приём, который идёт сейчас по времени суток — карточка отмечается
      пометкой «сейчас». */
  currentSlot: Slot
  onSelectSlot: (slot: Slot) => void
  /** Пишет приём целиком, не открывая его (кнопка «Съел» в карточке
      незаписанного приёма). Тот же обработчик, что и у панели действий на
      экране приёма — принимает слот явно (App.tsx). */
  onLog: (slot: Slot, status: MealStatus, fraction: number) => void
  dayEatenKcal: number
  targetKcal: number
  /** Белок, съеденный за день, и цель по нему. Цель 0 или меньше означает
      «цели нет»: строка тогда показывает съеденное без полосы. */
  dayProteinG: number
  targetProteinG: number
  /** Есть ли в дневнике хоть одна запись за сегодня. Пока её нет, выгружать
      нечего, и кнопки выгрузки дня на экране тоже нет. */
  hasDayLog: boolean
  onOpenDayExport: () => void
  /** Съеденное сверх меню за сегодня — перенесённые блюда и своя еда. */
  extras: ExtraLogEntry[]
  onRemoveExtra: (extraId: string) => void
  onOpenAddFromMenu: () => void
  onOpenCustomFood: () => void
  dayNutrients: NutrientTotals
  norms: NutrientNorms
  productsRevision: string
}

function round(n: number): number {
  return Math.round(n)
}

/** Прогресс дня сегментами по четырём приёмам. Ширина сегмента — доля приёма в
    плане дня, заливка — съеденное. Записанный приём отличается от просто
    запланированного рамкой: пропущенный записан честно, а не «ещё не ел». */
function DayProgress({ slots }: { slots: DaySlotProgress[] }) {
  return (
    <div className="day-progress__bar">
      {slots.map(s => {
        const filledKcal = s.eatenKcal + s.extrasKcal
        const ratio = s.plannedKcal > 0
          ? Math.min(1, filledKcal / s.plannedKcal)
          : (filledKcal > 0 ? 1 : 0)
        const status = s.status
        let label = status !== undefined
          ? `${SLOT_TITLE[s.slot]}: ${STATUS_LABEL[status]}, ${round(s.eatenKcal)} из ${round(s.plannedKcal)} ккал`
          : `${SLOT_TITLE[s.slot]}: не записан, в плане ${round(s.plannedKcal)} ккал`
        if (s.extrasKcal > 0) label += `, + добавлено ${round(s.extrasKcal)} ккал`
        return (
          <div
            key={s.slot}
            className={`day-progress__seg${status !== undefined ? ' day-progress__seg--logged' : ''}`}
            style={{ flexGrow: s.plannedKcal > 0 ? s.plannedKcal : 1 }}
            role="img"
            aria-label={label}
            title={label}
          >
            <span className="day-progress__fill" style={{ width: `${ratio * 100}%` }} />
          </div>
        )
      })}
    </div>
  )
}

/** Белок к цели. Полоса — тот же примитив, что у нутриентов: цель по белку
    ничем не отличается от нормы, и рисоваться должна так же. Цели нет —
    полосы нет: дорожка без цели показывала бы долю от неизвестно чего. */
function DayProtein({ eatenG, targetG }: { eatenG: number; targetG: number }) {
  const hasTarget = targetG > 0
  const ratio = hasTarget ? eatenG / targetG : 0
  const done = ratio >= 1
  return (
    <div className="day-protein">
      <span className="day-protein__value nums">
        {hasTarget ? `Белок ${round(eatenG)} / ${round(targetG)} г` : `Белок ${round(eatenG)} г`}
      </span>
      {hasTarget && (
        <span className="nutrient__bar">
          <span
            className={`nutrient__fill${done ? ' nutrient__fill--ok' : ''}`}
            style={{ width: `${Math.min(1, ratio) * 100}%` }}
          />
        </span>
      )}
    </div>
  )
}

/** Строка статуса карточки приёма — что видно, зависит от того, записан ли
    приём и как: план в ккал у незаписанного, съеденное у записанного,
    «пропустил» без чисел (пропущенный приём в план дня не засчитан). */
function cardStatusLine(p: DaySlotProgress): string {
  if (p.status === undefined) return `не записан · план ${round(p.plannedKcal)} ккал`
  if (p.status === 'skipped') return 'пропустил'
  if (p.status === 'partial') {
    const share = p.fraction !== undefined ? fractionLabel(p.fraction) : ''
    return `съел ${share} · ${round(p.eatenKcal)} ккал`
  }
  return `съел · ${round(p.eatenKcal)} ккал`
}

/** Карточка одного приёма. `<article>`, а не `<button>`: внутри две кнопки —
    «открыть» (заголовок с названием и статусом) и «Съел» у незаписанного
    приёма, кнопка в кнопке невалидна. «Съел» пишет приём целиком, не открывая
    его — быстрый путь для «поел по плану, отмечать нечего». */
function DayMealCard({
  progress, isCurrent, onSelectSlot, onLog
}: {
  progress: DaySlotProgress
  isCurrent: boolean
  onSelectSlot: (slot: Slot) => void
  onLog: (slot: Slot, status: MealStatus, fraction: number) => void
}) {
  const slot = progress.slot
  return (
    <article className={`day-meal${progress.status !== undefined ? ' day-meal--logged' : ''}`}>
      <button type="button" className="day-meal__open" onClick={() => onSelectSlot(slot)}>
        <span className="day-meal__head">
          <span className="day-meal__title">{SLOT_TITLE[slot]}</span>
          <span className="day-meal__time nums">{SLOT_TIME_RANGE[slot]}</span>
          {isCurrent && <span className="day-meal__now">сейчас</span>}
        </span>
        {progress.title !== undefined && <span className="day-meal__dish">{progress.title}</span>}
        <span className="day-meal__status nums">{cardStatusLine(progress)}</span>
      </button>
      {/* Кнопка есть только пока приём не записан и на него есть блюдо в меню:
          без блюда писать нечего — handleLog в App.tsx выходит без записи,
          и кнопка выглядела бы рабочей, ничего не делая. При status === undefined
          title берётся только из меню, так что это и есть проверка «блюдо есть». */}
      {progress.status === undefined && progress.title !== undefined && (
        <button
          type="button"
          className="day-meal__log"
          aria-label={`Съел: ${SLOT_TITLE[slot]}`}
          onClick={() => onLog(slot, 'eaten', 1)}
        >
          Съел
        </button>
      )}
    </article>
  )
}

export default function DaySummary({
  daySlots, currentSlot, onSelectSlot, onLog,
  dayEatenKcal, targetKcal, dayProteinG, targetProteinG,
  hasDayLog, onOpenDayExport, extras, onRemoveExtra, onOpenAddFromMenu, onOpenCustomFood,
  dayNutrients, norms, productsRevision
}: DaySummaryProps) {
  return (
    <>
      <section className="day-progress">
        <div className="day-progress__head">
          <span className="day-progress__value nums">
            {round(dayEatenKcal)} из {targetKcal} ккал за день
          </span>
          {hasDayLog && (
            <button type="button" className="day-progress__export" onClick={onOpenDayExport}>
              выгрузить день
            </button>
          )}
        </div>
        <DayProgress slots={daySlots} />
        <DayProtein eatenG={dayProteinG} targetG={targetProteinG} />
      </section>

      <ul className="day-meals">
        {SLOTS.map(s => {
          const progress = daySlots.find(d => d.slot === s)
          if (!progress) return null
          return (
            <li key={s}>
              <DayMealCard
                progress={progress}
                isCurrent={s === currentSlot}
                onSelectSlot={onSelectSlot}
                onLog={onLog}
              />
            </li>
          )
        })}
      </ul>

      {/* Съеденное сверх меню: не трогает статус приёмов, поэтому живёт
          отдельным блоком под прогрессом дня, а не внутри одного из сегментов. */}
      <section className="day-extras">
        {extras.length > 0 && (
          <>
            <h2 className="day-extras__title">Добавлено</h2>
            <ul className="day-extras__list">
              {extras.map(e => (
                <li key={e.id} className="day-extras__item">
                  <span className="day-extras__name">{e.title}</span>
                  <span className="day-extras__meta nums">
                    {fractionLabel(e.fraction)} · {round(e.kbju.kcal * e.fraction)} ккал ·{' '}
                    {e.kind === 'menu'
                      ? `день ${e.fromCycleDay}, ${SLOT_TITLE[e.fromSlot].toLowerCase()}`
                      : 'своя еда'}
                  </span>
                  <button
                    type="button"
                    className="day-extras__remove"
                    onClick={() => onRemoveExtra(e.id)}
                  >
                    убрать
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="day-extras__actions">
          <button
            type="button"
            className="btn btn--secondary"
            aria-label="Добавить блюдо из другого дня"
            onClick={onOpenAddFromMenu}
          >
            Добавить блюдо из другого дня
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            aria-label="Своя еда"
            onClick={onOpenCustomFood}
          >
            Своя еда
          </button>
        </div>
      </section>

      <NutrientsBlock
        dayTotals={dayNutrients}
        mealTotals={dayNutrients}
        norms={norms}
        hasMeal={false}
        hasEntry={false}
        daySlots={daySlots}
        productsRevision={productsRevision}
        extras={extras}
        modes={['day']}
      />
    </>
  )
}
