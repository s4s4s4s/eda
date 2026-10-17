/* Шторка «Своя еда» (задача E4b): книга своей еды сверху, форма нового заказа
   на разбор, очередь заказов с честными состояниями опроса. Каркас - общий
   Sheet.tsx. Сетевые вызовы (askFood) делает App.tsx через onAskNew/onRetry -
   здесь только форма и отображение результата; опрос (pollFood) целиком живёт
   в useFoodPolling.ts и работает независимо от того, открыта ли эта шторка.

   Тексты состояний очереди (pending, failed, expired) живут в RequestStatus.tsx
   и взяты дословно из DESIGN.md: отступать от них нельзя, это единственное
   место, где человек узнаёт, что вообще происходит с его запросом на дальнем
   компьютере.

   Сверху поле поиска (FoodSearch): книга фильтруется на каждую букву, Open
   Food Facts спрашивается только по «Найти». Карточка товара (ProductCard)
   пока открыта заменяет списки; FoodSearch при этом не размонтируется, а
   прячется, чтобы «Назад к поиску» вернул тот же список.

   Заказы по наклейке (kind === 'label') обычно до этой шторки в состоянии done
   не доживают: опрос сразу превращает их в запись журнала (afterPoll в
   useFoodPolling.ts). Готовая строка для них здесь остаётся на случай, когда
   автозапись выключена. */

import { useEffect, useRef, useState } from 'react'
import {
  customFoodFromResult, customFoodTotals, labelEnergyWarning, searchCustomFoods, withComponentGrams
} from '../core/food.ts'
import type { OffProductResult, OffSearchResult } from '../core/foodClient.ts'
import type {
  CustomFood, FoodRequest, FoodResultOk, LabelFacts, LabelFit, NutrientTotals, OffProduct
} from '../core/types.ts'
import { NUTRIENT_KEYS, SLOT_TITLE, SLOTS } from '../core/types.ts'
import type { Slot } from '../core/types.ts'
import { FoodSearch } from './FoodSearch.tsx'
import { FractionPicker } from './FractionPicker.tsx'
import ProductCard from './ProductCard.tsx'
import type { ProductAskResult } from './ProductCard.tsx'
import RequestStatus from './RequestStatus.tsx'
import type { RequestActionResult } from './RequestStatus.tsx'
import Sheet from './Sheet.tsx'

type AskResult = RequestActionResult

interface CustomFoodSheetProps {
  /** Пустая строка - разбор своей еды не настроен (см. Settings.shturmanToken). */
  token: string
  customFoods: Record<string, CustomFood>
  foodRequests: FoodRequest[]
  /** Куда по умолчанию попадёт новый заказ и куда - уже готовая еда, пока
      человек не поправил дату/приём в самой строке. */
  defaultTarget: { date: string; slot: Slot }
  /** Последняя временная ошибка опроса (сеть, токен) - из useFoodPolling.
      Статус заказов ею не меняется, это отдельная, не привязанная к
      конкретному заказу строка. */
  pollError: string | null
  onAskNew: (text: string, grams: number | null, target: { date: string; slot: Slot }) => Promise<AskResult>
  /** «Повторить» у текстового заказа в failed/expired. */
  onRetry: (id: string) => Promise<AskResult>
  /** «Переснять» у заказа по наклейке в failed/expired: App открывает съёмку. */
  onRetake: (id: string) => void
  onDiscard: (id: string) => void
  onSave: (requestId: string, editedFood: CustomFood, target: { date: string; slot: Slot }, fraction: number) => void
  onRemoveCustomFood: (foodId: string) => void
  onAddFromBook: (food: CustomFood, slot: Slot, fraction: number) => void
  /** «Записать ещё»: одно нажатие, на сегодня и в текущий приём. */
  onRelog: (food: CustomFood) => void
  onSearchOff: (q: string, n: number) => Promise<OffSearchResult>
  onFetchOffProduct: (code: string) => Promise<OffProductResult>
  onAskProduct: (product: OffProduct, grams: number, slot: Slot, fraction: number) => Promise<ProductAskResult>
  /** «Записать без витаминов»: из карточки (заказ собран локально) и из очереди. */
  onLogProductNow: (request: FoodRequest) => void
  onOpenSettings: () => void
  onClose: () => void
}

const MAX_GRAMS = 5000

/** Сколько подпись «Записано» держится на кнопке «Записать ещё». */
const RELOGGED_MS = 2000

function round(n: number): number {
  return Math.round(n)
}

/** Одна цифра после запятой: на наклейке числа напечатаны так («442.1»), и
    округление до целых в блоке «С наклейки» спрятало бы сверку 4/9/4. */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Полнота нутриентов своей еды: сколько ключей NUTRIENT_KEYS набрали полный
    known === total по компонентам блюда (total === 0 - ключа нет ни у одного
    компонента, известным он не считается). Та же честность, что и у
    покрытия норм на главном экране, но без норм - здесь их не с чем сравнивать. */
function nutrientCompletenessLabel(nutrients: NutrientTotals): string {
  const known = NUTRIENT_KEYS.filter(key => {
    const n = nutrients[key]
    return n.total > 0 && n.known === n.total
  }).length
  return `известно ${known} из ${NUTRIENT_KEYS.length} нутриентов`
}

/** Строка про плохую подгонку состава; null, если подгонка в норме. */
function poorFitText(fit: LabelFit | undefined): string | null {
  if (!fit?.poor) return null
  const kcal = fit.deviationPct.kcal
  const kcalPart = kcal === null ? '' : `: ккал ${kcal > 0 ? '+' : ''}${round(kcal)} %`
  return `Состав по USDA расходится с наклейкой${kcalPart}, в журнал идут числа с наклейки`
}

/* ---- книга своей еды ---- */

function BookRow({
  food, onAdd, onRelog, onRemove
}: {
  food: CustomFood
  onAdd: (food: CustomFood, slot: Slot, fraction: number) => void
  onRelog: (food: CustomFood) => void
  onRemove: (foodId: string) => void
}) {
  const [relogged, setRelogged] = useState(false)
  const reloggedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [adding, setAdding] = useState(false)
  const [slot, setSlot] = useState<Slot>('breakfast')
  const [fraction, setFraction] = useState(1)
  const [fractionValid, setFractionValid] = useState(true)

  /* Таймер «Записано» не должен пережить строку: книга перефильтровалась или
     шторка закрылась, а setState прилетел бы в размонтированный компонент. */
  useEffect(() => () => {
    if (reloggedTimer.current !== null) clearTimeout(reloggedTimer.current)
  }, [])

  function handleRelog(): void {
    if (relogged) return
    onRelog(food)
    setRelogged(true)
    reloggedTimer.current = setTimeout(() => {
      reloggedTimer.current = null
      setRelogged(false)
    }, RELOGGED_MS)
  }

  return (
    <li className="card custom-food-book-row">
      <div className="custom-food-book-row__head">
        <span className="custom-food-book-row__title">
          {food.title}
          {food.label && <span className="chip custom-food-book-row__badge">наклейка</span>}
          {food.product && <span className="chip custom-food-book-row__badge">упаковка</span>}
          {food.product && food.product.brand !== '' && (
            <span className="custom-food-book-row__brand">{food.product.brand}</span>
          )}
          {food.product && (
            <a
              className="custom-food-book-row__source"
              href={food.product.url}
              target="_blank"
              rel="noopener"
            >
              Open Food Facts
            </a>
          )}
          {food.label && food.label.titleHy !== '' && (
            <span className="custom-food-book-row__hy" lang="hy">{food.label.titleHy}</span>
          )}
        </span>
        <div className="custom-food-book-row__actions">
          <button type="button" className="btn btn--primary" disabled={relogged} onClick={handleRelog}>
            {relogged ? 'Записано' : 'Записать ещё'}
          </button>
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
          <FractionPicker value={fraction} onChange={setFraction} onValidityChange={setFractionValid} idPrefix={`book-${food.id}`} />
          <button
            type="button"
            className="btn btn--primary custom-food-book-row__confirm"
            disabled={!fractionValid}
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
  defaultTarget, initialText, onAskNew
}: {
  defaultTarget: { date: string; slot: Slot }
  /** Текст из поля поиска на момент открытия формы. */
  initialText: string
  onAskNew: CustomFoodSheetProps['onAskNew']
}) {
  const [text, setText] = useState(initialText)
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
      gramsError = `Граммы: число больше 0 и не больше ${MAX_GRAMS}.`
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
    <section className="card custom-food-form" aria-label="Новая своя еда">
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

/** Блок «С наклейки»: что напечатано, а не что насчитала USDA. */
function LabelFactsBlock({ label, fit }: { label: LabelFacts; fit: LabelFit | undefined }) {
  const basisText = label.basis === 'portion' ? 'на порцию' : 'на 100 г'
  const mismatch = labelEnergyWarning(label.printed)
  const poorFit = poorFitText(fit)

  return (
    <section className="custom-food-label" aria-label="С наклейки">
      <h4 className="custom-food-label__title">С наклейки</h4>
      {label.titleHy !== '' && <p className="custom-food-label__hy" lang="hy">{label.titleHy}</p>}
      {label.dishNo != null && <p className="custom-food-label__line">блюдо №{label.dishNo}</p>}
      <p className="custom-food-label__line">
        {label.portionG !== null ? `Вес: ${round1(label.portionG)} г` : 'Вес не напечатан'}
      </p>
      <p className="custom-food-label__line nums">
        {`Напечатано (${basisText}): ${round1(label.printed.kcal)} ккал · Б ${round1(label.printed.p)} · Ж ${round1(label.printed.f)} · У ${round1(label.printed.c)}`}
      </p>
      {mismatch && <p className="custom-food__error" role="alert">{mismatch}</p>}
      {label.ingredients.length > 0 && (
        <p className="custom-food-label__line">{`Состав: ${label.ingredients.join(', ')}`}</p>
      )}
      {label.remark && <p className="custom-food-label__line">{label.remark}</p>}
      <p className="custom-food-label__note">Микронутриенты: оценка по составу (USDA), не измерены</p>
      {poorFit && <p className="custom-food__error" role="status">{poorFit}</p>}
    </section>
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
     заведены здесь один раз при появлении строки (эффект стороны, не ядро -
     ровно как handleAddFromMenu в App.tsx заводит id для extra). jobId - тот
     же «наряд воркера», под которым заказ опрашивался (см. wireId в
     useFoodPolling.ts): food:<request.id>. */
  const [draftFood, setDraftFood] = useState<CustomFood>(() =>
    customFoodFromResult(result, `food:${request.id}`, crypto.randomUUID(), new Date().toISOString())
  )
  const [target, setTarget] = useState(request.target)
  const [fraction, setFraction] = useState(request.fraction)
  const [fractionValid, setFractionValid] = useState(true)

  const totals = customFoodTotals(draftFood)

  function handleGramsChange(index: number, grams: number): void {
    setDraftFood(prev => withComponentGrams(prev, index, grams))
  }

  return (
    <li className="card custom-food-request custom-food-request--done">
      <h3 className="custom-food-request__title">{draftFood.title}</h3>

      {draftFood.label && <LabelFactsBlock label={draftFood.label} fit={draftFood.fit} />}

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
      {!draftFood.label && (
        <p className="custom-food-request__completeness">{nutrientCompletenessLabel(totals.nutrients)}</p>
      )}

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
        <FractionPicker value={fraction} onChange={setFraction} onValidityChange={setFractionValid} idPrefix={`request-${request.id}`} />
      </div>

      <div className="custom-food-request__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!fractionValid}
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
  request, onRetry, onRetake, onDiscard, onSave, onLogNow
}: {
  request: FoodRequest
  onLogNow: CustomFoodSheetProps['onLogProductNow']
  onRetry: CustomFoodSheetProps['onRetry']
  onRetake: CustomFoodSheetProps['onRetake']
  onDiscard: CustomFoodSheetProps['onDiscard']
  onSave: CustomFoodSheetProps['onSave']
}) {
  if (request.status === 'done') {
    // status === 'done' у applyFoodPoll всегда идёт вместе с result - если
    // однажды разойдётся, честнее промолчать здесь, чем нарисовать пустую
    // карточку «готово» без единого числа в ней.
    if (!request.result) return null
    return <DoneRequestRow request={request} result={request.result} onSave={onSave} onDiscard={onDiscard} />
  }
  const stuck = request.status === 'failed' || request.status === 'expired'
  return (
    <li className={stuck ? 'card custom-food-request custom-food-request--failed' : 'card custom-food-request'}>
      <RequestStatus
        request={request}
        onRetry={onRetry}
        onRetake={onRetake}
        onDiscard={onDiscard}
        onLogNow={() => onLogNow(request)}
      />
    </li>
  )
}

/* ---- шторка целиком ---- */

export default function CustomFoodSheet({
  token, customFoods, foodRequests, defaultTarget, pollError,
  onAskNew, onRetry, onRetake, onDiscard, onSave, onRemoveCustomFood, onAddFromBook, onRelog,
  onSearchOff, onFetchOffProduct, onAskProduct, onLogProductNow,
  onOpenSettings, onClose
}: CustomFoodSheetProps) {
  const [query, setQuery] = useState('')
  const [product, setProduct] = useState<OffProduct | null>(null)
  /* null - форма «Разобрать как блюдо» закрыта; строка - текст поиска на момент открытия. */
  const [formSeed, setFormSeed] = useState<string | null>(null)

  const hasToken = token !== ''
  const books = Object.values(customFoods)
  const queried = hasToken && query.trim() !== ''
  const shownBooks = queried ? searchCustomFoods(books, query, books.length) : books

  async function handleAskProduct(p: OffProduct, grams: number, slot: Slot, fraction: number): Promise<ProductAskResult> {
    const result = await onAskProduct(p, grams, slot, fraction)
    if (result.ok) setProduct(null)
    return result
  }

  function handleLogProductNow(request: FoodRequest): void {
    onLogProductNow(request)
    setProduct(null)
  }

  return (
    <Sheet title="Своя еда" onClose={onClose}>
      <div className="custom-food">
        {product !== null && (
          <ProductCard
            key={product.code}
            product={product}
            date={defaultTarget.date}
            defaultSlot={defaultTarget.slot}
            onBack={() => setProduct(null)}
            onAskProduct={handleAskProduct}
            onLogProductNow={handleLogProductNow}
            newRequestId={() => crypto.randomUUID()}
            now={() => new Date().toISOString()}
          />
        )}

        <div className="custom-food__lists" hidden={product !== null}>
          {hasToken && (
            <FoodSearch
              query={query}
              onQueryChange={setQuery}
              onSearchOff={onSearchOff}
              onFetchOffProduct={onFetchOffProduct}
              onOpenProduct={setProduct}
            />
          )}

          {shownBooks.length > 0 && (
            <section className="custom-food-book" aria-label="Из книги">
              <h2 className="custom-food__section-title">Из книги</h2>
              <ul className="custom-food-book__list">
                {shownBooks.map(food => (
                  <BookRow
                    key={food.id}
                    food={food}
                    onAdd={onAddFromBook}
                    onRelog={onRelog}
                    onRemove={onRemoveCustomFood}
                  />
                ))}
              </ul>
            </section>
          )}
          {queried && shownBooks.length === 0 && (
            <p className="custom-food-book__empty" role="status">В книге по этому запросу ничего нет.</p>
          )}

          {hasToken
            ? (
              formSeed === null
                ? (
                  <button type="button" className="btn btn--secondary" onClick={() => setFormSeed(query.trim())}>
                    Разобрать как блюдо на компьютере
                  </button>
                )
                : <NewFoodForm defaultTarget={defaultTarget} initialText={formSeed} onAskNew={onAskNew} />
            )
            : (
              <div className="card custom-food-no-token">
                <p className="custom-food-no-token__text">
                  Своя еда разбирается на домашнем компьютере через Штурмана. Чтобы заказать разбор,
                  впиши токен приложения в Настройках.
                </p>
                <button type="button" className="btn btn--secondary" onClick={onOpenSettings}>
                  Открыть настройки
                </button>
              </div>
            )}

          {foodRequests.length > 0 && (
            <section className="custom-food-requests" aria-label="Запросы на разбор">
              <h2 className="custom-food__section-title">Запросы на разбор</h2>
              <ul className="custom-food-requests__list">
                {foodRequests.map(request => (
                  <RequestRow
                    key={request.id}
                    request={request}
                    onRetry={onRetry}
                    onRetake={onRetake}
                    onDiscard={onDiscard}
                    onSave={onSave}
                    onLogNow={onLogProductNow}
                  />
                ))}
              </ul>
            </section>
          )}

          {pollError && <p className="custom-food__poll-error" role="status">{pollError}</p>}
        </div>
      </div>
    </Sheet>
  )
}
