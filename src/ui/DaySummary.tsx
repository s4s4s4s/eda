/* Сводка дня - главный экран (DESIGN.md, «Навигация: сводка первая» и
   «Иерархия сводки дня»). Сверху вниз: герой-карточка (кольцо калорий и три
   полосы макросов), четыре карточки приёмов со статусом и кнопкой «Съел» у
   незаписанных, «Добавлено» с двумя кнопками, микронутриенты за день.

   Зрительный центр ровно один - кольцо: «сколько осталось» читается с одного
   взгляда, остальное на экране мельче него. Честность (DESIGN.md, «Честность -
   часть дизайна») задаёт, чего на экране НЕ будет: цели нет - заливки кольца
   нет; плана меню нет - полосы макроса нет, остаётся число; приём пропущен -
   чисел у него нет вовсе, потому что в план дня он не засчитан. Ничего не
   поздравляет: набранная цель - это заливка кольца, а не фраза. */

import { SLOT_TITLE, SLOTS } from '../core/types.ts'
import type { ExtraLogEntry, MealStatus, NutrientNorms, NutrientTotals, Slot } from '../core/types.ts'
import { fractionLabel } from './fractions.ts'
import MacroBar from './MacroBar.tsx'
import { NutrientsBlock } from './NutrientsBlock.tsx'
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
}

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
  hasDayLog: boolean
  onOpenDayExport: () => void
}) {
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
          label="Жиры" eatenG={dayFatG} targetG={dayPlannedFatG}
          color="--macro-fat" caption="из плана меню"
        />
        <MacroBar
          label="Углеводы" eatenG={dayCarbsG} targetG={dayPlannedCarbsG}
          color="--macro-carbs" caption="из плана меню"
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

export default function DaySummary({
  daySlots, currentSlot, onSelectSlot, onLog,
  dayEatenKcal, targetKcal, dayProteinG, targetProteinG,
  dayFatG, dayCarbsG, dayPlannedFatG, dayPlannedCarbsG,
  hasDayLog, onOpenDayExport, extras, onRemoveExtra, onOpenAddFromMenu, onOpenCustomFood,
  dayNutrients, norms, productsRevision
}: DaySummaryProps) {
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
        hasDayLog={hasDayLog}
        onOpenDayExport={onOpenDayExport}
      />

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
          отдельным блоком под карточками, а не внутри одной из них. */}
      <section className="day-extras">
        {extras.length > 0 && (
          <>
            <h2 className="day-extras__title">Добавлено</h2>
            <div className="card">
              <ul className="list">
                {extras.map(e => (
                  <li key={e.id} className="day-extras__item list__row">
                    <span className="day-extras__name">{e.title}</span>
                    <span className="day-extras__meta nums">
                      {fractionLabel(e.fraction)} · {Math.round(e.kbju.kcal * e.fraction)} ккал ·{' '}
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
            </div>
          </>
        )}
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
      </section>

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
