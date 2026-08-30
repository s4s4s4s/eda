/* Держит AppState, грузит меню и справочник, считает день цикла и текущий
   приём, раздаёт пропсы главному экрану и шторкам, сохраняет состояние при
   каждом изменении. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { batchDay, currentSlot, cycleDay, todayLocal } from '../core/cycle.ts'
import { buildChannels } from '../core/export/index.ts'
import type { ExportPayload } from '../core/export/index.ts'
import { dayTotal, logMeal, unlogMeal } from '../core/log.ts'
import { emptyNutrientTotals, mealKbju, mealNutrients } from '../core/nutrition.ts'
import type { AppState, Kbju, Meal, MealStatus, NutrientTotals, Settings, Slot } from '../core/types.ts'
import { loadData } from '../data/load.ts'
import { defaultState, loadState, saveState } from '../state/storage.ts'
import MealScreen from './MealScreen.tsx'
import SettingsSheet from './SettingsSheet.tsx'
import ExportSheet from './ExportSheet.tsx'

const ZERO_KBJU: Kbju = { kcal: 0, p: 0, f: 0, c: 0 }
/** Пустая сумма нутриентов: known === 0 по всем ключам, то есть «нет данных»,
    а не «нулевые значения». Показывается, когда меню на приём не найдено. */
const NO_NUTRIENTS: NutrientTotals = emptyNutrientTotals()

function minutesOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes()
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
  const [manualSlot, setManualSlot] = useState<Slot | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
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

  const { menu, products } = useMemo(() => loadData(), [])

  const today = useMemo(() => todayLocal(new Date()), [])
  const cycleDayNum = useMemo(
    () => cycleDay(state.settings.cycleStartDate, today, state.settings.cycleShift, menu.cycleDays),
    [state.settings.cycleStartDate, state.settings.cycleShift, today, menu.cycleDays]
  )
  const batchDayNum = batchDay(cycleDayNum)

  const [autoSlot, setAutoSlot] = useState<Slot>(() => currentSlot(minutesOfDay(new Date())))
  useEffect(() => {
    const id = window.setInterval(() => {
      setAutoSlot(currentSlot(minutesOfDay(new Date())))
    }, 60_000)
    return () => window.clearInterval(id)
  }, [])

  const slot = manualSlot ?? autoSlot

  const menuDay = useMemo(() => menu.days.find(d => d.day === cycleDayNum), [menu, cycleDayNum])
  const meal: Meal | undefined = useMemo(() => menuDay?.meals.find(m => m.slot === slot), [menuDay, slot])
  const currentMealKbju = useMemo(() => (meal ? mealKbju(meal, products) : ZERO_KBJU), [meal, products])
  const currentMealNutrients = useMemo(
    () => (meal ? mealNutrients(meal, products) : NO_NUTRIENTS),
    [meal, products]
  )

  const dayLog = state.log[today]
  const entry = dayLog?.meals[slot]
  const dayEatenKcal = useMemo(() => (dayLog ? dayTotal(dayLog).kcal : 0), [dayLog])

  const updateSettings = useCallback((settings: Settings) => {
    setState(prev => ({ ...prev, settings }))
  }, [])

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
        isCurrentSlot={slot === autoSlot}
        onSelectSlot={setManualSlot}
        meal={meal}
        mealKbju={currentMealKbju}
        mealNutrients={currentMealNutrients}
        products={products}
        entry={entry}
        dayEatenKcal={dayEatenKcal}
        targetKcal={state.settings.targetKcal}
        onLog={handleLog}
        onUnlog={handleUnlog}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenExport={handleOpenExport}
      />

      {settingsOpen && (
        <SettingsSheet
          settings={state.settings}
          cycleDays={menu.cycleDays}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {exportPayload && (
        <div className="sheet">
          <div className="sheet__backdrop" onClick={() => setExportPayload(null)} />
          <div className="sheet__panel">
            <header className="sheet__header">
              <h1 className="sheet__title">Выгрузить</h1>
              <button type="button" className="sheet__close" onClick={() => setExportPayload(null)} aria-label="Закрыть">✕</button>
            </header>
            <div className="sheet__body">
              <ExportSheet payload={exportPayload} channels={channels} onConfirmed={handleExportConfirmed} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
