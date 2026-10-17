/* Сводка дня - главный экран (DESIGN.md, «Навигация: сводка первая» и
   «Иерархия сводки дня»). Сверху вниз: герой-карточка (кольцо калорий и три
   полосы макросов), четыре карточки приёмов со статусом и кнопкой «Съел» у
   незаписанных (только при включённом цикле меню), «Журнал дня» с долей у
   каждой записи и очередью заказов по наклейкам, липкая панель действий
   («Сфоткать наклейку», «Своя еда»), микронутриенты за день.

   Зрительный центр ровно один - кольцо: «сколько осталось» читается с одного
   взгляда, остальное на экране мельче него. Честность (DESIGN.md, «Честность -
   часть дизайна») задаёт, чего на экране НЕ будет: цели нет - заливки кольца
   нет; плана меню нет - полосы макроса нет, остаётся число; приём пропущен -
   чисел у него нет вовсе, потому что в план дня он не засчитан. Ничего не
   поздравляет: набранная цель - это заливка кольца, а не фраза. */

import { useState } from 'react'
import { labelEnergyWarning } from '../core/food.ts'
import { SLOT_TITLE, SLOTS } from '../core/types.ts'
import type {
  CustomFood, ExtraLogEntry, FoodRequest, MealLogEntry, MealStatus, NutrientNorms, NutrientTotals, Slot
} from '../core/types.ts'
import { FractionPicker } from './FractionPicker.tsx'
import { fractionLabel } from './fractions.ts'
import MacroBar from './MacroBar.tsx'
import { NutrientsBlock } from './NutrientsBlock.tsx'
import RequestStatus from './RequestStatus.tsx'
import type { RequestActionResult } from './RequestStatus.tsx'
import Ring from './Ring.tsx'
import SlotIcon from './SlotIcon.tsx'
import { SLOT_TIME_RANGE } from './slots.ts'
import type { DaySlotProgress } from './slots.ts'

/** Система координат кольца (viewBox SVG) и толщина дуги в ней. Экранный
    размер задают токены --ring-size и --ring-size-wide в theme.css; SVG
    масштабируется вместе с рамкой. Числа здесь совпадают с узким размером,
    чтобы толщина дуги в px читалась буквально. */
const RING_SIZE = 184
const RING_STROKE = 14

interface DaySummaryProps {
  daySlots: DaySlotProgress[]
  /** Приём, который идёт сейчас по времени суток - карточка отмечается
      пометкой «сейчас». */
  currentSlot: Slot
  onSelectSlot: (slot: Slot) => void
  /** Пишет приём целиком, не открывая его (кнопка «Съел» в карточке
      незаписанного приёма). Тот же обработчик, что и у панели действий на
      экране приёма - принимает слот явно (App.tsx). */
  onLog: (slot: Slot, status: MealStatus, fraction: number) => void
  dayEatenKcal: number
  targetKcal: number
  /** Белок, съеденный за день, и цель по нему. Цель 0 или меньше означает
      «цели нет»: строка тогда показывает съеденное без полосы. */
  dayProteinG: number
  targetProteinG: number
  /* Жиры и углеводы за день - съеденное (с учётом extras, как и белок) и
     план меню на день по четырём приёмам. Цели по ним в настройках нет и
     выдумывать её нельзя (DESIGN.md, «Честность - часть дизайна»), поэтому
     знаменателем у них работает план, а не норма, и подпись под полосой это
     проговаривает: «из плана меню». Числа считает App.tsx. */
  dayFatG: number
  dayCarbsG: number
  dayPlannedFatG: number
  dayPlannedCarbsG: number
  /** Есть ли в дневнике хоть одна запись за сегодня. Пока её нет, выгружать
      нечего, и кнопки выгрузки дня на экране тоже нет. */
  hasDayLog: boolean
  onOpenDayExport: () => void
  /** Съеденное сверх меню за сегодня - перенесённые блюда и своя еда. */
  extras: ExtraLogEntry[]
  onRemoveExtra: (extraId: string) => void
  onOpenAddFromMenu: () => void
  onOpenCustomFood: () => void
  dayNutrients: NutrientTotals
  norms: NutrientNorms
  productsRevision: string

  /* Новые пропсы под наклейки. Все необязательные: без них сводка ведёт себя
     как раньше (цикл включён, кнопки съёмки нет, доля не правится). */

  /** Включён ли цикл меню (Settings.menuCycleEnabled). По умолчанию true.
      Выключен: нет карточек приёмов и кнопки «Добавить блюдо из другого дня»,
      а знаменатель жиров и углеводов берётся из целей, а не из плана меню. */
  menuCycleEnabled?: boolean
  /** Цели по жирам и углеводам, г/сут (Settings.targetFatG/targetCarbsG),
      0 или не задано = цели нет. Используются только при выключенном цикле. */
  targetFatG?: number
  targetCarbsG?: number
  /** Книга своей еды (AppState.customFoods): из неё берутся номер блюда и
      сверка 4/9/4 для записей kind === 'label'. Без неё этих строк нет. */
  customFoods?: Record<string, CustomFood>
  /** Незавершённые заказы по наклейкам любой даты (kind === 'label', статусы
      pending, failed, expired), в порядке показа. Заказ, отправленный перед
      полуночью, и протухший за сутки (expired) датированы не сегодняшним днём,
      но кнопки «Переснять» и «Убрать» нужны именно им, поэтому дата заказа
      сводку не фильтрует. Готовые заказы сюда не передаются: они уже стали
      записями журнала. */
  labelRequests?: FoodRequest[]
  /** Дата сводки (YYYY-MM-DD): у заказов другой даты в строке пишется «за ДД.ММ». */
  summaryDate?: string
  /** Записанные приёмы дня, которые при выключенном цикле показываются строками
      журнала (journalMealEntries из core/log.ts): карточек слотов нет, а в сумме
      дня эти записи есть, и убрать их иначе нельзя. Без пропса строк нет. */
  journalMeals?: MealLogEntry[]
  /** «Убрать» у записанного приёма (слот приёма). */
  onUnlogMeal?: (slot: Slot) => void
  /** Открыть шторку съёмки. Не задан - кнопки «Сфоткать наклейку» нет. */
  onOpenLabelCapture?: () => void
  /** Правка доли записи прямо в журнале, fraction в (0, 1]. Не задан - доля
      показывается текстом, без кнопки. */
  onSetExtraFraction?: (extraId: string, fraction: number) => void
  /** «Переснять» у заказа, который не удался или протух (id заказа). */
  onRetakeLabel?: (requestId: string) => void
  /** «Убрать» у такого заказа (id заказа). */
  onDiscardRequest?: (requestId: string) => void
}

/** У заказов по наклейке «Повторить» не бывает (RequestStatus показывает
    «Переснять»), так что этот обработчик не вызывается. */
const NO_RETRY = async (): Promise<RequestActionResult> => ({ ok: true })
const NOOP = (): void => {}

/* Иконки - inline SVG в currentColor и размером в em (класс .icon), как в
   TabBar.tsx и SlotIcon.tsx: эмодзи-глифы каждая система рисует по-своему. */

/** Галочка: записанный приём и кнопка «Съел». */
function CheckIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  )
}

/** Выгрузка дня: стрелка из коробки наружу. */
function ExportIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 3v12" />
      <path d="m8 11 4 4 4-4" />
      <path d="M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" />
    </svg>
  )
}

/** Добавить: плюс на кнопках «из другого дня» и «своя еда». */
function PlusIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/** Герой сводки: кольцо калорий, съеденное и цель по бокам, три полосы
    макросов под ним. Одна карточка, а не три: это один ответ на вопрос
    «как я иду по дню», и разрывать его на блоки значит потерять центр. */
function DayHero({
  dayEatenKcal, targetKcal, dayProteinG, targetProteinG,
  dayFatG, dayCarbsG, dayPlannedFatG, dayPlannedCarbsG,
  menuCycleEnabled, targetFatG, targetCarbsG,
  hasDayLog, onOpenDayExport
}: {
  dayEatenKcal: number
  targetKcal: number
  dayProteinG: number
  targetProteinG: number
  dayFatG: number
  dayCarbsG: number
  dayPlannedFatG: number
  dayPlannedCarbsG: number
  menuCycleEnabled: boolean
  targetFatG: number
  targetCarbsG: number
  hasDayLog: boolean
  onOpenDayExport: () => void
}) {
  /* Знаменатель жиров и углеводов: с циклом меню это план меню на день, без
     него плана нет, и работает личная цель из настроек. Цель 0 - «цели нет»,
     MacroBar тогда рисует число без полосы. */
  const fatDenominator = menuCycleEnabled ? dayPlannedFatG : targetFatG
  const carbsDenominator = menuCycleEnabled ? dayPlannedCarbsG : targetCarbsG
  const denominatorCaption = menuCycleEnabled ? 'из плана меню' : 'цель'
  const hasTarget = targetKcal > 0
  const rest = targetKcal - dayEatenKcal
  const over = hasTarget && rest < 0
  /* Цели нет - «осталось» посчитать не от чего, и в центре стоит съеденное:
     число, которое известно точно. Кольцо в этом случае само остаётся пустой
     дорожкой (Ring.tsx). */
  const centerValue = hasTarget ? Math.round(Math.abs(rest)) : Math.round(dayEatenKcal)
  const centerCaption = hasTarget ? (over ? 'сверх' : 'осталось') : 'съедено'

  return (
    <section className="card day-hero">
      {/* Выгрузка дня - второстепенное действие в углу карточки, а не второе
          акцентное пятно рядом с кольцом. Пока за день нет ни одной записи,
          выгружать нечего, и кнопки нет вовсе. */}
      {hasDayLog && (
        <button
          type="button"
          className="day-hero__export"
          aria-label="выгрузить день"
          title="выгрузить день"
          onClick={onOpenDayExport}
        >
          <ExportIcon />
        </button>
      )}

      <div className="day-hero__ring-row">
        <div className="day-hero__side">
          <span className="day-hero__side-label">Съедено</span>
          {/* Класс .day-hero__eaten - зацепка сценария снимков
              (scripts/shots.mjs): он читает из него съеденное за день первым
              целым числом, чтобы доказать рост суммы после записи. */}
          <span className="day-hero__side-value day-hero__eaten nums">{Math.round(dayEatenKcal)}</span>
        </div>

        <Ring size={RING_SIZE} stroke={RING_STROKE} value={dayEatenKcal} max={targetKcal} unit="ккал">
          <span className="day-hero__caption">{centerCaption}</span>
          <span className={`day-hero__number nums${over ? ' day-hero__number--over' : ''}`}>
            {centerValue}
          </span>
          <span className="day-hero__unit">ккал</span>
        </Ring>

        <div className="day-hero__side">
          <span className="day-hero__side-label">Цель</span>
          <span className="day-hero__side-value nums">{hasTarget ? Math.round(targetKcal) : 'нет'}</span>
        </div>
      </div>

      <div className="day-hero__macros">
        <MacroBar
          label="Белок" eatenG={dayProteinG} targetG={targetProteinG}
          color="--macro-protein" caption="цель"
        />
        <MacroBar
          label="Жиры" eatenG={dayFatG} targetG={fatDenominator}
          color="--macro-fat" caption={denominatorCaption}
        />
        <MacroBar
          label="Углеводы" eatenG={dayCarbsG} targetG={carbsDenominator}
          color="--macro-carbs" caption={denominatorCaption}
        />
      </div>
    </section>
  )
}

/** Строка статуса карточки приёма - что видно, зависит от того, записан ли
    приём и как: план в ккал у незаписанного, съеденное у записанного,
    «пропустил» без чисел (пропущенный приём в план дня не засчитан). */
/** Строка статуса карточки. Добавленная к приёму еда (extras) не входит в
    план и в число справа, но входит в кольцо: без этой приписки сумма
    карточек не сходилась бы с кольцом, и объяснения на экране не было бы. */
function cardStatusLine(p: DaySlotProgress): string {
  const base = plannedStatusLine(p)
  return p.extrasKcal > 0 ? `${base} · +${Math.round(p.extrasKcal)} ккал добавлено` : base
}

function plannedStatusLine(p: DaySlotProgress): string {
  if (p.status === undefined) {
    return p.plannedKcal > 0 ? `не записан · план ${Math.round(p.plannedKcal)} ккал` : 'не записан · блюда в меню нет'
  }
  if (p.status === 'skipped') return 'пропустил'
  if (p.status === 'partial') {
    const share = p.fraction !== undefined ? fractionLabel(p.fraction) : ''
    return `съел ${share} · ${Math.round(p.eatenKcal)} ккал`
  }
  return `съел · ${Math.round(p.eatenKcal)} ккал`
}

/** Круг с глифом приёма слева на карточке. Состояние приёма видно по кругу
    раньше, чем прочитана строка статуса: съеденный - галочка на --ok,
    съеденный частично - половина заливки (доля названа словом в статусе),
    пропущенный - приглушённый круг с чертой, незаписанный - глиф приёма на
    --surface-2. «Пропустил» и «ещё не ел» не имеют права выглядеть одинаково. */
function MealMark({ slot, status }: { slot: Slot; status: MealStatus | undefined }) {
  const mod = status === undefined ? '' : ` day-meal__mark--${status}`
  return (
    <span className={`day-meal__mark${mod}`} aria-hidden="true">
      {status === 'eaten' ? <CheckIcon /> : <SlotIcon slot={slot} />}
    </span>
  )
}

/** Карточка одного приёма. `<article>`, а не `<button>`: внутри две кнопки -
    «открыть» (заголовок с названием и статусом) и «Съел» у незаписанного
    приёма, кнопка в кнопке невалидна. «Съел» пишет приём целиком, не открывая
    его - быстрый путь для «поел по плану, отмечать нечего». */
function DayMealCard({
  progress, isCurrent, onSelectSlot, onLog
}: {
  progress: DaySlotProgress
  isCurrent: boolean
  onSelectSlot: (slot: Slot) => void
  onLog: (slot: Slot, status: MealStatus, fraction: number) => void
}) {
  const slot = progress.slot
  const status = progress.status
  return (
    <article className={`card day-meal${status !== undefined ? ' day-meal--logged' : ''}`}>
      <button type="button" className="day-meal__open" onClick={() => onSelectSlot(slot)}>
        <MealMark slot={slot} status={status} />
        <span className="day-meal__body">
          <span className="day-meal__head">
            <span className="day-meal__title">{SLOT_TITLE[slot]}</span>
            <span className="day-meal__time nums">{SLOT_TIME_RANGE[slot]}</span>
            {isCurrent && <span className="day-meal__now">сейчас</span>}
          </span>
          {progress.title !== undefined && <span className="day-meal__dish">{progress.title}</span>}
          <span className="day-meal__status nums">{cardStatusLine(progress)}</span>
        </span>
        {/* Столбик чисел справа. У пропущенного приёма его нет вовсе: съеденное
            у него ноль, а план не состоялся, и «0 из 984» читалось бы как
            неудача вместо честного «пропустил». У незаписанного приёма без
            блюда в меню его тоже нет: «0 ккал» там - не данные, а их
            отсутствие. */}
        {status !== 'skipped' && (status !== undefined || progress.plannedKcal > 0) && (
          <span className="day-meal__nums">
            <span className={`day-meal__kcal nums${status === undefined ? ' day-meal__kcal--planned' : ''}`}>
              {Math.round(status === undefined ? progress.plannedKcal : progress.eatenKcal)}
            </span>
            <span className="day-meal__kcal-note nums">
              {status === undefined ? 'ккал' : `из ${Math.round(progress.plannedKcal)} ккал`}
            </span>
          </span>
        )}
      </button>
      {/* Кнопка есть только пока приём не записан и на него есть блюдо в меню:
          без блюда писать нечего - handleLog в App.tsx выходит без записи,
          и кнопка выглядела бы рабочей, ничего не делая. При status === undefined
          title берётся только из меню, так что это и есть проверка «блюдо есть». */}
      {status === undefined && progress.title !== undefined && (
        <button
          type="button"
          className="day-meal__log"
          aria-label={`Съел: ${SLOT_TITLE[slot]}`}
          title={`Съел: ${SLOT_TITLE[slot]}`}
          onClick={() => onLog(slot, 'eaten', 1)}
        >
          <CheckIcon />
        </button>
      )}
    </article>
  )
}

/** Камера: кнопка «Сфоткать наклейку». */
function CameraIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4 8a1 1 0 0 1 1-1h2.5l1.2-2h6.6l1.2 2H19a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}

/** Подпись источника записи в журнале. У 'label': «наклейка · {titleHy}» (без
    названия просто «наклейка»), номер блюда рациона, если он распознан, и
    пометка, что микронутриенты оценены по составу, а не измерены. */
function extraSourceText(e: ExtraLogEntry, food: CustomFood | undefined): string {
  switch (e.kind) {
    case 'menu':
      return `день ${e.fromCycleDay}, ${SLOT_TITLE[e.fromSlot].toLowerCase()}`
    case 'custom':
      return 'своя еда'
    case 'label': {
      const parts = [e.titleHy !== '' ? `наклейка · ${e.titleHy}` : 'наклейка']
      const dishNo = food?.label?.dishNo
      if (dishNo !== undefined && dishNo !== null) parts.push(`блюдо №${dishNo}`)
      parts.push('микро по составу')
      return parts.join(' · ')
    }
  }
}

/** Строка журнала: название, мета, кнопка доли и «убрать». Кнопка доли
    раскрывает FractionPicker прямо под строкой. */
function ExtraRow({
  entry, food, editing, onToggleEdit, onSetFraction, onRemove
}: {
  entry: ExtraLogEntry
  food: CustomFood | undefined
  editing: boolean
  onToggleEdit: () => void
  onSetFraction: ((fraction: number) => void) | undefined
  onRemove: () => void
}) {
  // сверка 4/9/4 только для записи по наклейке, чья еда ещё лежит в книге
  const warning = entry.kind === 'label' && food?.label ? labelEnergyWarning(food.label.printed) : null
  return (
    <li className="day-extras__item list__row">
      <span className="day-extras__name">{entry.title}</span>
      <span className="day-extras__meta nums">
        {Math.round(entry.kbju.kcal * entry.fraction)} ккал · {extraSourceText(entry, food)}
      </span>
      {onSetFraction !== undefined
        ? (
          <button
            type="button"
            className="day-extras__fraction nums"
            aria-expanded={editing}
            aria-label={`Доля: ${fractionLabel(entry.fraction)}. Изменить`}
            onClick={onToggleEdit}
          >
            {fractionLabel(entry.fraction)}
          </button>
        )
        : <span className="day-extras__meta nums">{fractionLabel(entry.fraction)}</span>}
      <button type="button" className="day-extras__remove" onClick={onRemove}>
        убрать
      </button>
      {warning !== null && <p className="day-extras__warning" role="note">{warning}</p>}
      {editing && onSetFraction !== undefined && (
        <div className="day-extras__editor">
          <FractionPicker value={entry.fraction} onChange={onSetFraction} idPrefix={`extra-${entry.id}`} />
        </div>
      )}
    </li>
  )
}

/** Строка журнала для записанного приёма меню (цикл выключен). Доли не правит:
    приём меню переписывается из своего экрана, здесь его можно только убрать. */
function MealJournalRow({ entry, onRemove }: { entry: MealLogEntry; onRemove: (() => void) | undefined }) {
  const skipped = entry.status === 'skipped' || entry.fraction === 0
  return (
    <li className="day-extras__item list__row">
      <span className="day-extras__name">{entry.title}</span>
      <span className="day-extras__meta nums">
        {skipped ? 'пропущен' : `${Math.round(entry.kbju.kcal * entry.fraction)} ккал`} · {SLOT_TITLE[entry.slot].toLowerCase()}
      </span>
      {!skipped && <span className="day-extras__meta nums">{fractionLabel(entry.fraction)}</span>}
      {onRemove !== undefined && (
        <button type="button" className="day-extras__remove" onClick={onRemove}>
          убрать
        </button>
      )}
    </li>
  )
}

export default function DaySummary({
  daySlots, currentSlot, onSelectSlot, onLog,
  dayEatenKcal, targetKcal, dayProteinG, targetProteinG,
  dayFatG, dayCarbsG, dayPlannedFatG, dayPlannedCarbsG,
  hasDayLog, onOpenDayExport, extras, onRemoveExtra, onOpenAddFromMenu, onOpenCustomFood,
  dayNutrients, norms, productsRevision,
  menuCycleEnabled = true, targetFatG = 0, targetCarbsG = 0, customFoods,
  labelRequests = [], summaryDate, journalMeals = [], onUnlogMeal, onOpenLabelCapture, onSetExtraFraction, onRetakeLabel, onDiscardRequest
}: DaySummaryProps) {
  /* Одна раскрытая правка доли на экране: две открытые клавиатуры подряд
     никому не нужны. */
  const [editingId, setEditingId] = useState<string | null>(null)
  const queued = labelRequests.filter(r => r.kind === 'label' && r.status !== 'done')
  const hasJournal = journalMeals.length > 0 || extras.length > 0 || queued.length > 0

  return (
    <>
      <DayHero
        dayEatenKcal={dayEatenKcal}
        targetKcal={targetKcal}
        dayProteinG={dayProteinG}
        targetProteinG={targetProteinG}
        dayFatG={dayFatG}
        dayCarbsG={dayCarbsG}
        dayPlannedFatG={dayPlannedFatG}
        dayPlannedCarbsG={dayPlannedCarbsG}
        menuCycleEnabled={menuCycleEnabled}
        targetFatG={targetFatG}
        targetCarbsG={targetCarbsG}
        hasDayLog={hasDayLog}
        onOpenDayExport={onOpenDayExport}
      />

      {menuCycleEnabled && (
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
      )}

      {/* Журнал дня: съеденное сверх меню и, без цикла, вообще вся еда дня.
          Статус приёмов не трогает. Под записями «призрачные» строки заказов
          по наклейкам, которые ещё не стали записями. */}
      <section className="day-extras">
        {hasJournal && (
          <>
            <h2 className="day-extras__title">Журнал дня</h2>
            <div className="card">
              <ul className="list">
                {journalMeals.map(m => (
                  <MealJournalRow key={m.slot} entry={m} onRemove={onUnlogMeal ? () => onUnlogMeal(m.slot) : undefined} />
                ))}
                {extras.map(e => (
                  <ExtraRow
                    key={e.id}
                    entry={e}
                    food={e.kind === 'menu' ? undefined : customFoods?.[e.customFoodId]}
                    editing={editingId === e.id}
                    onToggleEdit={() => setEditingId(editingId === e.id ? null : e.id)}
                    onSetFraction={onSetExtraFraction ? f => onSetExtraFraction(e.id, f) : undefined}
                    onRemove={() => onRemoveExtra(e.id)}
                  />
                ))}
                {queued.map(r => (
                  <li key={r.id} className="day-extras__pending list__row">
                    <RequestStatus
                      request={r}
                      onRetry={NO_RETRY}
                      onRetake={onRetakeLabel ?? NOOP}
                      onDiscard={onDiscardRequest ?? NOOP}
                      summaryDate={summaryDate}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>

      {/* Липкая панель действий: съёмка наклейки - главное действие дня и
          всегда под большим пальцем. */}
      <div className="day-actions">
        {onOpenLabelCapture !== undefined && (
          <button
            type="button"
            className="btn btn--primary"
            aria-label="Сфоткать наклейку"
            onClick={onOpenLabelCapture}
          >
            <CameraIcon />
            Сфоткать наклейку
          </button>
        )}
        <button
          type="button"
          className="btn btn--secondary"
          aria-label="Своя еда"
          onClick={onOpenCustomFood}
        >
          <PlusIcon />
          Своя еда
        </button>
      </div>

      {menuCycleEnabled && (
        <div className="day-extras__actions">
          <button
            type="button"
            className="btn btn--secondary"
            aria-label="Добавить блюдо из другого дня"
            onClick={onOpenAddFromMenu}
          >
            <PlusIcon />
            Добавить блюдо из другого дня
          </button>
        </div>
      )}

      {/* Микронутриенты за день - последний блок сводки: справка, а не то, с
          чем работают каждый день. Сам блок переделывает своя задача
          (NutrientsBlock.tsx, meal.css) и сам уже карточка - здесь только
          место, вторая карточка вокруг была бы карточкой в карточке. */}
      <section className="day-nutrients">
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
      </section>
    </>
  )
}
