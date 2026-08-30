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
import { nutrientCoverage } from '../core/norms.ts'
import type { NutrientCoverage } from '../core/norms.ts'
import { formatNutrientAmount, NO_DATA_TEXT } from '../core/export/format.ts'
import { stanceOf } from '../core/preferences.ts'
import type { MealMinus, MealPlus, MealVerdict } from '../core/verdict.ts'
import {
  NUTRIENT_GROUP, NUTRIENT_GROUP_ORDER, NUTRIENT_TITLE, NUTRIENT_UNIT, SLOT_TITLE, SLOTS
} from '../core/types.ts'
import type {
  DishRating, Item, Kbju, Meal, MealLogEntry, MealStatus, NutrientNorms,
  NutrientTotals, Preferences, ProductIndex, Slot
} from '../core/types.ts'
import RatingEditor from './RatingEditor.tsx'

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
  /** Сумма нутриентов за весь день — единственное, с чем можно сравнивать
      суточные нормы. Процент от нормы по одному приёму был бы неправдой. */
  dayNutrients: NutrientTotals
  /** Суточные нормы из data/norms.yaml. Карта частичная: ключа нет — нормы нет. */
  norms: NutrientNorms
  products: ProductIndex
  /** Книга предпочтений: отметки ингредиентов и оценки блюд. */
  preferences: Preferences
  /** Плюсы и минусы этого приёма — уже посчитаны core/verdict.ts, экран сам
      ничего не пересчитывает. */
  verdict: MealVerdict
  entry: MealLogEntry | undefined
  /** Оценка блюда по горячим следам. undefined — «не оценено». Блок оценки
      вообще не рисуется, пока приём не записан или у блюда нет id. */
  rating: DishRating | undefined
  onRate: (score: number, comment: string) => void
  onClearRating: () => void
  /** Все четыре приёма дня — прогресс дня рисуется сегментами, а не строкой. */
  daySlots: DaySlotProgress[]
  dayEatenKcal: number
  targetKcal: number
  /** Белок, съеденный за день, и цель по нему. Цель 0 или меньше означает
      «цели нет»: строка тогда показывает съеденное без полосы. */
  dayProteinG: number
  targetProteinG: number
  /** Есть ли в дневнике хоть одна запись за сегодня. Пока её нет, выгружать
      нечего, и кнопки выгрузки дня на экране тоже нет: кнопка, которая отдаёт
      пустой CSV, врёт не меньше, чем кнопка, которая ничего не отправляет. */
  hasDayLog: boolean
  onLog: (status: MealStatus, fraction: number) => void
  onUnlog: () => void
  onOpenSettings: () => void
  onOpenWeek: () => void
  onOpenExport: () => void
  onOpenDayExport: () => void
  /** Открыть книгу предпочтений. */
  onOpenBook: () => void
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

/** Книга предпочтений — раскрытая книга: две страницы корешком. Своя иконка,
    а не украденный смысл у настроек — книга ведёт к вкусу, а не к параметрам. */
function BookIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 6.5c-1.5-1-3.5-1.5-5.5-1.5-1 0-1.7.1-2.5.3v12.7c.8-.2 1.5-.3 2.5-.3 2 0 4 .5 5.5 1.5" />
      <path d="M12 6.5c1.5-1 3.5-1.5 5.5-1.5 1 0 1.7.1 2.5.3v12.7c-.8-.2-1.5-.3-2.5-.3-2 0-4 .5-5.5 1.5V6.5Z" />
    </svg>
  )
}

/** Неделя — семь дней столбиками разной высоты: календарной сетки здесь нет,
    шторка отвечает на вопрос «ем ли я как собирался», а не «какое число». */
function WeekIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M4 19h16" />
      <path d="M6.5 16v-3M10 16V8M13.5 16v-5M17 16v-8" />
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

/** Отметка ингредиента из книги предпочтений — точка перед названием, у
    «не ем» ещё и зачёркнутое название. Нейтральный продукт не несёт ничего:
    приложение не прячет и не вычёркивает саму позицию, меню уже приготовлено. */
function ItemRow({ item, products, preferences }: { item: Item; products: ProductIndex; preferences: Preferences }) {
  const product = products.get(item.product)
  const name = product?.name ?? item.product
  const stance = stanceOf(preferences, item.product)
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
      <span className="meal-item__name">
        {stance === 'love' && <span className="stance-dot stance-dot--love" aria-hidden="true" />}
        {stance === 'avoid' && <span className="stance-dot stance-dot--avoid" aria-hidden="true" />}
        <span className={stance === 'avoid' ? 'name--avoided' : undefined}>{name}</span>
      </span>
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

/** Режим списка нутриентов. Нормы суточные, поэтому процент считается только
    за день; «этот приём» показывает те же строки без полос и процентов. */
type NutrientsMode = 'day' | 'meal'

const MODE_LABEL: Record<NutrientsMode, string> = {
  day: 'за день',
  meal: 'этот приём'
}

/** Одна строка покрытия. Что видно и чего не видно в каждом состоянии — таблица
    из DESIGN.md, раздел «Покрытие норм»; отступать от неё нельзя, здесь легче
    всего соврать. `withCoverage === false` — режим приёма: полос и процентов
    нет ни у одной строки, потому что норма суточная. */
function NutrientRow({
  cov, withCoverage, noteOpen, onToggleNote
}: {
  cov: NutrientCoverage
  withCoverage: boolean
  noteOpen: boolean
  onToggleNote: () => void
}) {
  const { key, value, norm, ratio, state } = cov
  const unit = NUTRIENT_UNIT[key]
  const overUl = withCoverage && cov.overUl

  const showBar = withCoverage && state === 'ok' && ratio !== null
  /* Полоса длиннее нормы не обрезается: дорожка растягивается до фактической
     доли, а отметка 100 % остаётся на своём месте и видна. */
  const scale = showBar && ratio > 1 ? ratio : 1

  const hints: string[] = []
  if (cov.partial) hints.push(`сумма по ${cov.known} из ${cov.total} позиций`)
  if (norm?.note) hints.push(norm.note)

  const classes = ['nutrient']
  if (state === 'no-data') classes.push('nutrient--unknown')
  if (cov.partial) classes.push('nutrient--partial')

  const content = (
    <>
      <span className="nutrient__name">{NUTRIENT_TITLE[key]}</span>
      <span className="nutrient__value">
        {value === null ? NO_DATA_TEXT : `${formatNutrientAmount(value)} ${unit}`}
        {showBar && <span className="nutrient__pct">{Math.round(ratio * 100)} %</span>}
        {/* Сравнивать нельзя — вместо выдуманного процента стоит сама норма, а
            причина, по которой процента не будет, раскрыта сноской. */}
        {withCoverage && state === 'not-comparable' && norm !== null && (
          <span className="nutrient__pct">норма {formatNutrientAmount(norm.amount)} {unit}</span>
        )}
      </span>
      {showBar && (
        <span className="nutrient__bar">
          <span
            className={`nutrient__fill${overUl ? ' nutrient__fill--over' : (ratio >= 1 ? ' nutrient__fill--ok' : '')}`}
            style={{ width: `${(ratio / scale) * 100}%` }}
          />
          {scale > 1 && <span className="nutrient__mark" style={{ left: `${(1 / scale) * 100}%` }} />}
        </span>
      )}
      {noteOpen && hints.map((hint, i) => (
        <span key={i} className="nutrient__hint">{hint}</span>
      ))}
    </>
  )

  if (hints.length === 0) {
    return <li className={classes.join(' ')}>{content}</li>
  }
  return (
    <li className="nutrient-row">
      <button
        type="button"
        className={`${classes.join(' ')} nutrient-row__btn`}
        aria-expanded={noteOpen}
        onClick={onToggleNote}
      >
        {content}
      </button>
    </li>
  )
}

/** Покрытие суточных норм: свёрнуто — за сгиб не должны уходить ни приём, ни
    КБЖУ. Строка без данных остаётся в списке со словами «нет данных»: спрятать
    её значило бы сказать «этого в еде нет», а пустая дорожка читалась бы как
    измеренный ноль, поэтому её там нет вовсе. */
function NutrientsBlock({
  dayTotals, mealTotals, norms
}: {
  dayTotals: NutrientTotals
  mealTotals: NutrientTotals
  norms: NutrientNorms
}) {
  /* Раскрытие держим в состоянии, а не отдаём браузеру: иконка рисуется двумя
     разными путями, и React должен знать, какой из них показывать. */
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<NutrientsMode>('day')
  /* Сноска, раскрытая или закрытая рукой. Ключа нет — работает правило по
     умолчанию: то, что объясняет видимое прямо сейчас, раскрыто сразу. */
  const [notes, setNotes] = useState<Record<string, boolean>>({})

  const withCoverage = mode === 'day'
  const rows = nutrientCoverage(withCoverage ? dayTotals : mealTotals, norms)

  const unknown = rows.filter(c => c.state === 'no-data').length
  const partial = rows.filter(c => c.partial).length
  /* Знаменатель — нормы, которые вообще можно набрать: несравнимая норма (вода)
     в счёт не идёт, иначе набрать все было бы невозможно по построению. */
  const comparableNorms = rows.filter(c => c.norm !== null && c.norm.comparable).length
  const met = rows.filter(c => c.ratio !== null && c.ratio >= 1).length

  const summaryHints: string[] = []
  if (withCoverage) summaryHints.push(`набрано ${met} из ${comparableNorms}`)
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

      <div className="meal-nutrients__modes">
        {(['day', 'meal'] as NutrientsMode[]).map(m => (
          <button
            key={m}
            type="button"
            className={`chip chip--tap${m === mode ? ' chip--selected' : ''}`}
            aria-pressed={m === mode}
            onClick={() => setMode(m)}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {!withCoverage && (
        <p className="meal-nutrients__note">нормы суточные — процент показан только за день</p>
      )}

      <div className="meal-nutrients__list">
        {NUTRIENT_GROUP_ORDER.map(group => {
          const groupRows = rows.filter(c => NUTRIENT_GROUP[c.key] === group)
          return (
            <section key={group} className="nutrient-group">
              <h3 className="nutrient-group__title">{group}</h3>
              <ul className="meal-nutrients__rows">
                {groupRows.map(cov => {
                  const autoOpen = cov.norm?.note !== undefined && (
                    cov.state === 'not-comparable'
                    || (withCoverage && cov.overUl)
                    || (withCoverage && cov.value !== null && cov.norm.cdrr !== undefined
                      && cov.value > cov.norm.cdrr)
                  )
                  const noteKey = `${mode}:${cov.key}`
                  return (
                    <NutrientRow
                      key={cov.key}
                      cov={cov}
                      withCoverage={withCoverage}
                      noteOpen={notes[noteKey] ?? autoOpen}
                      onToggleNote={() => setNotes(prev => ({
                        ...prev,
                        [noteKey]: !(prev[noteKey] ?? autoOpen)
                      }))}
                    />
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>
    </details>
  )
}

function productName(id: string, products: ProductIndex): string {
  return products.get(id)?.name ?? id
}

/** Строка плюса — человеческими словами, без ключей и долей в сыром виде. */
function plusLabel(plus: MealPlus, products: ProductIndex): string {
  if (plus.kind === 'loved') {
    return `любимое: ${plus.products.map(id => productName(id, products)).join(', ')}`
  }
  return `${NUTRIENT_TITLE[plus.key]} — ${Math.round(plus.ratio * 100)} % суточной нормы`
}

/** Строка минуса. `low-coverage` и `sodium-cdrr` объясняются отдельно — оба
    легко прочитать неправильно, если оставить голым числом. */
function minusLabel(minus: MealMinus, products: ProductIndex): string {
  switch (minus.kind) {
    case 'avoided':
      return `здесь то, что ты не ешь: ${minus.products.map(id => productName(id, products)).join(', ')}`
    case 'over-ul': {
      const unit = NUTRIENT_UNIT[minus.key]
      return `${NUTRIENT_TITLE[minus.key]} — ${formatNutrientAmount(minus.value)} ${unit}, выше верхнего `
        + `безопасного предела ${formatNutrientAmount(minus.ul)} ${unit}`
    }
    case 'sodium-cdrr':
      return `натрий — ${formatNutrientAmount(minus.value)} мг, выше порога снижения риска `
        + `${formatNutrientAmount(minus.cdrr)} мг (это не предел безопасности — у натрия верхнего предела нет)`
    case 'low-coverage': {
      const missing = minus.total > 0 ? Math.round((1 - minus.known / minus.total) * 100) : 0
      return `данных нет о ${missing} % состава — числам выше можно верить только снизу`
    }
  }
}

/** Плюсы и минусы приёма — DESIGN.md, раздел «Плюсы и минусы приёма». Блок
    рисуется только при наличии, и каждая колонка отдельно: «сказать нечего»
    и «всё плохо» не имеют права выглядеть одинаково. */
function MealVerdictBlock({ verdict, products }: { verdict: MealVerdict; products: ProductIndex }) {
  const { pros, cons } = verdict
  if (pros.length === 0 && cons.length === 0) return null
  return (
    <section className="meal-verdict">
      {pros.length > 0 && (
        <div className="meal-verdict__col">
          <h2 className="meal-verdict__title meal-verdict__title--pro">Плюсы</h2>
          <ul className="meal-verdict__list">
            {pros.map((p, i) => (
              <li key={i} className="meal-verdict__item">{plusLabel(p, products)}</li>
            ))}
          </ul>
        </div>
      )}
      {cons.length > 0 && (
        <div className="meal-verdict__col">
          <h2 className="meal-verdict__title meal-verdict__title--con">Минусы</h2>
          <ul className="meal-verdict__list">
            {cons.map((c, i) => (
              <li key={i} className="meal-verdict__item">{minusLabel(c, products)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export default function MealScreen({
  cycleDayNum, cycleDays, batchDayNum, slot, currentSlot, onSelectSlot,
  meal, mealKbju, mealNutrients, dayNutrients, norms, products, preferences, verdict,
  entry, rating, onRate, onClearRating, daySlots,
  dayEatenKcal, targetKcal, dayProteinG, targetProteinG, hasDayLog,
  onLog, onUnlog, onOpenSettings, onOpenWeek, onOpenExport, onOpenDayExport, onOpenBook
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
        <div className="screen__header-actions">
          <button type="button" className="screen__icon-btn" onClick={onOpenWeek} aria-label="Неделя">
            <WeekIcon />
          </button>
          <button type="button" className="screen__icon-btn" onClick={onOpenBook} aria-label="Книга предпочтений">
            <BookIcon />
          </button>
          <button type="button" className="screen__icon-btn" onClick={onOpenSettings} aria-label="Настройки">
            <SettingsIcon />
          </button>
        </div>
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
                  {containerItems.map((item, i) => <ItemRow key={i} item={item} products={products} preferences={preferences} />)}
                </ul>}
          </section>

          <section className="meal-section">
            <h2 className="meal-section__title">Досыпать из пакетика</h2>
            {packetItems.length === 0
              ? <p className="meal-section__empty">Ничего досыпать не нужно</p>
              : <ul className="meal-item-list">
                  {packetItems.map((item, i) => <ItemRow key={i} item={item} products={products} preferences={preferences} />)}
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

      <MealVerdictBlock verdict={verdict} products={products} />

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
        <DayProtein eatenG={dayProteinG} targetG={targetProteinG} />
      </section>

      <NutrientsBlock dayTotals={dayNutrients} mealTotals={mealNutrients} norms={norms} />

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

      {/* Оценка по горячим следам: только когда приём записан и у блюда есть
          устойчивый id — запись без него нельзя привязать к блюду. */}
      {entry && meal && meal.id !== '' && (
        <section className="meal-rating">
          <h2 className="meal-rating__title">Как было?</h2>
          <RatingEditor rating={rating} onChange={onRate} onClear={onClearRating} />
        </section>
      )}
    </div>
  )
}
