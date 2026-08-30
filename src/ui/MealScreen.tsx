/* Главный экран. Порядок блоков сверху вниз — контракт из DESIGN.md, раздел
   «Иерархия главного экрана»: шапка → переключатель приёмов → название приёма →
   состав двумя раздельными списками → сборка → КБЖУ → день → микронутриенты →
   липкая панель действий. Правило иерархии: сначала еда, потом числа — человек
   открывает экран, чтобы узнать, что положить в тарелку. */

import { useState } from 'react'
import {
  BREAKFAST_START_MIN, DINNER_START_MIN, LUNCH_START_MIN, SNACK_START_MIN
} from '../core/cycle.ts'
import { itemGrams } from '../core/nutrition.ts'
import { formatNutrientAmount, NO_DATA_TEXT } from '../core/export/format.ts'
import { NUTRIENT_KEYS, NUTRIENT_TITLE, NUTRIENT_UNIT, SLOT_TITLE, SLOTS } from '../core/types.ts'
import type { Item, Kbju, Meal, MealLogEntry, MealStatus, NutrientTotals, ProductIndex, Slot } from '../core/types.ts'

/** Состояние одного приёма в прогрессе дня. Запланированное берётся из меню,
    съеденное — из дневника с уже применённой долей. `status === undefined`
    означает «ещё не записан», и это не то же самое, что «пропущен». */
export interface DaySlotProgress {
  slot: Slot
  plannedKcal: number
  eatenKcal: number
  status: MealStatus | undefined
}

interface MealScreenProps {
  cycleDayNum: number
  cycleDays: number
  batchDayNum: number
  slot: Slot
  /** Приём, который идёт сейчас по времени суток. Отмечается точкой в
      переключателе — это отдельный признак от выбранного вручную. */
  currentSlot: Slot
  onSelectSlot: (slot: Slot) => void
  meal: Meal | undefined
  mealKbju: Kbju
  /** Сумма нутриентов приёма вместе с полнотой: неизвестное здесь не ноль. */
  mealNutrients: NutrientTotals
  products: ProductIndex
  entry: MealLogEntry | undefined
  /** Все четыре приёма дня — прогресс дня рисуется сегментами, а не строкой. */
  daySlots: DaySlotProgress[]
  dayEatenKcal: number
  targetKcal: number
  /** Есть ли в дневнике хоть одна запись за сегодня. Пока её нет, выгружать
      нечего, и кнопки выгрузки дня на экране тоже нет: кнопка, которая отдаёт
      пустой CSV, врёт не меньше, чем кнопка, которая ничего не отправляет. */
  hasDayLog: boolean
  onLog: (status: MealStatus, fraction: number) => void
  onUnlog: () => void
  onOpenSettings: () => void
  onOpenExport: () => void
  onOpenDayExport: () => void
}

const FRACTIONS: { value: number; label: string }[] = [
  { value: 0.75, label: '3/4' },
  { value: 0.5, label: '1/2' },
  { value: 0.25, label: '1/4' }
]

const STATUS_LABEL: Record<MealStatus, string> = {
  eaten: 'Съедено целиком',
  partial: 'Съедена часть',
  skipped: 'Пропущено'
}

function round(n: number): number {
  return Math.round(n)
}

function minutesToClock(min: number): string {
  const h = Math.floor(min / 60) % 24
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const SLOT_TIME_RANGE: Record<Slot, string> = {
  breakfast: `${minutesToClock(BREAKFAST_START_MIN)}–${minutesToClock(LUNCH_START_MIN)}`,
  lunch: `${minutesToClock(LUNCH_START_MIN)}–${minutesToClock(DINNER_START_MIN)}`,
  dinner: `${minutesToClock(DINNER_START_MIN)}–${minutesToClock(SNACK_START_MIN)}`,
  snack: `${minutesToClock(SNACK_START_MIN)}–${minutesToClock(BREAKFAST_START_MIN)}`
}

/* Иконки — inline SVG в currentColor, размер в em: эмодзи-глифы (⚙, ▸) каждая
   система рисует по-своему, часть шрифтов подставляет цветную картинку, и в
   интерфейсе это читается как заглушка. */

function SettingsIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2.2" />
      <circle cx="9" cy="17" r="2.2" />
    </svg>
  )
}

/** Шеврон свёрнутого/раскрытого списка. Направление задаётся разной геометрией,
    а не поворотом: `prefers-reduced-motion` выключает transform целиком, и
    повёрнутая иконка перестала бы отличать раскрытое от свёрнутого. */
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={open ? 'M6 9.5 12 15.5 18 9.5' : 'M9.5 6 15.5 12 9.5 18'} />
    </svg>
  )
}

/** Количество позиции ровно в том виде, в каком оно задано в меню: граммы,
    штуки или ложки — не переводим штуки/ложки в граммы в основной строке. */
function quantityLabel(item: Item): string {
  if (item.g !== undefined) return `${round(item.g)} г`
  if (item.pieces !== undefined) return `${item.pieces} шт`
  if (item.tbsp !== undefined) return `${item.tbsp} ст. л.`
  return ''
}

function ItemRow({ item, products }: { item: Item; products: ProductIndex }) {
  const product = products.get(item.product)
  const name = product?.name ?? item.product
  const needsGramHint = item.pieces !== undefined || item.tbsp !== undefined
  let gramHint: string | null = null
  if (needsGramHint) {
    try {
      gramHint = `≈ ${round(itemGrams(item, products))} г`
    } catch {
      gramHint = null
    }
  }
  return (
    <li className="meal-item">
      <span className="meal-item__name">{name}</span>
      <span className="meal-item__qty nums">
        {quantityLabel(item)}
        {gramHint && <span className="meal-item__qty-hint">{gramHint}</span>}
      </span>
    </li>
  )
}

/** Прогресс дня сегментами по четырём приёмам. Ширина сегмента — доля приёма в
    плане дня, заливка — съеденное. Записанный приём отличается от просто
    запланированного рамкой: пропущенный записан честно, а не «ещё не ел». */
function DayProgress({ slots }: { slots: DaySlotProgress[] }) {
  return (
    <div className="day-progress__bar">
      {slots.map(s => {
        const ratio = s.plannedKcal > 0
          ? Math.min(1, s.eatenKcal / s.plannedKcal)
          : (s.eatenKcal > 0 ? 1 : 0)
        const status = s.status
        const label = status !== undefined
          ? `${SLOT_TITLE[s.slot]}: ${STATUS_LABEL[status]}, ${round(s.eatenKcal)} из ${round(s.plannedKcal)} ккал`
          : `${SLOT_TITLE[s.slot]}: не записан, в плане ${round(s.plannedKcal)} ккал`
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

/** Микронутриенты приёма: свёрнуты по умолчанию — за сгиб не должны уходить ни
    приём, ни КБЖУ. Строка неизвестного нутриента остаётся в списке со словами
    «нет данных»: спрятать её значило бы сказать «этого в еде нет». */
function NutrientsBlock({ totals }: { totals: NutrientTotals }) {
  /* Раскрытие держим в состоянии, а не отдаём браузеру: иконка рисуется двумя
     разными путями, и React должен знать, какой из них показывать. */
  const [open, setOpen] = useState(false)

  const unknown = NUTRIENT_KEYS.filter(key => totals[key].known === 0).length
  const partial = NUTRIENT_KEYS.filter(key => {
    const t = totals[key]
    return t.known > 0 && t.known < t.total
  }).length

  const summaryHints: string[] = []
  if (partial > 0) summaryHints.push(`неполных ${partial}`)
  if (unknown > 0) summaryHints.push(`без данных ${unknown}`)

  return (
    <details
      className="meal-nutrients"
      open={open}
      onToggle={event => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="meal-nutrients__summary">
        <ChevronIcon open={open} />
        Микронутриенты
        {summaryHints.length > 0 && (
          <span className="meal-nutrients__summary-hint nums">{summaryHints.join(' · ')}</span>
        )}
      </summary>
      <ul className="meal-nutrients__list">
        {NUTRIENT_KEYS.map(key => {
          const total = totals[key]
          const known = total.known > 0
          const complete = known && total.known === total.total
          return (
            <li key={key} className={`meal-nutrient${known ? '' : ' meal-nutrient--unknown'}`}>
              <span className="meal-nutrient__name">{NUTRIENT_TITLE[key]}</span>
              <span className="meal-nutrient__value nums">
                {known ? `${formatNutrientAmount(total.value)} ${NUTRIENT_UNIT[key]}` : NO_DATA_TEXT}
                {known && !complete && (
                  <span className="meal-nutrient__hint">по {total.known} из {total.total} позиций</span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

export default function MealScreen({
  cycleDayNum, cycleDays, batchDayNum, slot, currentSlot, onSelectSlot,
  meal, mealKbju, mealNutrients, products, entry, daySlots, dayEatenKcal, targetKcal, hasDayLog,
  onLog, onUnlog, onOpenSettings, onOpenExport, onOpenDayExport
}: MealScreenProps) {
  const [pickingFraction, setPickingFraction] = useState(false)

  const containerItems = meal ? meal.items.filter(i => i.where === 'container') : []
  const packetItems = meal ? meal.items.filter(i => i.where === 'packet') : []
  const isCurrentSlot = slot === currentSlot

  function handlePartial(fraction: number): void {
    setPickingFraction(false)
    onLog('partial', fraction)
  }

  return (
    <div className="screen">
      <header className="screen__header">
        <div className="screen__day-line nums">
          <span>День {cycleDayNum} из {cycleDays}</span>
          <span className="screen__day-line-sep">·</span>
          <span>партия: день {batchDayNum} из 4</span>
        </div>
        <button type="button" className="screen__settings-btn" onClick={onOpenSettings} aria-label="Настройки">
          <SettingsIcon />
        </button>
      </header>

      <nav className="slot-switch">
        {SLOTS.map(s => (
          <button
            key={s}
            type="button"
            className={`slot-switch__btn${s === slot ? ' slot-switch__btn--active' : ''}`}
            aria-pressed={s === slot}
            onClick={() => onSelectSlot(s)}
          >
            {SLOT_TITLE[s]}
            {/* Точка — «этот приём идёт сейчас». Заливка — «этот выбран».
                Два разных признака: они могут стоять на разных кнопках. */}
            {s === currentSlot && <span className="slot-switch__now-dot" aria-label="сейчас" />}
          </button>
        ))}
      </nav>

      <div className="meal-title">
        <h1 className="meal-title__name">{meal ? meal.title : SLOT_TITLE[slot]}</h1>
        <div className="meal-title__meta">
          <span className="meal-title__time nums">{SLOT_TIME_RANGE[slot]}</span>
          {isCurrentSlot
            ? <span className="meal-title__now">сейчас</span>
            : (
              /* Ручной выбор виден и отпускается вручную; сам он отпускается,
                 когда по времени наступает следующий приём (см. App.tsx). */
              <button type="button" className="meal-title__back" onClick={() => onSelectSlot(currentSlot)}>
                вернуться к текущему
              </button>
            )}
        </div>
      </div>

      {!meal && (
        <div className="meal-missing">Меню на этот приём не найдено</div>
      )}

      {meal && (
        <>
          <section className="meal-section">
            <h2 className="meal-section__title">Уже в контейнере</h2>
            {containerItems.length === 0
              ? <p className="meal-section__empty">Пусто</p>
              : <ul className="meal-item-list">
                  {containerItems.map((item, i) => <ItemRow key={i} item={item} products={products} />)}
                </ul>}
          </section>

          <section className="meal-section">
            <h2 className="meal-section__title">Досыпать из пакетика</h2>
            {packetItems.length === 0
              ? <p className="meal-section__empty">Ничего досыпать не нужно</p>
              : <ul className="meal-item-list">
                  {packetItems.map((item, i) => <ItemRow key={i} item={item} products={products} />)}
                </ul>}
          </section>

          {meal.steps.length > 0 && (
            <section className="meal-section">
              <h2 className="meal-section__title">Сборка</h2>
              <ol className="meal-steps">
                {meal.steps.map((step, i) => <li key={i}>{step}</li>)}
              </ol>
            </section>
          )}
        </>
      )}

      <div className="meal-kbju card">
        <div className="meal-kbju__kcal nums">{round(mealKbju.kcal)} ккал</div>
        <div className="meal-kbju__bju nums">
          Б {round(mealKbju.p)} · Ж {round(mealKbju.f)} · У {round(mealKbju.c)}
        </div>
      </div>

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
      </section>

      {meal && <NutrientsBlock totals={mealNutrients} />}

      {(meal || entry) && (
        <div className="meal-actions">
          {entry
            ? (
              <div className="meal-actions__recorded">
                <span className="meal-actions__recorded-label">
                  {STATUS_LABEL[entry.status]}{entry.status === 'partial' ? ` (${FRACTIONS.find(f => f.value === entry.fraction)?.label ?? entry.fraction})` : ''}
                </span>
                <div className="meal-actions__main">
                  <button type="button" className="btn btn--ghost" onClick={onUnlog}>Отменить запись</button>
                  <button type="button" className="btn btn--secondary" onClick={onOpenExport}>Выгрузить</button>
                </div>
              </div>
            )
            : (
              <>
                {!pickingFraction && meal && (
                  <div className="meal-actions__main">
                    <button type="button" className="btn btn--primary" onClick={() => onLog('eaten', 1)}>Съел</button>
                    <button type="button" className="btn btn--secondary" onClick={() => setPickingFraction(true)}>Съел часть</button>
                    <button type="button" className="btn btn--ghost" onClick={() => onLog('skipped', 0)}>Пропустил</button>
                  </div>
                )}
                {pickingFraction && (
                  <div className="meal-actions__fractions">
                    {FRACTIONS.map(f => (
                      <button key={f.value} type="button" className="btn btn--secondary nums" onClick={() => handlePartial(f.value)}>
                        {f.label}
                      </button>
                    ))}
                    <button type="button" className="btn btn--ghost" onClick={() => setPickingFraction(false)}>Отмена</button>
                  </div>
                )}
              </>
            )}
        </div>
      )}
    </div>
  )
}
