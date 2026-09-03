/* Шторка «Неделя»: отвечает на один вопрос — ем я как собирался или нет.
   Каркас — общий Sheet.tsx, собственных стилей файл не заводит (см. DESIGN.md,
   раздел «Границы файлов»): разметка живёт на примитивах theme.css (.nutrient)
   и на классах week-* в конце sheets.css.

   День без записей — не нулевой день: он не входит ни в одно среднее (это уже
   решено в core/week.ts), здесь только не выдумывается число там, где его нет. */

import { useMemo } from 'react'
import { normRatio } from '../core/norms.ts'
import { weekCoverage, weekSummary } from '../core/week.ts'
import type { DaySummary, WeekCoverage, WeekNutrient, WeekSummary } from '../core/week.ts'
import {
  NUTRIENT_GROUP, NUTRIENT_GROUP_ORDER, NUTRIENT_TITLE, NUTRIENT_UNIT, SLOTS
} from '../core/types.ts'
import type { AppState, NutrientKey, NutrientNorms } from '../core/types.ts'
import { formatNutrientAmount } from '../core/export/format.ts'
import Sheet from './Sheet.tsx'

interface WeekSheetProps {
  log: AppState['log']
  today: string
  targetKcal: number
  targetProteinG: number
  norms: NutrientNorms
  onClose: () => void
}

const WEEKDAY_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

/** Сколько нутриентов показывать в «Чего недобираешь» — весь список неудобно
    читать у стола, а первых восьми хватает, чтобы увидеть закономерность. */
const DEFICIT_LIMIT = 8

function round(n: number): number {
  return Math.round(n)
}

/** Русское склонение слова «день» по числу (день/дня/дней). Та же таблица, что
    и в SettingsSheet.tsx — своя копия, а не импорт из шторки, которую правит
    параллельно другой агент. */
function daysWord(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return 'дней'
  switch (n % 10) {
    case 1: return 'день'
    case 2:
    case 3:
    case 4: return 'дня'
    default: return 'дней'
  }
}

/** Дательный падеж того же слова для «по N дням»: «по 1 дню», но «по 3 дням». */
function daysDative(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? 'дню' : 'дням'
}

/** Русское склонение слова «приём» по числу (приём/приёма/приёмов) — та же
    таблица правил, что у daysWord, только другой корень: нужна для подписи
    «N приёмов из M» у неполных дней. */
function mealsWord(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return 'приёмов'
  switch (n % 10) {
    case 1: return 'приём'
    case 2:
    case 3:
    case 4: return 'приёма'
    default: return 'приёмов'
  }
}

/** Согласование глагола с числом дней: «1 день записан», «2 дня записаны». */
function loggedWord(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? 'записан' : 'записаны'
}

/** Краткая форма прилагательного «неполный» по числу — согласуется с числом
    неполных дней («1 неполный», но «2 неполных» и «5 неполных»: у числительных
    2–4 в современном русском прилагательное тоже стоит в родительном падеже
    множественного числа, а не в форме двойственного числа). */
function incompleteWord(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? 'неполный' : 'неполных'
}

/** «2026-08-30» -> «пн, 30.08». Дата уже локальная (см. core/week.ts), поэтому
    день недели читается тем же способом, каким день собирался: локальной датой,
    без прохода через UTC. */
function formatDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const weekday = WEEKDAY_SHORT[new Date(y, m - 1, d).getDay()]
  const dd = String(d).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  return `${weekday}, ${dd}.${mm}`
}

/** Геометрия и цвет полосы покрытия — по декларации: пока норма не набрана,
    полоса идёт акцентом, набрана — спокойным зелёным. Красного здесь нет:
    он означает превышение верхнего безопасного предела, а среднее за неделю
    выше суточной нормы опасностью не является — как и калории выше цели,
    которая у Александра стоит на набор массы, а не на ограничение.
    Когда отношение больше единицы, полоса полна, а отметка «здесь было бы
    ровно 100 %» остаётся видна — иначе перебор читается как «ровно норма». */
function barGeometry(ratio: number): { widthPct: number; markPct: number | null; reached: boolean } {
  if (ratio <= 1) return { widthPct: Math.max(ratio, 0) * 100, markPct: null, reached: ratio >= 1 }
  return { widthPct: 100, markPct: (1 / ratio) * 100, reached: true }
}

/** `over` красит полосу в `.nutrient__fill--over` — единственное основание для
    красного во всей неделе: превышение верхнего безопасного предела (ul).
    Ни один другой вызывающий (DayRow, «Чего недобираешь») его не передаёт —
    их правило цвета не меняется. */
function CoverageBar({ ratio, over = false }: { ratio: number; over?: boolean }) {
  const { widthPct, markPct, reached } = barGeometry(ratio)
  const fillClass = over ? 'nutrient__fill nutrient__fill--over' : (reached ? 'nutrient__fill nutrient__fill--ok' : 'nutrient__fill')
  return (
    <div className="nutrient__bar">
      <div className={fillClass} style={{ width: `${widthPct}%` }} />
      {markPct !== null && <span className="nutrient__mark" style={{ left: `${markPct}%` }} />}
    </div>
  )
}

function SummarySection({
  summary,
  targetKcal,
  targetProteinG
}: {
  summary: WeekSummary
  targetKcal: number
  targetProteinG: number
}) {
  if (summary.daysWithLog === 0) {
    return <p className="week-summary week-summary--empty">За эти семь дней записей нет</p>
  }

  const n = summary.daysWithLog
  const avgKcal = summary.avgKcal as number
  const avgProteinG = summary.avgProteinG as number
  const kcalPct = targetKcal > 0 ? round((avgKcal / targetKcal) * 100) : null
  const proteinPct = targetProteinG > 0 ? round((avgProteinG / targetProteinG) * 100) : null
  const { incompleteDays } = summary

  return (
    <div className="week-summary">
      <p className="week-summary__line">
        В среднем за {n} {daysWord(n)} с записями: {round(avgKcal)} ккал, {round(avgProteinG)} г белка
        {incompleteDays > 0 && ` (из них ${incompleteDays} ${loggedWord(incompleteDays)} не полностью)`}
      </p>
      {(kcalPct !== null || proteinPct !== null) && (
        <p className="week-summary__ratio">
          {kcalPct !== null && `${kcalPct}% от цели по калориям`}
          {kcalPct !== null && proteinPct !== null && ' · '}
          {proteinPct !== null && `${proteinPct}% от цели по белку`}
        </p>
      )}
    </div>
  )
}

function DayRow({ day, isToday, targetKcal }: { day: DaySummary; isToday: boolean; targetKcal: number }) {
  const label = formatDayLabel(day.date)

  if (!day.hasLog) {
    return (
      <li className="week-day week-day--empty">
        <span className="week-day__label">
          {label}
          {isToday && ' · сегодня'}
        </span>
        <span className="week-day__hint">нет записей</span>
      </li>
    )
  }

  const ratio = targetKcal > 0 ? day.kbju.kcal / targetKcal : null

  return (
    <li className="week-day">
      <div className="week-day__head">
        <span className="week-day__label">
          {label}
          {isToday && ' · сегодня'}
          {day.cycleDay !== null && <span className="week-day__cycle"> · день {day.cycleDay}</span>}
        </span>
        <span className="week-day__kcal">{round(day.kbju.kcal)} ккал</span>
      </div>
      {ratio !== null && <CoverageBar ratio={ratio} />}
      <span className="week-day__meals">
        {day.loggedSlots.length} из {SLOTS.length} приёмов
        {day.extrasCount > 0 && ` · добавлено: ${day.extrasCount}`}
      </span>
    </li>
  )
}

interface DeficitRow {
  key: NutrientKey
  ratio: number
  avgValue: number
  daysWithData: number
}

/** Только нутриенты, для которых есть сравнимая норма и среднее посчитано,
    отсортированные по возрастанию покрытия — систематическая нехватка видна
    порядком, самое недобранное сверху (см. DESIGN.md, раздел «Неделя»). */
function buildDeficitRows(nutrients: WeekNutrient[], norms: NutrientNorms): DeficitRow[] {
  const rows: DeficitRow[] = []
  for (const wn of nutrients) {
    if (wn.avgValue === null) continue
    const norm = norms[wn.key]
    if (!norm) continue
    const ratio = normRatio(norm, wn.avgValue)
    if (ratio === null) continue
    rows.push({ key: wn.key, ratio, avgValue: wn.avgValue, daysWithData: wn.daysWithData })
  }
  rows.sort((a, b) => a.ratio - b.ratio)
  return rows.slice(0, DEFICIT_LIMIT)
}

/* ---- Итоги недели: все позиции, не только провалы ----

   DESIGN.md, раздел «Итоги недели»: нутриент, который набирается, — такой же
   результат, как и тот, который не набирается. Полоса переиспользует ту же
   CoverageBar, что и «Чего недобираешь» выше: зелёный красит только «норма
   набрана», и это же правило действует везде в неделе. Единственное
   исключение — overUl: превышение верхнего безопасного предела, которое
   красит полосу в `.nutrient__fill--over`. Превышение calorий целью или RDA
   красным не красится никогда — Александр набирает массу.

   overCdrr (натрий) — отдельная история: у натрия верхнего предела нет вовсе,
   cdrr — это уровень снижения риска, а не предел безопасности. Поэтому
   overCdrr НИКОГДА не красит полосу, только несёт текстовую оговорку — путать
   его с overUl запрещено декларацией задачи. */

function WeekCoverageRow({ cov }: { cov: WeekCoverage }) {
  const { key, value, daysWithData, dayCount, partialDays, ratio, state, ul, overUl, cdrr, overCdrr } = cov
  const unit = NUTRIENT_UNIT[key]
  const showBar = state === 'ok' && ratio !== null

  const classes = ['nutrient']
  if (state === 'no-data') classes.push('nutrient--unknown')
  if (partialDays > 0) classes.push('nutrient--partial')

  return (
    <li className={classes.join(' ')}>
      <span className="nutrient__name">{NUTRIENT_TITLE[key]}</span>
      <span className="nutrient__value">
        {state === 'no-data' ? 'нет данных' : `${formatNutrientAmount(value)} ${unit}`}
        {showBar && <span className="nutrient__pct">{round((ratio as number) * 100)}%</span>}
        {/* not-comparable (вода: считает разное) и no-norm (нормы просто нет) —
            обе строки показывают набранное без полосы и без придуманного процента. */}
        {state === 'not-comparable' && (
          <span className="nutrient__pct">норма считает другое — без процента</span>
        )}
      </span>
      {showBar && <CoverageBar ratio={ratio as number} over={overUl} />}
      {/* Подпись «по N дням из 7» обязательна на КАЖДОЙ строке, включая no-data:
          иначе нутриент, известный по двум дням из семи, читался бы как набранный
          за всю неделю (DESIGN.md, «Итоги недели»). */}
      <span className="nutrient__hint">
        по {daysWithData} {daysDative(daysWithData)} из {dayCount}
        {partialDays > 0 && `, из них ${partialDays} ${incompleteWord(partialDays)}`}
      </span>
      {overUl && ul !== null && (
        <span className="nutrient__hint">
          выше верхнего безопасного предела за неделю ({formatNutrientAmount(ul)} {unit})
        </span>
      )}
      {overCdrr && cdrr !== null && (
        <span className="nutrient__hint">
          выше порога снижения риска за неделю ({formatNutrientAmount(cdrr)} {unit}) — это не предел
          безопасности, верхнего предела у этого нутриента нет
        </span>
      )}
    </li>
  )
}

function WeekCoverageSection({
  coverage,
  incompleteDays,
  loggedSlots,
  expectedSlots
}: {
  coverage: WeekCoverage[]
  incompleteDays: number
  loggedSlots: number
  expectedSlots: number
}) {
  return (
    <section className="week-section">
      <h2 className="week-section__title">Итоги недели</h2>
      {/* Оговорка одна на весь раздел, а не на каждую строку: неполные дни бьют
          по всем нутриентам разом, повторять её в каждой строке было бы шумом
          поверх того же nutrient--partial. */}
      {incompleteDays > 0 && (
        <p className="week-section__caveat">
          {incompleteDays} {daysWord(incompleteDays)} {loggedWord(incompleteDays)} не полностью
          ({loggedSlots} {mealsWord(loggedSlots)} из {expectedSlots}) — числа по ним нижняя граница, не значение
        </p>
      )}
      <div className="week-coverage">
        {NUTRIENT_GROUP_ORDER.map((group) => {
          const rows = coverage.filter((c) => NUTRIENT_GROUP[c.key] === group)
          if (rows.length === 0) return null
          return (
            <section key={group} className="nutrient-group">
              <h3 className="nutrient-group__title">{group}</h3>
              <ul className="week-nutrients">
                {rows.map((cov) => (
                  <WeekCoverageRow key={cov.key} cov={cov} />
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </section>
  )
}

export default function WeekSheet({ log, today, targetKcal, targetProteinG, norms, onClose }: WeekSheetProps) {
  const summary = useMemo(() => weekSummary(log, today), [log, today])
  const orderedDays = useMemo(() => [...summary.days].reverse(), [summary.days])
  const deficitRows = useMemo(() => buildDeficitRows(summary.nutrients, norms), [summary.nutrients, norms])
  const coverage = useMemo(() => weekCoverage(summary, norms), [summary, norms])
  const noDataTitles = useMemo(
    () => summary.nutrients.filter(n => n.avgValue === null).map(n => NUTRIENT_TITLE[n.key]),
    [summary.nutrients]
  )

  return (
    <Sheet title="Неделя" onClose={onClose}>
      <div className="week-sheet">
        <SummarySection summary={summary} targetKcal={targetKcal} targetProteinG={targetProteinG} />

        <ul className="week-days">
          {orderedDays.map(day => (
            <DayRow key={day.date} day={day} isToday={day.date === today} targetKcal={targetKcal} />
          ))}
        </ul>

        {summary.daysWithLog > 0 && deficitRows.length > 0 && (
          <section className="week-section">
            <h2 className="week-section__title">Чего недобираешь</h2>
            <ul className="week-nutrients">
              {deficitRows.map(row => (
                <li key={row.key} className="nutrient">
                  <span className="nutrient__name">{NUTRIENT_TITLE[row.key]}</span>
                  <span className="nutrient__value">
                    {formatNutrientAmount(row.avgValue)} {NUTRIENT_UNIT[row.key]}
                    <span className="nutrient__pct">{round(row.ratio * 100)}%</span>
                  </span>
                  <CoverageBar ratio={row.ratio} />
                  {/* Знаменатель — dayCount (дни окна, «из 7»), тот же, что и в разделе
                      «Итоги недели» ниже: два раздела считают одно и то же число
                      дней с данными по нутриенту, и оба меряют его от окна, а не
                      от числа записанных дней (DESIGN.md, «Итоги недели»). */}
                  <span className="nutrient__hint">
                    по {row.daysWithData} {daysDative(row.daysWithData)} из {summary.days.length}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {summary.daysWithLog > 0 && noDataTitles.length > 0 && (
          <p className="week-no-data">Нет данных: {noDataTitles.join(', ')}</p>
        )}

        {summary.daysWithLog > 0 && (
          <WeekCoverageSection
            coverage={coverage}
            incompleteDays={summary.incompleteDays}
            loggedSlots={summary.loggedSlots}
            expectedSlots={summary.expectedSlots}
          />
        )}
      </div>
    </Sheet>
  )
}
