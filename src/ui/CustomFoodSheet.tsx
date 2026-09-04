/* Шторка «Своя еда» (задача E4b): книга своей еды сверху, форма нового заказа
   на разбор, очередь заказов с честными состояниями опроса. Каркас — общий
   Sheet.tsx. Сетевые вызовы (askFood) делает App.tsx через onAskNew/onRetry —
   здесь только форма и отображение результата; опрос (pollFood) целиком живёт
   в useFoodPolling.ts и работает независимо от того, открыта ли эта шторка.

   Тексты состояний очереди — дословно из раздела «E4b» плана «своя еда»:
   отступать от них нельзя, это единственное место, где человек узнаёт, что
   вообще происходит с его запросом на дальнем компьютере. */

import { useState } from 'react'
import { customFoodFromResult, customFoodTotals, withComponentGrams } from '../core/food.ts'
import type { CustomFood, FoodRequest, FoodResultOk, NutrientTotals } from '../core/types.ts'
import { NUTRIENT_KEYS, SLOT_TITLE, SLOTS } from '../core/types.ts'
import type { Slot } from '../core/types.ts'
import { FRACTIONS, fractionLabel } from './fractions.ts'
import Sheet from './Sheet.tsx'

type AskResult = { ok: true } | { ok: false; error: string }

interface CustomFoodSheetProps {
  /** Пустая строка — разбор своей еды не настроен (см. Settings.shturmanToken). */
  token: string
  customFoods: Record<string, CustomFood>
  foodRequests: FoodRequest[]
  /** Куда по умолчанию попадёт новый заказ и куда — уже готовая еда, пока
      человек не поправил дату/приём в самой строке. */
  defaultTarget: { date: string; slot: Slot }
  /** Последняя временная ошибка опроса (сеть, токен) — из useFoodPolling.
      Статус заказов ею не меняется, это отдельная, не привязанная к
      конкретному заказу строка. */
  pollError: string | null
  onAskNew: (text: string, grams: number | null, target: { date: string; slot: Slot }) => Promise<AskResult>
  onRetry: (id: string) => Promise<AskResult>
  onDiscard: (id: string) => void
  onSave: (requestId: string, editedFood: CustomFood, target: { date: string; slot: Slot }, fraction: number) => void
  onRemoveCustomFood: (foodId: string) => void
  onAddFromBook: (food: CustomFood, slot: Slot, fraction: number) => void
  onOpenSettings: () => void
  onClose: () => void
}

/** Доля добавления: то же самое, что «Съел часть» (FRACTIONS/fractionLabel из
    MealScreen.tsx), плюс «целиком» — как в AddFromMenuSheet.tsx. ADD_FRACTIONS
    там не экспортирован, поэтому список повторён здесь тем же способом, а не
    завозится импортом одного файла шторки в другую. */
const ADD_FRACTIONS: number[] = [1, ...FRACTIONS.map(f => f.value)]

const MAX_GRAMS = 5000

function round(n: number): number {
  return Math.round(n)
}

/** Русское склонение по числу — та же форма, что entryWord в App.tsx и
    daysWord в SettingsSheet.tsx, своя копия по той же причине (разные файлы,
    разные задачи одновременно). */
function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  switch (n % 10) {
    case 1: return one
    case 2:
    case 3:
    case 4: return few
    default: return many
  }
}

/** «45 минут» / «3 часа» / «2 дня» — грубая (округлённая до одной единицы)
    длительность простоя компьютера для текста pending при pcAgo > 120 с. */
function formatOfflineDuration(pcAgoSeconds: number): string {
  if (pcAgoSeconds < 3600) {
    const n = Math.max(1, Math.round(pcAgoSeconds / 60))
    return `${n} ${pluralRu(n, 'минута', 'минуты', 'минут')}`
  }
  if (pcAgoSeconds < 86_400) {
    const n = Math.max(1, Math.round(pcAgoSeconds / 3600))
    return `${n} ${pluralRu(n, 'час', 'часа', 'часов')}`
  }
  const n = Math.max(1, Math.round(pcAgoSeconds / 86_400))
  return `${n} ${pluralRu(n, 'день', 'дня', 'дней')}`
}

/** Полнота нутриентов своей еды: сколько ключей NUTRIENT_KEYS набрали полный
    known === total по компонентам блюда (total === 0 — ключа нет ни у одного
    компонента, известным он не считается). Та же честность, что и у
    покрытия норм на главном экране, но без норм — здесь их не с чем сравнивать. */
function nutrientCompletenessLabel(nutrients: NutrientTotals): string {
  const known = NUTRIENT_KEYS.filter(key => {
    const n = nutrients[key]
    return n.total > 0 && n.known === n.total
  }).length
  return `известно ${known} из ${NUTRIENT_KEYS.length} нутриентов`
}

/* ---- книга своей еды ---- */

function BookRow({
  food, onAdd, onRemove
}: {
  food: CustomFood
  onAdd: (food: CustomFood, slot: Slot, fraction: number) => void
  onRemove: (foodId: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [slot, setSlot] = useState<Slot>('breakfast')
  const [fraction, setFraction] = useState(1)

  return (
    <li className="custom-food-book-row">
      <div className="custom-food-book-row__head">
        <span className="custom-food-book-row__title">{food.title}</span>
        <div className="custom-food-book-row__actions">
          <button
            type="button"
            className="btn btn--secondary"
            aria-expanded={adding}
            onClick={() => setAdding(v => !v)}
          >
            Добавить в день
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => onRemove(food.id)}>
            Удалить из книги
          </button>
        </div>
      </div>
      {adding && (
        <div className="custom-food-book-row__add">
          <div className="custom-food-book-row__group" role="group" aria-label="Приём">
            {SLOTS.map(s => (
              <button
                key={s}
                type="button"
                className={s === slot ? 'chip chip--tap chip--selected' : 'chip chip--tap'}
                aria-pressed={s === slot}
                onClick={() => setSlot(s)}
              >
                {SLOT_TITLE[s]}
              </button>
            ))}
          </div>
          <div className="custom-food-book-row__group" role="group" aria-label="Доля">
            {ADD_FRACTIONS.map(value => (
              <button
                key={value}
                type="button"
                className={value === fraction ? 'chip chip--tap chip--selected nums' : 'chip chip--tap nums'}
                aria-pressed={value === fraction}
                onClick={() => setFraction(value)}
              >
                {fractionLabel(value)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn--primary custom-food-book-row__confirm"
            onClick={() => { onAdd(food, slot, fraction); setAdding(false) }}
          >
            Добавить
          </button>
        </div>
      )}
    </li>
  )
}

/* ---- форма нового заказа ---- */

function NewFoodForm({
  defaultTarget, onAskNew
}: {
  defaultTarget: { date: string; slot: Slot }
  onAskNew: CustomFoodSheetProps['onAskNew']
}) {
  const [text, setText] = useState('')
  const [gramsStr, setGramsStr] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const trimmedText = text.trim()
  const trimmedGrams = gramsStr.trim()

  let gramsValue: number | null = null
  let gramsError: string | null = null
  if (trimmedGrams !== '') {
    const parsed = Number(trimmedGrams)
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_GRAMS) {
      gramsError = `Граммы — число больше 0 и не больше ${MAX_GRAMS}.`
    } else {
      gramsValue = parsed
    }
  }

  const canSubmit = trimmedText !== '' && gramsError === null && !submitting

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError(null)
    const result = await onAskNew(trimmedText, gramsValue, defaultTarget)
    setSubmitting(false)
    if (result.ok) {
      setText('')
      setGramsStr('')
    } else {
      setSubmitError(result.error)
    }
  }

  return (
    <section className="custom-food-form" aria-label="Новая своя еда">
      <h2 className="custom-food__section-title">Новая своя еда</h2>
      <label className="field">
        <span className="field__label">Что съел</span>
        <input
          type="text"
          className="field__input"
          value={text}
          placeholder="например, тирамису"
          onChange={e => setText(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Граммы (необязательно)</span>
        <input
          type="number"
          className="field__input"
          value={gramsStr}
          min={0}
          max={MAX_GRAMS}
          placeholder="120"
          onChange={e => setGramsStr(e.target.value)}
        />
        {gramsError && <span className="field__hint custom-food__error">{gramsError}</span>}
      </label>
      <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={handleSubmit}>
        Отправить на разбор
      </button>
      {submitError && <p className="custom-food__error" role="alert">{submitError}</p>}
    </section>
  )
}

/* ---- очередь заказов ---- */

function PendingRequestRow({ request }: { request: FoodRequest }) {
  const statusText = request.pcAgo === null
    ? 'Запрос в очереди, компьютер ещё ни разу не выходил на связь.'
    : request.pcAgo <= 120
      ? `Запрос в очереди, компьютер на связи (${request.pcAgo} с назад). Обычно разбор занимает около минуты.`
      : `Запрос в очереди, компьютер не в сети уже ${formatOfflineDuration(request.pcAgo)} — разбор придёт, когда он включится; запрос живёт сутки.`

  return (
    <li className="custom-food-request">
      <span className="custom-food-request__text">
        {request.text}{request.grams !== null ? ` · ${request.grams} г` : ''}
      </span>
      <p className="custom-food-request__status">{statusText}</p>
    </li>
  )
}

function FailedOrExpiredRequestRow({
  request, onRetry, onDiscard
}: {
  request: FoodRequest
  onRetry: (id: string) => Promise<AskResult>
  onDiscard: (id: string) => void
}) {
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)

  const statusText = request.status === 'failed'
    ? (request.error ?? 'Разбор не удался')
    : 'Компьютер не взял запрос за сутки.'

  async function handleRetry(): Promise<void> {
    setRetrying(true)
    setRetryError(null)
    const result = await onRetry(request.id)
    setRetrying(false)
    if (!result.ok) setRetryError(result.error)
  }

  return (
    <li className="custom-food-request custom-food-request--failed">
      <span className="custom-food-request__text">
        {request.text}{request.grams !== null ? ` · ${request.grams} г` : ''}
      </span>
      <p className="custom-food-request__status">{statusText}</p>
      <div className="custom-food-request__actions">
        <button type="button" className="btn btn--secondary" disabled={retrying} onClick={handleRetry}>
          Повторить
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => onDiscard(request.id)}>
          Убрать
        </button>
      </div>
      {retryError && <p className="custom-food__error" role="alert">{retryError}</p>}
    </li>
  )
}

function DoneRequestRow({
  request, result, onSave, onDiscard
}: {
  request: FoodRequest
  result: FoodResultOk
  onSave: (requestId: string, editedFood: CustomFood, target: { date: string; slot: Slot }, fraction: number) => void
  onDiscard: (id: string) => void
}) {
  /* customFoodFromResult даёт CustomFood, готовую лечь в книгу; id/createdAt
     заведены здесь один раз при появлении строки (эффект стороны, не ядро —
     ровно как handleAddFromMenu в App.tsx заводит id для extra). jobId — тот
     же «наряд воркера», под которым заказ опрашивался (см. wireId в
     useFoodPolling.ts): food:<request.id>. */
  const [draftFood, setDraftFood] = useState<CustomFood>(() =>
    customFoodFromResult(result, `food:${request.id}`, crypto.randomUUID(), new Date().toISOString())
  )
  const [target, setTarget] = useState(request.target)
  const [fraction, setFraction] = useState(1)

  const totals = customFoodTotals(draftFood)

  function handleGramsChange(index: number, grams: number): void {
    setDraftFood(prev => withComponentGrams(prev, index, grams))
  }

  return (
    <li className="custom-food-request custom-food-request--done">
      <h3 className="custom-food-request__title">{draftFood.title}</h3>

      <ul className="custom-food-components">
        {draftFood.components.map((component, index) => (
          <li key={index} className="custom-food-component">
            <div className="custom-food-component__meta">
              <span className="custom-food-component__desc">{component.description}</span>
              <span className="custom-food-component__category">{component.category}</span>
              {component.note && <span className="custom-food-component__note">{component.note}</span>}
            </div>
            <label className="field custom-food-component__grams">
              <span className="field__label">Граммы</span>
              <input
                type="number"
                className="field__input"
                value={component.grams}
                min={0.1}
                step={1}
                onChange={e => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v) && v > 0) handleGramsChange(index, v)
                }}
              />
            </label>
          </li>
        ))}
      </ul>

      <p className="custom-food-request__totals">
        {round(totals.kbju.kcal)} ккал · Б {round(totals.kbju.p)} · Ж {round(totals.kbju.f)} · У {round(totals.kbju.c)}
      </p>
      <p className="custom-food-request__completeness">{nutrientCompletenessLabel(totals.nutrients)}</p>

      <label className="field">
        <span className="field__label">Дата записи</span>
        <input
          type="date"
          className="field__input"
          value={target.date}
          onChange={e => setTarget(t => ({ ...t, date: e.target.value }))}
        />
      </label>

      <div className="field">
        <span className="field__label">Приём</span>
        <div className="custom-food-request__group" role="group" aria-label="Приём">
          {SLOTS.map(s => (
            <button
              key={s}
              type="button"
              className={s === target.slot ? 'chip chip--tap chip--selected' : 'chip chip--tap'}
              aria-pressed={s === target.slot}
              onClick={() => setTarget(t => ({ ...t, slot: s }))}
            >
              {SLOT_TITLE[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">Доля</span>
        <div className="custom-food-request__group" role="group" aria-label="Доля">
          {ADD_FRACTIONS.map(value => (
            <button
              key={value}
              type="button"
              className={value === fraction ? 'chip chip--tap chip--selected nums' : 'chip chip--tap nums'}
              aria-pressed={value === fraction}
              onClick={() => setFraction(value)}
            >
              {fractionLabel(value)}
            </button>
          ))}
        </div>
      </div>

      <div className="custom-food-request__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => onSave(request.id, draftFood, target, fraction)}
        >
          Сохранить и записать
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => onDiscard(request.id)}>
          Убрать
        </button>
      </div>
    </li>
  )
}

function RequestRow({
  request, onRetry, onDiscard, onSave
}: {
  request: FoodRequest
  onRetry: (id: string) => Promise<AskResult>
  onDiscard: (id: string) => void
  onSave: (requestId: string, editedFood: CustomFood, target: { date: string; slot: Slot }, fraction: number) => void
}) {
  if (request.status === 'pending') return <PendingRequestRow request={request} />
  if (request.status === 'done') {
    // status === 'done' у applyFoodPoll всегда идёт вместе с result — если
    // однажды разойдётся, честнее промолчать здесь, чем нарисовать пустую
    // карточку «готово» без единого числа в ней.
    if (!request.result) return null
    return <DoneRequestRow request={request} result={request.result} onSave={onSave} onDiscard={onDiscard} />
  }
  return <FailedOrExpiredRequestRow request={request} onRetry={onRetry} onDiscard={onDiscard} />
}

/* ---- шторка целиком ---- */

export default function CustomFoodSheet({
  token, customFoods, foodRequests, defaultTarget, pollError,
  onAskNew, onRetry, onDiscard, onSave, onRemoveCustomFood, onAddFromBook,
  onOpenSettings, onClose
}: CustomFoodSheetProps) {
  const books = Object.values(customFoods)

  return (
    <Sheet title="Своя еда" onClose={onClose}>
      <div className="custom-food">
        {books.length > 0 && (
          <section className="custom-food-book" aria-label="Книга своей еды">
            <h2 className="custom-food__section-title">Книга своей еды</h2>
            <ul className="custom-food-book__list">
              {books.map(food => (
                <BookRow key={food.id} food={food} onAdd={onAddFromBook} onRemove={onRemoveCustomFood} />
              ))}
            </ul>
          </section>
        )}

        {token === ''
          ? (
            <div className="custom-food-no-token">
              <p className="custom-food-no-token__text">
                Своя еда разбирается на домашнем компьютере через Штурмана. Чтобы заказать разбор,
                впиши токен приложения в Настройках.
              </p>
              <button type="button" className="btn btn--secondary" onClick={onOpenSettings}>
                Открыть настройки
              </button>
            </div>
          )
          : <NewFoodForm defaultTarget={defaultTarget} onAskNew={onAskNew} />}

        {foodRequests.length > 0 && (
          <section className="custom-food-requests" aria-label="Запросы на разбор">
            <h2 className="custom-food__section-title">Запросы на разбор</h2>
            <ul className="custom-food-requests__list">
              {foodRequests.map(request => (
                <RequestRow key={request.id} request={request} onRetry={onRetry} onDiscard={onDiscard} onSave={onSave} />
              ))}
            </ul>
          </section>
        )}

        {pollError && <p className="custom-food__poll-error" role="status">{pollError}</p>}
      </div>
    </Sheet>
  )
}
