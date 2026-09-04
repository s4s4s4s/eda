/* Держит AppState, грузит меню, справочник и нормы, считает день цикла и
   текущий приём, раздаёт пропсы главному экрану и шторкам, сохраняет
   состояние при каждом изменении. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { batchDay, currentSlot, cycleDay, todayLocal } from '../core/cycle.ts'
import { buildChannels } from '../core/export/index.ts'
import type { ExportPayload } from '../core/export/index.ts'
import { addExtra, clearLog, dayNutrientTotals, dayTotal, logMeal, removeExtra, unlogMeal } from '../core/log.ts'
import { menuDayFor } from '../core/menu.ts'
import {
  applyFoodAsk, customExtraFrom, discardFoodRequest, menuExtraFrom, newFoodRequest,
  removeCustomFood, retryFoodRequest, saveCustomFood
} from '../core/food.ts'
import { askFood, SHTURMAN_BASE } from '../core/foodClient.ts'
import { emptyNutrientTotals, mealKbju, mealNutrients, scaleNutrientTotals } from '../core/nutrition.ts'
import { clearRating, rateDish, ratingOf, setStance } from '../core/preferences.ts'
import { mealVerdict } from '../core/verdict.ts'
import type { MealVerdict } from '../core/verdict.ts'
import { SLOTS } from '../core/types.ts'
import type {
  AppState, CustomFood, IngredientStance, Kbju, Meal, MealStatus, NutrientTotals, Settings, Slot
} from '../core/types.ts'
import { loadData } from '../data/load.ts'
import { BACKUP_KEY, defaultState, loadState, saveState } from '../state/storage.ts'
import type { StateSource } from '../state/storage.ts'
import MealScreen from './MealScreen.tsx'
import DaySummary from './DaySummary.tsx'
import ScreenHeader from './ScreenHeader.tsx'
import SlotSwitch from './SlotSwitch.tsx'
import TabBar from './TabBar.tsx'
import type { DaySlotProgress } from './slots.ts'
import AddFromMenuSheet from './AddFromMenuSheet.tsx'
import CustomFoodSheet from './CustomFoodSheet.tsx'
import { useFoodPolling } from './useFoodPolling.ts'
import Sheet from './Sheet.tsx'
import SettingsSheet from './SettingsSheet.tsx'
import ExportSheet from './ExportSheet.tsx'
import WeekSheet from './WeekSheet.tsx'
import BookSheet from './BookSheet.tsx'
import UpdateBanner from './UpdateBanner.tsx'

/** Вид главного экрана: сводка дня или конкретный приём. При открытии
    приложения и при смене календарного дня вид — всегда `'day'` (см. эффект
    сброса `manualView` в компоненте ниже); выбор приёма живёт, пока не
    сменилось окно текущего приёма по времени (см. `ManualView`). */
export type View = 'day' | Slot

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

/** Ручной выбор вида вместе с тем приёмом, который был текущим в момент
    выбора: сравнение с ним отпускает выбор, когда время идёт дальше — тогда
    вид возвращается к сводке дня (`'day'`), а не к приёму, который наступил.
    Выбор сводки отдельно не запоминается: она и так вид по умолчанию, пока
    ручного выбора приёма нет или он истёк (см. `view` в App). */
interface ManualView {
  view: View
  pinnedTo: Slot
}

/** appUrl для x-callback-url Shortcuts: адрес приложения без query-параметров. */
function currentAppUrl(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}`
}

/** Русское склонение слова «запись» по числу (запись/записи/записей). Та же
    таблица, что и у daysWord в WeekSheet.tsx/SettingsSheet.tsx — своя копия,
    а не импорт: WeekSheet сейчас правит параллельно другой агент. */
function entryWord(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return 'записей'
  switch (n % 10) {
    case 1: return 'запись'
    case 2:
    case 3:
    case 4: return 'записи'
    default: return 'записей'
  }
}

/** Текст красной полосы для 'corrupt' и для dropped > 0 — оба случая ведут на
    один и тот же BACKUP_KEY, и оба говорят человеку, где искать потерянное. */
function corruptNoticeText(): string {
  return 'Дневник в памяти браузера не прочитался (повреждён). Приложение начало с пустого дневника; '
    + `исходный текст сохранён в браузере под ключом ${BACKUP_KEY}`
}

function droppedNoticeText(dropped: number): string {
  const verb = dropped === 1 ? 'повреждена и пропущена' : 'повреждены и пропущены'
  return `${dropped} ${entryWord(dropped)} дневника или своей еды ${verb}; исходный текст сохранён под ключом ${BACKUP_KEY}`
}

export default function App() {
  /* Загрузка читает localStorage один раз при монтировании — вместе с тем,
     каким источником оказалось прочитанное. Источник держим рядом с самим
     state, а не пересчитываем: 'newer-version' решает, можно ли вообще писать
     в хранилище (см. useEffect автосохранения ниже), и это решение не должно
     меняться в течение сессии — новая сборка узнает об этом только после
     перезагрузки. */
  const [initialLoad] = useState(() => {
    try {
      return loadState()
    } catch {
      return { state: defaultState(), source: 'default' as StateSource, dropped: 0 }
    }
  })
  const [state, setState] = useState<AppState>(initialLoad.state)
  const [stateSource] = useState<StateSource>(initialLoad.source)
  /* Сколько записей приёмов не пережило санитизацию при ЭТОЙ загрузке — число
     живёт рядом с source по той же причине: пересчитывать его позже не из
     чего, санитизация происходит один раз, при чтении localStorage. */
  const [initialDropped] = useState<number>(initialLoad.dropped)
  const [manualView, setManualView] = useState<ManualView | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [weekOpen, setWeekOpen] = useState(false)
  const [bookOpen, setBookOpen] = useState(false)
  const [addFromMenuOpen, setAddFromMenuOpen] = useState(false)
  /* Открытие шторки «Своя еда» (CustomFoodSheet) — задача E4b. */
  const [customFoodOpen, setCustomFoodOpen] = useState(false)
  const [exportPayload, setExportPayload] = useState<ExportPayload | null>(null)

  /* Провал сохранения не глушим: экран обязан сказать, что записанного приёма
     в дневнике нет. Молчание здесь означало бы, что человек видит запись,
     которой на диске не существует, и узнает об этом только потеряв её. */
  const [saveError, setSaveError] = useState<string | null>(null)

  /* Полоса про 'corrupt'/dropped закрывается кнопкой «Понятно» — но только до
     перезагрузки: состояние живёт в памяти вкладки, а не в хранилище, чтобы
     не спрятать находку от следующего визита, если человек её не прочитал. */
  const [loadNoticeDismissed, setLoadNoticeDismissed] = useState(false)

  /* Пока source === 'newer-version', хранилище держит состояние сборки НОВЕЕ
     этой — а state в памяти при этом дефолтный (см. deserialize). Сохранить
     его значило бы затереть данные, которых эта сборка просто не умеет
     прочитать. Автосохранение выключается целиком, а не «кроме дневника»:
     частичной записи здесь быть не может — банер на экране объясняет причину. */
  useEffect(() => {
    if (stateSource === 'newer-version') return
    const result = saveState(state)
    setSaveError(result.ok ? null : result.error)
  }, [state, stateSource])

  // возврат из Команд может принести ?exported=... на уже перезагруженную
  // страницу (ExportSheet больше не смонтирован) — подчищаем адресную строку,
  // чтобы параметр не переигрывался при следующем открытии
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('exported') && !exportPayload) {
      window.history.replaceState(null, '', window.location.pathname)
    }
    // Пустой массив зависимостей — намеренно, а не забытый exportPayload: этот
    // эффект должен отработать РОВНО ОДИН РАЗ, сразу после монтирования, чтобы
    // подчистить query-параметр от возврата из Команд на уже перезагруженной
    // странице. Пока шторка экспорта открыта в этой же сессии, за возвратом
    // следит сам ExportSheet (readCallback/visibilitychange) — этому эффекту
    // реагировать на смену exportPayload не нужно и не следует: рестарт
    // эффекта на каждое открытие/закрытие шторки не добавил бы ничего, кроме
    // лишних перечитываний адресной строки.
  }, [])

  const { menu, products, norms, productsRevision } = useMemo(() => loadData(), [])

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

  /* Смена календарного дня возвращает вид к сводке — вчерашний ручной выбор
     приёма не должен пережить полночь: он отвечал на вопрос про вчера, а не
     про сегодня. `today` меняется тем же таймером, что и autoSlot (см. выше),
     поэтому один эффект на него ловит и полночь, и открытие приложения в
     новый день. */
  useEffect(() => {
    setManualView(null)
  }, [today])

  const cycleDayNum = useMemo(
    () => cycleDay(state.settings.cycleStartDate, today, state.settings.cycleShift, menu.cycleDays),
    [state.settings.cycleStartDate, state.settings.cycleShift, today, menu.cycleDays]
  )
  const batchDayNum = batchDay(cycleDayNum)

  /* Ручной выбор вида живёт до следующего приёма по времени, а не вечно: он
     запомнил, какой приём был текущим в момент выбора, и когда время
     переводит стрелку на следующий, выбор отпускается сам — вид возвращается
     к сводке дня. Без этого вернуться к сводке можно было только вручную. */
  const view: View = manualView && manualView.pinnedTo === autoSlot ? manualView.view : 'day'
  /* Приём, содержимое которого сейчас читается/пишется: сама сводка дня его
     не показывает, но хуки ниже (meal/entry/verdict/…) должны получать
     конкретный слот независимо от вида — на сводке это текущий по времени. */
  const activeSlot: Slot = view === 'day' ? autoSlot : view

  const handleSelectView = useCallback((next: View) => {
    // привязка к текущему значению autoSlot, а не к свежему времени: иначе в
    // минуту перехода выбор оказался бы просроченным ещё до отрисовки
    setManualView({ view: next, pinnedTo: autoSlot })
  }, [autoSlot])

  /* Какая редакция меню действует на этот день, решает core/menu.ts: экран не
     перебирает редакции сам, иначе правило выбора разъехалось бы по копиям. */
  const menuToday = useMemo(() => menuDayFor(menu, today, cycleDayNum), [menu, today, cycleDayNum])
  const menuDay = menuToday?.day
  const meal: Meal | undefined = useMemo(
    () => menuDay?.meals.find(m => m.slot === activeSlot),
    [menuDay, activeSlot]
  )

  const dayLog = state.log[today]
  const entry = dayLog?.meals[activeSlot]

  /* Правда о приёме: меню есть — она из меню, это состав, который можно
     собрать заново. Меню нет, но приём уже записан — правда только в снапшоте
     записи (entry.kbju/entry.nutrients), состав по нему не восстановить, и
     экран его не рисует. Нет ни того, ни другого — данных о приёме нет вовсе,
     а не «ноль»: undefined, а не ZERO_KBJU под видом настоящих чисел. */
  const currentMealKbju: Kbju | undefined = useMemo(() => {
    if (meal) return mealKbju(meal, products)
    if (entry) return entry.kbju
    return undefined
  }, [meal, entry, products])
  const currentMealNutrients = useMemo(() => {
    if (meal) return mealNutrients(meal, products)
    if (entry) return entry.nutrients
    return NO_NUTRIENTS
  }, [meal, entry, products])

  /* Суммы за день считаются один раз и идут и в прогресс дня, и в покрытие
     норм: нормы суточные, сравнивать с ними один приём было бы враньём.
     Дня без записей нет — тогда это «нет данных», а не нули. */
  const dayKbju = useMemo(() => (dayLog ? dayTotal(dayLog) : ZERO_KBJU), [dayLog])
  const dayNutrients = useMemo(
    () => (dayLog ? dayNutrientTotals(dayLog) : NO_NUTRIENTS),
    [dayLog]
  )

  /* Числа нутриентов идут по ПОЙМАННОМУ ПРИЁМУ, когда он записан: запись —
     факт, что было съедено, и он не должен зависеть от того, что сейчас лежит
     в меню. Пропущенный приём не разбирается вовсе (сказать нечего — не «всё
     плохо», см. MealVerdictBlock), «съел часть» считается по доле снапшота
     (scaleNutrientTotals), «съел целиком» — по снапшоту без масштабирования.
     Ничего не записано — вердикт по живому meal, как раньше: это подсказка на
     будущее, а не факт прошлого.
     mealVerdict при этом ВСЕГДА получает живой `meal`, а не снапшот состава:
     MealLogEntry состав приёма (items) не хранит вовсе, поэтому «любимое»/«не
     ем» внутри mealVerdict (mealStances(meal, prefs)) — это всегда текущий
     состав блюда с этим id в меню, а не то, что реально было в контейнере в
     момент записи. Поправят состав блюда задним числом — эти строки у уже
     записанного приёма станут говорить про новый состав (см. DESIGN.md,
     «Плюсы и минусы приёма»). */
  const verdict = useMemo(() => {
    if (!meal) return NO_VERDICT
    if (entry) {
      if (entry.status === 'skipped') return NO_VERDICT
      const nutrientsForVerdict = entry.status === 'partial'
        ? scaleNutrientTotals(entry.nutrients, entry.fraction)
        : entry.nutrients
      return mealVerdict(meal, nutrientsForVerdict, norms, state.preferences)
    }
    return mealVerdict(meal, currentMealNutrients, norms, state.preferences)
  }, [meal, entry, currentMealNutrients, norms, state.preferences])
  const currentRating = meal ? ratingOf(state.preferences, meal.id) : undefined

  /* Прогресс дня рисуется сегментами по всем четырём приёмам, поэтому экрану
     нужен весь день, а не только текущий приём. План берётся из меню; если
     меню на приём нет, а запись есть — планом считается снапшот записи, иначе
     съеденное некуда было бы вписать. */
  const dayExtras = dayLog?.extras ?? []

  const daySlots: DaySlotProgress[] = useMemo(() => SLOTS.map(s => {
    const slotMeal = menuDay?.meals.find(m => m.slot === s)
    const slotEntry = dayLog?.meals[s]
    /* Один и тот же источник правды на все плановые числа слота: меню, если
       блюдо на приём есть, иначе снапшот записи. Считается разом, чтобы
       ккал, жиры и углеводы не разъехались по разным веткам. */
    const plannedKbju = slotMeal ? mealKbju(slotMeal, products) : slotEntry?.kbju
    const plannedKcal = plannedKbju?.kcal ?? 0
    const extrasKcal = (dayLog?.extras ?? [])
      .filter(e => e.slot === s)
      .reduce((sum, e) => sum + e.kbju.kcal * e.fraction, 0)
    return {
      slot: s,
      // название блюда для карточки сводки: меню, если оно есть, иначе
      // снапшот записи (меню могло измениться или пропасть после записи) —
      // та же приоритетность источника правды, что и у mealKbju/mealNutrients
      // выше для текущего открытого приёма.
      title: slotMeal?.title ?? slotEntry?.title,
      plannedKcal,
      plannedFatG: plannedKbju?.f ?? 0,
      plannedCarbsG: plannedKbju?.c ?? 0,
      eatenKcal: slotEntry ? slotEntry.kbju.kcal * slotEntry.fraction : 0,
      status: slotEntry?.status,
      fraction: slotEntry?.fraction,
      productsRevision: slotEntry?.productsRevision,
      extrasKcal
    }
  }), [menuDay, dayLog, products])

  /* План меню на день по жирам и углеводам - сумма по четырём приёмам. Целей
     по ним в настройках нет и выдумывать их нельзя (DESIGN.md, «Честность -
     часть дизайна»), поэтому знаменателем этих двух макросов на сводке дня
     работает план меню, а не норма. */
  const dayPlannedFatG = useMemo(
    () => daySlots.reduce((sum, s) => sum + s.plannedFatG, 0),
    [daySlots]
  )
  const dayPlannedCarbsG = useMemo(
    () => daySlots.reduce((sum, s) => sum + s.plannedCarbsG, 0),
    [daySlots]
  )

  /* Ручная правка даты старта цикла — не то же самое, что «всё верно»: она
     МЕНЯЕТ дату, а значит человек её уже проверил. Оба случая закрывают
     баннер первого запуска (см. handleConfirmCycleStart), но правку даты
     нельзя доверить SettingsSheet — confirmed форсируется здесь, единственном
     месте, где settings реально попадают в state. */
  const updateSettings = useCallback((settings: Settings) => {
    setState(prev => {
      const cycleStartChanged = settings.cycleStartDate !== prev.settings.cycleStartDate
      return {
        ...prev,
        settings: cycleStartChanged ? { ...settings, cycleStartConfirmed: true } : settings
      }
    })
  }, [])

  /* Кнопка «Всё верно» в баннере первого запуска: дату не трогает, просто
     закрывает вопрос. */
  const handleConfirmCycleStart = useCallback(() => {
    setState(prev => ({ ...prev, settings: { ...prev.settings, cycleStartConfirmed: true } }))
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

  /* onLog принимает слот явно, а не берёт его из замыкания: сводка дня зовёт
     его для ЛЮБОГО из четырёх приёмов кнопкой «Съел» в карточке, не открывая
     экран приёма, поэтому блюдо ищется в меню по переданному слоту, а не в
     переменной `meal` (та — только про activeSlot, открытый сейчас экран). */
  const handleLog = useCallback((targetSlot: Slot, status: MealStatus, fraction: number) => {
    const targetMeal = menuDay?.meals.find(m => m.slot === targetSlot)
    if (!targetMeal) return
    const now = new Date()
    setState(prev => logMeal(
      prev, today, targetSlot, targetMeal, products, status, fraction, cycleDayNum, now.toISOString(), productsRevision
    ))
  }, [menuDay, products, today, cycleDayNum, productsRevision])

  const handleUnlog = useCallback((targetSlot: Slot) => {
    setState(prev => unlogMeal(prev, today, targetSlot))
  }, [today])

  /* Перенос блюда из другого дня цикла: снапшот (menuExtraFrom) считает та же
     арифметика, что и обычную запись меню (mealKbju/mealNutrients внутри
     food.ts), поэтому число не может разойтись с тем, что показала бы обычная
     запись того же блюда. Дата записи выбирается в шторке и может
     отличаться от сегодняшней, поэтому день цикла считается под неё, как в
     handleSaveCustomFood. */
  const handleAddFromMenu = useCallback((
    fromCycleDay: number, meal: Meal, target: { date: string; slot: Slot }, fraction: number
  ) => {
    const now = new Date().toISOString()
    const extra = menuExtraFrom(meal, products, target.slot, fraction, fromCycleDay, crypto.randomUUID(), now, productsRevision)
    const targetCycleDay = cycleDay(state.settings.cycleStartDate, target.date, state.settings.cycleShift, menu.cycleDays)
    setState(prev => addExtra(prev, target.date, extra, targetCycleDay))
    setAddFromMenuOpen(false)
  }, [products, productsRevision, state.settings.cycleStartDate, state.settings.cycleShift, menu.cycleDays])

  const handleRemoveExtra = useCallback((extraId: string) => {
    setState(prev => removeExtra(prev, today, extraId))
  }, [today])

  /* Опрос заказов на разбор своей еды идёт независимо от того, открыта ли
     CustomFoodSheet: foodRequests лежат в AppState и переживают закрытие
     шторки (см. useFoodPolling.ts, раздел 1.7 плана «своя еда»). */
  const foodPollError = useFoodPolling(state, setState, SHTURMAN_BASE, state.settings.shturmanToken)

  /* Новый заказ на разбор: id заводится здесь (эффект стороны — не ядро),
     askFood зовёт воркер, и только при успехе заказ попадает в состояние
     через applyFoodAsk. Провал сети/токена ничего не кладёт в очередь —
     CustomFoodSheet показывает причину под кнопкой отправки. */
  const handleAskFood = useCallback(async (
    text: string, grams: number | null, target: { date: string; slot: Slot }
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    const id = crypto.randomUUID()
    const result = await askFood(SHTURMAN_BASE, state.settings.shturmanToken, { id, text, grams })
    if (!result.ok) return { ok: false, error: result.error }
    const now = new Date().toISOString()
    setState(prev => applyFoodAsk(prev, newFoodRequest(id, text, grams, target, now)))
    return { ok: true }
  }, [state.settings.shturmanToken])

  /* «Повторить» на failed/expired — новый askFood с тем же текстом под новым
     uuid; заказ в очереди заменяется (retryFoodRequest), а не дублируется,
     и только при успешном ответе воркера — неудачная попытка не должна
     стирать прежний заказ, за которым, может, ещё стоит следить. */
  const handleRetryFoodRequest = useCallback(async (
    id: string
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    const existing = state.foodRequests.find(r => r.id === id)
    if (!existing) return { ok: false, error: 'Этот заказ уже убран из очереди.' }
    const newId = crypto.randomUUID()
    const result = await askFood(
      SHTURMAN_BASE, state.settings.shturmanToken, { id: newId, text: existing.text, grams: existing.grams }
    )
    if (!result.ok) return { ok: false, error: result.error }
    const now = new Date().toISOString()
    setState(prev => retryFoodRequest(prev, id, newId, now))
    return { ok: true }
  }, [state.foodRequests, state.settings.shturmanToken])

  const handleDiscardFoodRequest = useCallback((id: string) => {
    setState(prev => discardFoodRequest(prev, id))
  }, [])

  /* «Сохранить и записать» на готовом разборе: кладёт еду в книгу, пишет
     extra на целевую дату/приём и убирает выполненный заказ — три перехода
     одним действием (saveCustomFood в core/food.ts). Целевая дата может
     отличаться от сегодняшней (человек мог поправить её в самой строке),
     поэтому cycleDay считается заново под неё, а не берётся cycleDayNum. */
  const handleSaveCustomFood = useCallback((
    requestId: string, editedFood: CustomFood, target: { date: string; slot: Slot }, fraction: number
  ) => {
    const now = new Date().toISOString()
    const targetCycleDay = cycleDay(state.settings.cycleStartDate, target.date, state.settings.cycleShift, menu.cycleDays)
    setState(prev => saveCustomFood(prev, requestId, editedFood, target, fraction, crypto.randomUUID(), now, targetCycleDay))
  }, [state.settings.cycleStartDate, state.settings.cycleShift, menu.cycleDays])

  const handleRemoveCustomFood = useCallback((foodId: string) => {
    setState(prev => removeCustomFood(prev, foodId))
  }, [])

  /* Добавление из книги своей еды — снапшот полной порции (customExtraFrom)
     плюс запись в дневник, ровно как перенос блюда меню (handleAddFromMenu),
     только на сегодняшний день и текущий cycleDayNum: книга добавляется «в
     день», который сейчас открыт на главном экране. */
  const handleAddCustomFoodFromBook = useCallback((food: CustomFood, slot: Slot, fraction: number) => {
    const now = new Date().toISOString()
    const extra = customExtraFrom(food, slot, fraction, crypto.randomUUID(), now)
    setState(prev => addExtra(prev, today, extra, cycleDayNum))
  }, [today, cycleDayNum])

  const handleOpenExport = useCallback(() => {
    if (!entry || !meal) return
    const payload: ExportPayload = {
      kind: 'meal',
      date: today,
      slot: activeSlot,
      title: entry.title,
      kbju: entry.kbju,
      nutrients: entry.nutrients,
      fraction: entry.fraction
    }
    setExportPayload(payload)
  }, [entry, meal, today, activeSlot])

  /* Выгрузка целого дня. Порядок приёмов задаётся SLOTS в сборщиках (CSV и
     текст), поэтому здесь достаточно отдать записи как есть. Суммы уже
     съеденные: dayTotal и dayNutrientTotals применяют долю каждой записи. */
  const handleOpenDayExport = useCallback(() => {
    if (!dayLog) return
    const payload: ExportPayload = {
      kind: 'day',
      date: today,
      meals: Object.values(dayLog.meals).filter((m): m is NonNullable<typeof m> => Boolean(m)),
      // добавленное сверх меню входит в total и nutrients (dayTotal их считает),
      // поэтому уходит в выгрузку своими строками — иначе день в CSV не сошёлся
      // бы со своим же итогом.
      extras: dayLog.extras,
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

  /* Полоса про потерю при чтении хранилища существует, только пока есть что
     показать (corrupt или dropped > 0 при ЭТОЙ загрузке) и человек её ещё не
     закрыл кнопкой «Понятно». */
  const showLoadNotice = !loadNoticeDismissed && (stateSource === 'corrupt' || initialDropped > 0)
  const loadNoticeText = stateSource === 'corrupt' ? corruptNoticeText() : droppedNoticeText(initialDropped)

  return (
    <>
      {/* Приоритет полос сверху вниз: 'newer-version' (без кнопки — состояние
          неавторитетно целиком, закрыть эту причину нечем) > потеря при чтении
          хранилища ('corrupt'/dropped, с кнопкой «Понятно») > провал текущего
          сохранения. Они не показываются одновременно: важнее — та причина,
          из-за которой человек рискует не заметить остальные. */}
      {stateSource === 'newer-version'
        ? (
          <div className="save-error" role="alert">
            На этом устройстве данные записаны более новой версией приложения.
            Обновите приложение — дневник не тронут, записи сейчас не сохраняются.
          </div>
        )
        : showLoadNotice
          ? (
            <div className="save-error" role="alert">
              <span className="save-error__text">{loadNoticeText}</span>
              <button
                type="button"
                className="save-error__dismiss"
                onClick={() => setLoadNoticeDismissed(true)}
              >
                Понятно
              </button>
            </div>
          )
          : (saveError && <div className="save-error" role="alert">{saveError}</div>)}
      {/* Модификатор вида нужен CSS, а не логике: на сводке низ экрана держит
          панель вкладок, на экране приёма - липкая панель действий, и отступ
          снизу у них разный (layout.css, .screen--day). */}
      <div className={`screen${view === 'day' ? ' screen--day' : ''}`}>
        <ScreenHeader
          date={today}
          cycleDayNum={cycleDayNum}
          cycleDays={menu.cycleDays}
          batchDayNum={batchDayNum}
          cycleStartDate={state.settings.cycleStartDate}
          cycleStartConfirmed={state.settings.cycleStartConfirmed}
          onConfirmCycleStart={handleConfirmCycleStart}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <div className={`screen__body screen__body--${view === 'day' ? 'day' : 'meal'}`}>
          {/* Возврат на сводку с экрана приёма. На широком экране скрыт CSS -
              там «Сводка» осталась пунктом боковой колонки. */}
          {view !== 'day' && (
            <button type="button" className="meal-back" onClick={() => handleSelectView('day')}>
              ← Сводка
            </button>
          )}

          {/* Боковая колонка широкого экрана. На узком своей коробки у неё нет
              (display: contents), и обе панели живут по своим правилам:
              переключатель приёмов над содержимым экрана приёма, панель
              вкладок - липкой полосой внизу окна на сводке. */}
          <div className="screen__side">
            <SlotSwitch
              view={view}
              currentSlot={autoSlot}
              daySlots={daySlots}
              onSelect={handleSelectView}
            />
            <TabBar
              view={view}
              onSelectDay={() => handleSelectView('day')}
              onOpenWeek={() => setWeekOpen(true)}
              onOpenBook={() => setBookOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>

          <div className="screen__content">
            {view === 'day'
              ? (
                // key: на смену календарного дня сводка пересоздаётся — раскрытая
                // панель микронутриентов не должна пережить полночь (как и у MealScreen).
                <DaySummary
                  key={today}
                  daySlots={daySlots}
                  currentSlot={autoSlot}
                  onSelectSlot={handleSelectView}
                  onLog={handleLog}
                  dayEatenKcal={dayKbju.kcal}
                  targetKcal={state.settings.targetKcal}
                  dayProteinG={dayKbju.p}
                  targetProteinG={state.settings.targetProteinG}
                  dayFatG={dayKbju.f}
                  dayCarbsG={dayKbju.c}
                  dayPlannedFatG={dayPlannedFatG}
                  dayPlannedCarbsG={dayPlannedCarbsG}
                  hasDayLog={Boolean(dayLog && (Object.keys(dayLog.meals).length > 0 || dayLog.extras.length > 0))}
                  onOpenDayExport={handleOpenDayExport}
                  extras={dayExtras}
                  onRemoveExtra={handleRemoveExtra}
                  onOpenAddFromMenu={() => setAddFromMenuOpen(true)}
                  onOpenCustomFood={() => setCustomFoodOpen(true)}
                  dayNutrients={dayNutrients}
                  norms={norms}
                  productsRevision={productsRevision}
                />
              )
              : (
                <MealScreen
                  // День и приём — разный контекст: локальный выбор режима
                  // нутриентов, раскрытых сносок и «съел часть» не должен
                  // пережить переключение (см. DESIGN.md, «Покрытие норм» —
                  // состояние NutrientsBlock и pickingFraction пересоздаются
                  // React'ом по key, а не синхронизацией).
                  key={`${today}:${activeSlot}`}
                  date={today}
                  slot={activeSlot}
                  currentSlot={autoSlot}
                  onSelectSlot={handleSelectView}
                  meal={meal}
                  mealKbju={currentMealKbju}
                  mealNutrients={currentMealNutrients}
                  dayNutrients={dayNutrients}
                  norms={norms}
                  preferences={state.preferences}
                  verdict={verdict}
                  products={products}
                  entry={entry}
                  productsRevision={productsRevision}
                  rating={currentRating}
                  onRate={handleRateCurrent}
                  onClearRating={handleClearRatingCurrent}
                  daySlots={daySlots}
                  extras={dayExtras}
                  onLog={handleLog}
                  onUnlog={handleUnlog}
                  onOpenExport={handleOpenExport}
                />
              )}
          </div>
        </div>
      </div>

      {settingsOpen && (
        <SettingsSheet
          settings={state.settings}
          cycleDays={menu.cycleDays}
          log={state.log}
          customFoods={state.customFoods}
          onChange={updateSettings}
          onClearLog={handleClearLog}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {addFromMenuOpen && (
        <AddFromMenuSheet
          menu={menu}
          products={products}
          cycleDays={menu.cycleDays}
          currentCycleDay={cycleDayNum}
          defaultDate={today}
          defaultSlot={activeSlot}
          onAdd={handleAddFromMenu}
          onClose={() => setAddFromMenuOpen(false)}
        />
      )}

      {customFoodOpen && (
        <CustomFoodSheet
          token={state.settings.shturmanToken}
          customFoods={state.customFoods}
          foodRequests={state.foodRequests}
          defaultTarget={{ date: today, slot: activeSlot }}
          pollError={foodPollError}
          onAskNew={handleAskFood}
          onRetry={handleRetryFoodRequest}
          onDiscard={handleDiscardFoodRequest}
          onSave={handleSaveCustomFood}
          onRemoveCustomFood={handleRemoveCustomFood}
          onAddFromBook={handleAddCustomFoodFromBook}
          onOpenSettings={() => { setCustomFoodOpen(false); setSettingsOpen(true) }}
          onClose={() => setCustomFoodOpen(false)}
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
