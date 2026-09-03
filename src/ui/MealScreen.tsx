/* Главный экран. Порядок блоков сверху вниз — контракт из DESIGN.md, раздел
   «Иерархия главного экрана»: шапка → переключатель приёмов → название приёма →
   состав двумя раздельными списками → сборка → КБЖУ → день → микронутриенты →
   липкая панель действий. Правило иерархии: сначала еда, потом числа — человек
   открывает экран, чтобы узнать, что положить в тарелку. */

import { useState } from 'react'
import {
  BREAKFAST_START_MIN, DINNER_START_MIN, formatDateFull, LUNCH_START_MIN, SNACK_START_MIN
} from '../core/cycle.ts'
import { addNutrientTotals, itemGrams } from '../core/nutrition.ts'
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
  /** Доля записанного приёма — та же величина, что и `MealLogEntry.fraction`.
      Нужна, чтобы строка-подпись под «Микронутриентами» могла написать
      «обед (½)» так же, как подписаны варианты в панели действий. Пока
      `status === undefined`, значение не читается. */
  fraction: number | undefined
  /** Ревизия справочника, по которой посчитан снапшот этой записи — та же
      величина, что и `MealLogEntry.productsRevision`. undefined значит либо
      «слот не записан», либо «запись сделана до появления ревизии» — оба
      случая читаются одинаково: по каким числам считано, неизвестно. */
  productsRevision: string | undefined
}

interface MealScreenProps {
  /** ISO-дата показываемого дня (YYYY-MM-DD) — шапка выводит её словами. */
  date: string
  cycleDayNum: number
  cycleDays: number
  batchDayNum: number
  slot: Slot
  /** Приём, который идёт сейчас по времени суток. Отмечается точкой в
      переключателе — это отдельный признак от выбранного вручную. */
  currentSlot: Slot
  onSelectSlot: (slot: Slot) => void
  meal: Meal | undefined
  /** КБЖУ приёма — из меню, если оно есть, иначе из снапшота записи
      (entry.kbju), иначе undefined. undefined — не «нули», а «нечего
      показать»: карточка КБЖУ в этом случае не рисуется вовсе. */
  mealKbju: Kbju | undefined
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
  /** Текущая ревизия справочника продуктов (data/products.yaml, поле revision).
      Сравнивается с `entry.productsRevision`/`DaySlotProgress.productsRevision`:
      справочник правится, а снапшот записи — нет, и расхождение стоит
      показать, а не спрятать за одинаково выглядящими числами. */
  productsRevision: string
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
  /** Дата первого дня цикла (Settings.cycleStartDate) — баннер первого
      запуска печатает её словами, а не выдуманным «сегодня — день 1»: дата
      подставлена при установке и может уже разойтись с сегодня. */
  cycleStartDate: string
  /** Подтверждена ли дата первого дня цикла. Пока false, над содержимым
      висит баннер первого запуска (см. DESIGN.md). */
  cycleStartConfirmed: boolean
  /** Кнопка «Всё верно» в баннере первого запуска — дату не трогает. */
  onConfirmCycleStart: () => void
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
    за день или за проекцию дня; «этот приём» показывает те же строки без
    полос и процентов.
    - `day` — сумма записанных в дневник приёмов.
    - `projected` — та же сумма плюс текущий приём целиком, то есть каким
      станет день, если его съесть. Существует только пока текущий приём
      есть в меню и ещё не записан — записанный приём день уже содержит.
    - `meal` — только текущий приём, без процентов: сравнивать его с
      суточной нормой было бы враньём. */
type NutrientsMode = 'day' | 'projected' | 'meal'

const MODE_LABEL: Record<NutrientsMode, string> = {
  day: 'за день',
  projected: 'с этим приёмом',
  meal: 'этот приём'
}

/** Доля приёма человеческими словами — тот же словарь долей, что и в
    панели действий (`FRACTIONS`), чтобы «½» значило одно и то же везде. */
function fractionLabel(fraction: number): string {
  return FRACTIONS.find(f => f.value === fraction)?.label ?? String(fraction)
}

/** Строка-подпись под чипами режимов: что именно вошло в сумму. `day` и
    `projected` перечисляют записанные слоты дня по порядку `SLOTS`,
    приём со статусом «съел часть» — с долей; `projected` дописывает
    текущий приём отдельно, потому что он в дневник ещё не попал.

    Если среди записанных слотов дня есть хоть один со снапшотом по чужой или
    отсутствующей ревизии справочника, подпись коротко предупреждает об этом:
    подробности — в meal-revision-note у самой записи (см. `revisionNote`),
    здесь только флаг, что день считает по смеси справочников. */
function nutrientsCaption(mode: NutrientsMode, daySlots: DaySlotProgress[], productsRevision: string): string {
  if (mode === 'meal') return ''
  const loggedSlots = daySlots.filter(s => s.status !== undefined)
  const parts = loggedSlots.map(s => {
    const name = SLOT_TITLE[s.slot].toLowerCase()
    /* Пропущенный приём в дневнике есть, а в сумме его нет — назвать его
       просто «записано: обед» значило бы сказать, что обед в числах. */
    if (s.status === 'skipped') return `${name} (пропущен)`
    if (s.status === 'partial' && s.fraction !== undefined) return `${name} (${fractionLabel(s.fraction)})`
    return name
  })
  const base = parts.length > 0 ? `записано: ${parts.join(', ')}` : 'за день пока ничего не записано'
  const withProjected = mode === 'projected' ? `${base} + этот приём (не записан)` : base
  // Пропущенный приём в сумму дня не входит (см. комментарий выше и
  // scaleNutrientTotals) — его ревизия справочника не влияет на то, по каким
  // числам посчитана сама сумма, и не должна включать оговорку о смеси
  // справочников. Проверяем только слоты, реально вошедшие в сумму.
  const hasOldRevision = loggedSlots.some(s => s.status !== 'skipped' && s.productsRevision !== productsRevision)
  return hasOldRevision ? `${withProjected} · часть записей по прежнему справочнику` : withProjected
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
  /* AI (адекватное потребление) — не то же самое, что RDA: это ориентир там,
     где источнику не хватило данных на полноценную норму, а не измеренная
     потребность. Суффикс у процента виден сразу, сноска объясняет его смысл
     тому, кто нажмёт строку. */
  if (norm?.basis === 'ai') hints.push('AI — адекватное потребление: ориентир, а не норма; данных на RDA у источника не хватило')

  const classes = ['nutrient']
  if (state === 'no-data') classes.push('nutrient--unknown')
  if (cov.partial) classes.push('nutrient--partial')

  const content = (
    <>
      <span className="nutrient__name">{NUTRIENT_TITLE[key]}</span>
      <span className="nutrient__value">
        {value === null ? NO_DATA_TEXT : `${formatNutrientAmount(value)} ${unit}`}
        {showBar && (
          <span className="nutrient__pct">
            {Math.round(ratio * 100)} %
            {norm?.basis === 'ai' && <span className="nutrient__basis">AI</span>}
          </span>
        )}
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
  dayTotals, mealTotals, norms, hasMeal, hasEntry, daySlots, productsRevision
}: {
  dayTotals: NutrientTotals
  mealTotals: NutrientTotals
  norms: NutrientNorms
  /** Есть ли блюдо на этот приём в меню — без него нечего проецировать. */
  hasMeal: boolean
  /** Записан ли текущий приём в дневник (в том числе «съел часть» — доля
      уже входит в `dayTotals`, и проекция была бы двойным счётом). */
  hasEntry: boolean
  /** Все четыре слота дня — источник строки-подписи «записано: …». */
  daySlots: DaySlotProgress[]
  /** Текущая ревизия справочника — нужна подписи, чтобы заметить смесь
      справочников в записях дня (см. nutrientsCaption). */
  productsRevision: string
}) {
  /* Раскрытие держим в состоянии, а не отдаём браузеру: иконка рисуется двумя
     разными путями, и React должен знать, какой из них показывать. */
  const [open, setOpen] = useState(false)
  /* `projected` существует, только пока приём есть и ещё не записан: тогда
     день без него ничего не объясняет, и это разумный режим по умолчанию.
     Записанный приём день уже содержит — по умолчанию открываем `day`. */
  const showProjected = hasMeal && !hasEntry
  const [mode, setMode] = useState<NutrientsMode>(showProjected ? 'projected' : 'day')
  /* Сноска, раскрытая или закрытая рукой. Ключа нет — работает правило по
     умолчанию: то, что объясняет видимое прямо сейчас, раскрыто сразу. */
  const [notes, setNotes] = useState<Record<string, boolean>>({})

  const modes: NutrientsMode[] = showProjected ? ['day', 'projected', 'meal'] : ['day', 'meal']
  /* Режим мог перестать существовать (приём записали, пока панель была
     открыта) — родитель пересоздаёт блок через key при смене приёма или дня,
     но не при смене статуса записи того же приёма, поэтому подстраховка нужна
     здесь: невозможный режим откатывается на `day`, а не показывает проекцию
     задним числом. */
  const effectiveMode: NutrientsMode = modes.includes(mode) ? mode : 'day'

  const withCoverage = effectiveMode === 'day' || effectiveMode === 'projected'
  const totals = effectiveMode === 'day'
    ? dayTotals
    : effectiveMode === 'projected'
      ? addNutrientTotals(dayTotals, mealTotals)
      : mealTotals
  const rows = nutrientCoverage(totals, norms)

  const unknown = rows.filter(c => c.state === 'no-data').length
  const partial = rows.filter(c => c.partial).length
  /* Знаменатель — нормы, которые вообще можно набрать: несравнимая норма (вода)
     в счёт не идёт, иначе набрать все было бы невозможно по построению. */
  const comparableNorms = rows.filter(c => c.norm !== null && c.norm.comparable).length
  const met = rows.filter(c => c.ratio !== null && c.ratio >= 1).length

  const summaryHints: string[] = []
  if (withCoverage) {
    /* «Набрано 0 из 26» на дне без единой записи звучит как измеренный ноль —
       на деле измерять было нечего. `projected` сюда не попадает: приём в
       проекции уже есть, и unknown === rows.length означал бы, что и он без
       единого известного нутриента, — тогда доля набранного честна как есть. */
    if (effectiveMode === 'day' && unknown === rows.length) {
      summaryHints.push('данных за день нет')
    } else {
      summaryHints.push(`набрано ${met} из ${comparableNorms}`)
    }
  }
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
        {modes.map(m => (
          <button
            key={m}
            type="button"
            className={`chip chip--tap${m === effectiveMode ? ' chip--selected' : ''}`}
            aria-pressed={m === effectiveMode}
            onClick={() => setMode(m)}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {effectiveMode === 'meal'
        ? <p className="meal-nutrients__note">нормы суточные — процент показан только за день</p>
        : <p className="meal-nutrients__note">{nutrientsCaption(effectiveMode, daySlots, productsRevision)}</p>}

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
                  const noteKey = `${effectiveMode}:${cov.key}`
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

/** Строка плюса — человеческими словами, без ключей и долей в сыром виде.
    Норма с основанием AI (адекватное потребление) — не суточная норма в
    строгом смысле, и текст обязан это сказать: «% суточной нормы» для неё
    было бы враньём того же рода, что «набрано 0 из 26» на пустом дне. */
function plusLabel(plus: MealPlus, products: ProductIndex, norms: NutrientNorms): string {
  if (plus.kind === 'loved') {
    return `любимое: ${plus.products.map(id => productName(id, products)).join(', ')}`
  }
  const pct = Math.round(plus.ratio * 100)
  const isAi = norms[plus.key]?.basis === 'ai'
  return isAi
    ? `${NUTRIENT_TITLE[plus.key]} — ${pct} % ориентира (AI)`
    : `${NUTRIENT_TITLE[plus.key]} — ${pct} % суточной нормы`
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
    и «всё плохо» не имеют права выглядеть одинаково.

    Заголовки и сам факт наличия блока зависят от того, что именно посчитано:
    - приём пропущен (`entry.status === 'skipped'`) — считать нечего вообще
      (App.tsx отдаёт `verdict` пустым), и вместо колонок одна строка;
    - «съел часть» — вердикт посчитан по доле снапшота, заголовки называют
      это прямо («Плюсы съеденного (½)»), а не «Плюсы приёма», который читался
      бы как весь приём целиком;
    - «съел целиком» и «ещё не записан» — заголовки как раньше: съеденное
      целиком неотличимо от приёма, а не начатое — это и есть приём. */
function MealVerdictBlock({
  verdict, products, norms, entry
}: {
  verdict: MealVerdict
  products: ProductIndex
  norms: NutrientNorms
  entry: MealLogEntry | undefined
}) {
  if (entry && entry.status === 'skipped') {
    return (
      <section className="meal-verdict">
        <p className="meal-verdict__skipped">приём пропущен — плюсов и минусов нет</p>
      </section>
    )
  }

  const { pros, cons } = verdict
  if (pros.length === 0 && cons.length === 0) return null

  const partialSuffix = entry && entry.status === 'partial' ? ` (${fractionLabel(entry.fraction)})` : ''
  const prosTitle = partialSuffix ? `Плюсы съеденного${partialSuffix}` : 'Плюсы приёма'
  const consTitle = partialSuffix ? `Минусы съеденного${partialSuffix}` : 'Минусы приёма'

  return (
    <section className="meal-verdict">
      {pros.length > 0 && (
        <div className="meal-verdict__col">
          <h2 className="meal-verdict__title meal-verdict__title--pro">{prosTitle}</h2>
          <ul className="meal-verdict__list">
            {pros.map((p, i) => (
              <li key={i} className="meal-verdict__item">{plusLabel(p, products, norms)}</li>
            ))}
          </ul>
        </div>
      )}
      {cons.length > 0 && (
        <div className="meal-verdict__col">
          <h2 className="meal-verdict__title meal-verdict__title--con">{consTitle}</h2>
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
  date, cycleDayNum, cycleDays, batchDayNum, slot, currentSlot, onSelectSlot,
  meal, mealKbju, mealNutrients, dayNutrients, norms, products, preferences, verdict,
  entry, productsRevision, rating, onRate, onClearRating, daySlots,
  dayEatenKcal, targetKcal, dayProteinG, targetProteinG, hasDayLog,
  cycleStartDate, cycleStartConfirmed, onConfirmCycleStart,
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
        <div className="screen__header-lines">
          <div className="screen__date-line">{formatDateFull(date)}</div>
          <div className="screen__day-line nums">
            <span>День {cycleDayNum} из {cycleDays}</span>
            <span className="screen__day-line-sep">·</span>
            <span>партия: день {batchDayNum} из 4</span>
          </div>
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

      {!cycleStartConfirmed && (
        <div className="cycle-start-notice" role="status">
          <p className="cycle-start-notice__text">
            {/* Дата подставлена при установке и могла разойтись с сегодня —
                баннер печатает факт из data, а не застывшую фразу «сегодня —
                день 1», которая перестаёт быть правдой уже через сутки. */}
            Дата первого дня цикла подставлена при установке: {formatDateFull(cycleStartDate)}.
            Сегодня по ней — день {cycleDayNum} из {cycleDays}.
            Если цикл начался в другой день — поправь дату.
          </p>
          <div className="cycle-start-notice__actions">
            <button type="button" className="btn btn--secondary" onClick={onOpenSettings}>
              Открыть настройки
            </button>
            <button type="button" className="btn btn--primary" onClick={onConfirmCycleStart}>
              Всё верно
            </button>
          </div>
        </div>
      )}

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
        <h1 className="meal-title__name">{meal ? meal.title : (entry ? entry.title : SLOT_TITLE[slot])}</h1>
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
          {/* Меню на приём пропало (правка меню, перенос блюда), а запись в
              дневнике осталась — заголовок правдив, но не из меню, и это
              стоит сказать явно. */}
          {!meal && entry && <span className="meal-title__now">из записи в дневнике</span>}
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

      <MealVerdictBlock verdict={verdict} products={products} norms={norms} entry={entry} />

      {/* Ни меню, ни записи на этот приём нет — карточке взяться неоткуда,
          рисовать нули под видом чисел нельзя (см. DESIGN.md, «Честность»). */}
      {mealKbju && (
        <div className="meal-kbju card">
          <div className="meal-kbju__kcal nums">{round(mealKbju.kcal)} ккал</div>
          <div className="meal-kbju__bju nums">
            Б {round(mealKbju.p)} · Ж {round(mealKbju.f)} · У {round(mealKbju.c)}
          </div>
        </div>
      )}

      {/* Справочник продуктов правится (смена fdcId, новые нутриенты), а
          снапшот записи — нет: числа записи и живого меню посчитаны по
          разным справочникам, и это стоит сказать рядом с числами записи, а
          не молчать под видом одинаковых цифр. Совпадает ревизия — строки
          нет вовсе. */}
      {entry && entry.productsRevision !== productsRevision && (
        <p className="meal-revision-note">
          {entry.productsRevision === undefined
            ? 'Запись сделана до того, как приложение стало помечать ревизию справочника; '
              + 'по каким числам она посчитана — неизвестно.'
            : `Запись от ${formatDateFull(date)} посчитана по справочнику от `
              + `${formatDateFull(entry.productsRevision)}; сейчас справочник от `
              + `${formatDateFull(productsRevision)}. Записанное не пересчитывается.`}
        </p>
      )}

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

      <NutrientsBlock
        dayTotals={dayNutrients}
        mealTotals={mealNutrients}
        norms={norms}
        hasMeal={meal !== undefined}
        hasEntry={entry !== undefined}
        daySlots={daySlots}
        productsRevision={productsRevision}
      />

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
