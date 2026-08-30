/* Держит AppState, грузит меню, справочник и нормы, считает день цикла и
   текущий приём, раздаёт пропсы главному экрану и шторкам, сохраняет
   состояние при каждом изменении. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { batchDay, currentSlot, cycleDay, todayLocal } from '../core/cycle.ts'
import { buildChannels } from '../core/export/index.ts'
import type { ExportPayload } from '../core/export/index.ts'
import { clearLog, dayNutrientTotals, dayTotal, logMeal, unlogMeal } from '../core/log.ts'
import { emptyNutrientTotals, mealKbju, mealNutrients } from '../core/nutrition.ts'
import { clearRating, rateDish, ratingOf, setStance } from '../core/preferences.ts'
import { mealVerdict } from '../core/verdict.ts'
import type { MealVerdict } from '../core/verdict.ts'
import { SLOTS } from '../core/types.ts'
import type {
  AppState, IngredientStance, Kbju, Meal, MealStatus, NutrientTotals, Settings, Slot
} from '../core/types.ts'
import { loadData } from '../data/load.ts'
import { defaultState, loadState, saveState } from '../state/storage.ts'
import MealScreen from './MealScreen.tsx'
import type { DaySlotProgress } from './MealScreen.tsx'
import Sheet from './Sheet.tsx'
import SettingsSheet from './SettingsSheet.tsx'
import ExportSheet from './ExportSheet.tsx'
import WeekSheet from './WeekSheet.tsx'
import BookSheet from './BookSheet.tsx'
import UpdateBanner from './UpdateBanner.tsx'

const ZERO_KBJU: Kbju = { kcal: 0, p: 0, f: 0, c: 0 }
/** Пустая сумма нутриентов: known === 0 по всем ключам, то есть «нет данных»,
    а не «нулевые значения». Показывается, когда меню на приём не найдено. */
const NO_NUTRIENTS: NutrientTotals = emptyNutrientTotals()
/** Пустой вердикт: сказать нечего. Это НЕ «всё плохо» — экран в таком случае
    не рисует блок плюсов и минусов вовсе. */
const NO_VERDICT: MealVerdict = { pros: [], cons: [] }

function minutesOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes()
}

/** Дата и приём на один момент времени — оба пересчитываются одним таймером. */
interface Clock {
  today: string
  slot: Slot
}

function readClock(now: Date): Clock {
  return { today: todayLocal(now), slot: currentSlot(minutesOfDay(now)) }
}

/** Ручной выбор приёма вместе с тем приёмом, который был текущим в момент
    выбора: сравнение с ним и отпускает выбор, когда время идёт дальше. */
interface ManualSlot {
  slot: Slot
  pinnedTo: Slot
}

/** appUrl для x-callback-url Shortcuts: адрес приложения без query-параметров. */
function currentAppUrl(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}`
}

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    try {
      return loadState()
    } catch {
      return defaultState()
    }
  })
  const [manualSlot, setManualSlot] = useState<ManualSlot | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [weekOpen, setWeekOpen] = useState(false)
  const [bookOpen, setBookOpen] = useState(false)
  const [exportPayload, setExportPayload] = useState<ExportPayload | null>(null)

  /* Провал сохранения не глушим: экран обязан сказать, что записанного приёма
     в дневнике нет. Молчание здесь означало бы, что человек видит запись,
     которой на диске не существует, и узнает об этом только потеряв её. */
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    const result = saveState(state)
    setSaveError(result.ok ? null : result.error)
  }, [state])

  // возврат из Команд может принести ?exported=... на уже перезагруженную
  // страницу (ExportSheet больше не смонтирован) — подчищаем адресную строку,
  // чтобы параметр не переигрывался при следующем открытии
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('exported') && !exportPayload) {
      window.history.replaceState(null, '', window.location.pathname)
    }
    // намеренно только при монтировании: пока шторка экспорта открыта, она
    // сама следит за возвратом через readCallback/visibilitychange
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { menu, products, norms } = useMemo(() => loadData(), [])

  /* Дата и текущий приём идут от ОДНОГО минутного таймера. Считать дату один
     раз при монтировании нельзя: приложение, открытое до полуночи и оставленное
     открытым, продолжало бы писать записи во вчерашний день. */
  const [clock, setClock] = useState<Clock>(() => readClock(new Date()))
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = readClock(new Date())
      // прежний объект возвращается намеренно: React пропускает перерисовку,
      // когда за минуту ни дата, ни приём не изменились
      setClock(prev => (prev.today === next.today && prev.slot === next.slot ? prev : next))
    }, 60_000)
    return () => window.clearInterval(id)
  }, [])
  const today = clock.today
  const autoSlot = clock.slot

  const cycleDayNum = useMemo(
    () => cycleDay(state.settings.cycleStartDate, today, state.settings.cycleShift, menu.cycleDays),
    [state.settings.cycleStartDate, state.settings.cycleShift, today, menu.cycleDays]
  )
  const batchDayNum = batchDay(cycleDayNum)

  /* Ручной выбор приёма живёт до следующего приёма по времени, а не вечно:
     он запомнил, какой приём был текущим в момент выбора, и когда время
     переводит стрелку на следующий, выбор отпускается сам. Без этого вернуться
     к «сейчас» можно было только перезагрузкой страницы. */
  const slot = manualSlot && manualSlot.pinnedTo === autoSlot ? manualSlot.slot : autoSlot

  const handleSelectSlot = useCallback((next: Slot) => {
    // привязка к текущему значению autoSlot, а не к свежему времени: иначе в
    // минуту перехода выбор оказался бы просроченным ещё до отрисовки
    setManualSlot({ slot: next, pinnedTo: autoSlot })
  }, [autoSlot])

  const menuDay = useMemo(() => menu.days.find(d => d.day === cycleDayNum), [menu, cycleDayNum])
  const meal: Meal | undefined = useMemo(() => menuDay?.meals.find(m => m.slot === slot), [menuDay, slot])
  const currentMealKbju = useMemo(() => (meal ? mealKbju(meal, products) : ZERO_KBJU), [meal, products])
  const currentMealNutrients = useMemo(
    () => (meal ? mealNutrients(meal, products) : NO_NUTRIENTS),
    [meal, products]
  )

  const dayLog = state.log[today]
  const entry = dayLog?.meals[slot]

  /* Суммы за день считаются один раз и идут и в прогресс дня, и в покрытие
     норм: нормы суточные, сравнивать с ними один приём было бы враньём.
     Дня без записей нет — тогда это «нет данных», а не нули. */
  const dayKbju = useMemo(() => (dayLog ? dayTotal(dayLog) : ZERO_KBJU), [dayLog])
  const dayNutrients = useMemo(
    () => (dayLog ? dayNutrientTotals(dayLog) : NO_NUTRIENTS),
    [dayLog]
  )

  /* Плюсы и минусы считаются по ТЕКУЩЕМУ приёму, а не по дню: они про то, что
     сейчас в контейнере. Правила — в core/verdict.ts, экран их не повторяет. */
  const verdict = useMemo(
    () => (meal ? mealVerdict(meal, currentMealNutrients, norms, state.preferences) : NO_VERDICT),
    [meal, currentMealNutrients, norms, state.preferences]
  )
  const currentRating = meal ? ratingOf(state.preferences, meal.id) : undefined

  /* Прогресс дня рисуется сегментами по всем четырём приёмам, поэтому экрану
     нужен весь день, а не только текущий приём. План берётся из меню; если
     меню на приём нет, а запись есть — планом считается снапшот записи, иначе
     съеденное некуда было бы вписать. */
  const daySlots: DaySlotProgress[] = useMemo(() => SLOTS.map(s => {
    const slotMeal = menuDay?.meals.find(m => m.slot === s)
    const slotEntry = dayLog?.meals[s]
    const plannedKcal = slotMeal
      ? mealKbju(slotMeal, products).kcal
      : (slotEntry?.kbju.kcal ?? 0)
    return {
      slot: s,
      plannedKcal,
      eatenKcal: slotEntry ? slotEntry.kbju.kcal * slotEntry.fraction : 0,
      status: slotEntry?.status
    }
  }), [menuDay, dayLog, products])

  const updateSettings = useCallback((settings: Settings) => {
    setState(prev => ({ ...prev, settings }))
  }, [])

  const handleClearLog = useCallback(() => {
    setState(prev => clearLog(prev))
  }, [])

  /* Книга предпочтений. Отметка «всё равно» приходит как null и СНИМАЕТ запись:
     нейтральное отношение — это отсутствие мнения, а не третье мнение. */
  const handleSetStance = useCallback((productId: string, stance: IngredientStance | null) => {
    setState(prev => ({ ...prev, preferences: setStance(prev.preferences, productId, stance) }))
  }, [])

  const handleRate = useCallback((mealId: string, score: number, comment: string) => {
    const now = new Date().toISOString()
    setState(prev => ({ ...prev, preferences: rateDish(prev.preferences, mealId, score, comment, now) }))
  }, [])

  const handleClearRating = useCallback((mealId: string) => {
    setState(prev => ({ ...prev, preferences: clearRating(prev.preferences, mealId) }))
  }, [])

  /* Экран приёма оценивает то блюдо, которое на нём открыто, и потому не знает
     про идентификаторы: он зовёт эти две обёртки, а не общие обработчики. */
  const handleRateCurrent = useCallback((score: number, comment: string) => {
    if (meal) handleRate(meal.id, score, comment)
  }, [meal, handleRate])

  const handleClearRatingCurrent = useCallback(() => {
    if (meal) handleClearRating(meal.id)
  }, [meal, handleClearRating])

  const handleLog = useCallback((status: MealStatus, fraction: number) => {
    if (!meal) return
    const now = new Date()
    setState(prev => logMeal(prev, today, slot, meal, products, status, fraction, cycleDayNum, now.toISOString()))
  }, [meal, products, slot, today, cycleDayNum])

  const handleUnlog = useCallback(() => {
    setState(prev => unlogMeal(prev, today, slot))
  }, [today, slot])

  const handleOpenExport = useCallback(() => {
    if (!entry || !meal) return
    const payload: ExportPayload = {
      kind: 'meal',
      date: today,
      slot,
      title: entry.title,
      kbju: entry.kbju,
      nutrients: entry.nutrients,
      fraction: entry.fraction
    }
    setExportPayload(payload)
  }, [entry, meal, today, slot])

  /* Выгрузка целого дня. Порядок приёмов задаётся SLOTS в сборщиках (CSV и
     текст), поэтому здесь достаточно отдать записи как есть. Суммы уже
     съеденные: dayTotal и dayNutrientTotals применяют долю каждой записи. */
  const handleOpenDayExport = useCallback(() => {
    if (!dayLog) return
    const payload: ExportPayload = {
      kind: 'day',
      date: today,
      meals: Object.values(dayLog.meals).filter((m): m is NonNullable<typeof m> => Boolean(m)),
      total: dayTotal(dayLog),
      nutrients: dayNutrientTotals(dayLog)
    }
    setExportPayload(payload)
  }, [dayLog, today])

  const channels = useMemo(
    () => buildChannels({ getShortcutName: () => state.settings.shortcutName, appUrl: currentAppUrl() }),
    [state.settings.shortcutName]
  )

  const handleExportConfirmed = useCallback(() => {
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  return (
    <>
      {saveError && <div className="save-error" role="alert">{saveError}</div>}
      <MealScreen
        cycleDayNum={cycleDayNum}
        cycleDays={menu.cycleDays}
        batchDayNum={batchDayNum}
        slot={slot}
        currentSlot={autoSlot}
        onSelectSlot={handleSelectSlot}
        meal={meal}
        mealKbju={currentMealKbju}
        mealNutrients={currentMealNutrients}
        dayNutrients={dayNutrients}
        norms={norms}
        preferences={state.preferences}
        verdict={verdict}
        products={products}
        entry={entry}
        rating={currentRating}
        onRate={handleRateCurrent}
        onClearRating={handleClearRatingCurrent}
        daySlots={daySlots}
        dayEatenKcal={dayKbju.kcal}
        targetKcal={state.settings.targetKcal}
        dayProteinG={dayKbju.p}
        targetProteinG={state.settings.targetProteinG}
        hasDayLog={Boolean(dayLog && Object.keys(dayLog.meals).length > 0)}
        onLog={handleLog}
        onUnlog={handleUnlog}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenWeek={() => setWeekOpen(true)}
        onOpenBook={() => setBookOpen(true)}
        onOpenExport={handleOpenExport}
        onOpenDayExport={handleOpenDayExport}
      />

      {settingsOpen && (
        <SettingsSheet
          settings={state.settings}
          cycleDays={menu.cycleDays}
          log={state.log}
          onChange={updateSettings}
          onClearLog={handleClearLog}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {weekOpen && (
        <WeekSheet
          log={state.log}
          today={today}
          targetKcal={state.settings.targetKcal}
          targetProteinG={state.settings.targetProteinG}
          norms={norms}
          onClose={() => setWeekOpen(false)}
        />
      )}

      {bookOpen && (
        <BookSheet
          menu={menu}
          products={products}
          preferences={state.preferences}
          onSetStance={handleSetStance}
          onRate={handleRate}
          onClearRating={handleClearRating}
          onClose={() => setBookOpen(false)}
        />
      )}

      {exportPayload && (
        <Sheet title="Выгрузить" onClose={() => setExportPayload(null)}>
          <ExportSheet payload={exportPayload} channels={channels} onConfirmed={handleExportConfirmed} />
        </Sheet>
      )}

      <UpdateBanner />
    </>
  )
}
