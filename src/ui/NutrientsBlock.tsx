/* Покрытие суточных норм — общий блок и для экрана приёма (режимы
   'projected'/'meal'/'day'), и для сводки дня (только 'day', переключатель
   режимов тогда скрыт вовсе — см. проп `modes`). Вынесен из MealScreen.tsx
   без изменения поведения: тот же расчёт, та же разметка. */

import { useState } from 'react'
import { addNutrientTotals } from '../core/nutrition.ts'
import { nutrientCoverage } from '../core/norms.ts'
import type { NutrientCoverage } from '../core/norms.ts'
import { formatNutrientAmount, NO_DATA_TEXT } from '../core/export/format.ts'
import { NUTRIENT_GROUP, NUTRIENT_GROUP_ORDER, NUTRIENT_TITLE, NUTRIENT_UNIT, SLOT_TITLE } from '../core/types.ts'
import type { ExtraLogEntry, NutrientNorms, NutrientTotals } from '../core/types.ts'
import { fractionLabel } from './fractions.ts'
import type { DaySlotProgress } from './slots.ts'

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

/** Строка-подпись под чипами режимов: что именно вошло в сумму. `day` и
    `projected` перечисляют записанные слоты дня по порядку `SLOTS`,
    приём со статусом «съел часть» — с долей; `projected` дописывает
    текущий приём отдельно, потому что он в дневник ещё не попал.

    Если среди записанных слотов дня есть хоть один со снапшотом по чужой или
    отсутствующей ревизии справочника, подпись коротко предупреждает об этом:
    подробности — в meal-revision-note у самой записи (см. `revisionNote`),
    здесь только флаг, что день считает по смеси справочников. Добавленная
    еда (`extras`) перечисляется отдельным хвостом «+ добавлено: …» — она не
    входит в meals и своего слота-подписи не имеет, но входит в те же суммы
    dayTotals/dayNutrientTotals. */
function nutrientsCaption(
  mode: NutrientsMode,
  daySlots: DaySlotProgress[],
  productsRevision: string,
  extras: ExtraLogEntry[]
): string {
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
  const withExtras = extras.length > 0
    ? `${withProjected} + добавлено: ${extras.map(e => `${e.title} (${fractionLabel(e.fraction)})`).join(', ')}`
    : withProjected
  // Пропущенный приём в сумму дня не входит (см. комментарий выше и
  // scaleNutrientTotals) — его ревизия справочника не влияет на то, по каким
  // числам посчитана сама сумма, и не должна включать оговорку о смеси
  // справочников. Проверяем только слоты, реально вошедшие в сумму, и
  // добавленные блюда меню (kind 'menu') — своя еда (kind 'custom') не несёт
  // productsRevision вовсе, у неё источник другой (USDA через воркер).
  const hasOldRevisionMeals = loggedSlots.some(s => s.status !== 'skipped' && s.productsRevision !== productsRevision)
  const hasOldRevisionExtras = extras.some(e => e.kind === 'menu' && e.productsRevision !== productsRevision)
  return (hasOldRevisionMeals || hasOldRevisionExtras)
    ? `${withExtras} · часть записей по прежнему справочнику`
    : withExtras
}

/** Одна строка покрытия. Что видно и чего не видно в каждом состоянии — таблица
    из DESIGN.md, раздел «Покрытие норм»; отступать от неё нельзя, здесь легче
    всего соврать. `withCoverage === false` — режим приёма: полос и процентов
    нет ни у одной строки, потому что норма суточная. */
export function NutrientRow({
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
export function NutrientsBlock({
  dayTotals, mealTotals, norms, hasMeal, hasEntry, daySlots, productsRevision, extras, modes: modesProp
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
  /** Съеденное сверх меню за день — хвост подписи «+ добавлено: …». */
  extras: ExtraLogEntry[]
  /** Явный список доступных режимов — задаёт сводка дня (`['day']`): там
      сравнивать не с чем, кроме дня, и переключатель режимов не рисуется
      вовсе. Экран приёма это не передаёт — набор режимов вычисляется из
      hasMeal/hasEntry, как раньше. */
  modes?: NutrientsMode[]
}) {
  /* Раскрытие держим в состоянии, а не отдаём браузеру: иконка рисуется двумя
     разными путями, и React должен знать, какой из них показывать. */
  const [open, setOpen] = useState(false)
  /* `projected` существует, только пока приём есть и ещё не записан: тогда
     день без него ничего не объясняет, и это разумный режим по умолчанию.
     Записанный приём день уже содержит — по умолчанию открываем `day`.
     Сводка дня явно передаёт `modes`, и showProjected для неё не участвует —
     'projected' в её наборе режимов нет. */
  const showProjected = hasMeal && !hasEntry
  const [mode, setMode] = useState<NutrientsMode>(showProjected ? 'projected' : 'day')
  /* Сноска, раскрытая или закрытая рукой. Ключа нет — работает правило по
     умолчанию: то, что объясняет видимое прямо сейчас, раскрыто сразу. */
  const [notes, setNotes] = useState<Record<string, boolean>>({})

  const modes: NutrientsMode[] = modesProp ?? (showProjected ? ['day', 'projected', 'meal'] : ['day', 'meal'])
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
      className="meal-nutrients card"
      open={open}
      onToggle={event => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      {/* Свёрнутый блок читается одной строкой карточки: что это, сколько
          набрано и куда нажать. Шеврон стоит справа, в конце строки: он
          обещает продолжение, а не подписывает заголовок. */}
      <summary className="meal-nutrients__summary">
        <span className="meal-nutrients__summary-title">Микронутриенты</span>
        {summaryHints.length > 0 && (
          <>
            <span className="meal-nutrients__summary-sep" aria-hidden="true">·</span>
            <span className="meal-nutrients__summary-hint nums">{summaryHints.join(' · ')}</span>
          </>
        )}
        <ChevronIcon open={open} />
      </summary>

      {/* Один режим — переключаться не между чем, чипы только заняли бы место
          и намекнули на выбор, которого нет (сводка дня, modes={['day']}). */}
      {modes.length > 1 && (
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
      )}

      {effectiveMode === 'meal'
        ? <p className="meal-nutrients__note">нормы суточные — процент показан только за день</p>
        : <p className="meal-nutrients__note">{nutrientsCaption(effectiveMode, daySlots, productsRevision, extras)}</p>}

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
