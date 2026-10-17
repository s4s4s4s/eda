/* Поиск в шторке «Своя еда»: одно поле на книгу и на Open Food Facts.
   Книгу фильтрует родитель на каждую букву (поэтому запрос управляется
   снаружи, query/onQueryChange), а Open Food Facts зовётся только по кнопке
   «Найти» или Enter: у открытого поиска лимит на IP, автозапрос при вводе
   его бы выбрал. Ввод, похожий на штрихкод (isBarcode), сразу просит
   карточку товара, минуя список.

   Состояние раздела «Open Food Facts» живёт здесь. Чтобы «Назад к поиску»
   возвращал тот же список, родитель не размонтирует FoodSearch на время
   карточки, а прячет его (hidden). Ответ, пришедший после нового запроса,
   отбрасывается: показывается всегда последний. */

import { useRef, useState } from 'react'
import { isBarcode, normalizeBarcode } from '../core/food.ts'
import type { FoodClientFailureReason, OffClientFailureReason, OffProductResult, OffSearchResult } from '../core/foodClient.ts'
import type { OffProduct } from '../core/types.ts'

/** Сколько товаров просит поиск у воркера. */
export const OFF_SEARCH_LIMIT = 10

export const OFF_EMPTY_TEXT = 'В Open Food Facts ничего не нашлось. Попробуй по-английски или по штрихкоду.'
export const OFF_LOADING_TEXT = 'Ищу в Open Food Facts…'
export const OFF_INVALID_TEXT = 'Ответ воркера не разобран: обнови приложение.'
const OFF_NOT_FOUND_TEXT = 'Товар с таким штрихкодом в Open Food Facts не найден'
const OFF_NO_NUTRITION_TEXT = 'У товара в Open Food Facts нет полного КБЖУ на 100 г'

/** Текст отказа по причине. Для остальных причин текст уже русский: его дал клиент
    или воркер (reason 'off' у заказа приходит с текстом воркера). */
export function offFailureText(reason: OffClientFailureReason | FoodClientFailureReason, error: string): string {
  if (reason === 'not-found') return OFF_NOT_FOUND_TEXT
  if (reason === 'no-nutrition') return OFF_NO_NUTRITION_TEXT
  return error
}

/** Число на экран: до десятых, без хвоста нулей. */
export function formatPer100(value: number): string {
  return String(Number(value.toFixed(1)))
}

type CardView = { phase: 'idle' } | { phase: 'loading' } | { phase: 'error'; text: string }

type OffView =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'empty'; invalid: number }
  | { phase: 'error'; text: string }
  | { phase: 'list'; items: OffProduct[]; skipped: number }

export interface FoodSearchProps {
  /** Текст поля. Управляется родителем: книга фильтруется на каждую букву. */
  query: string
  onQueryChange: (query: string) => void
  /** Поиск по Open Food Facts: зовётся только по «Найти» или Enter. */
  onSearchOff: (q: string, n: number) => Promise<OffSearchResult>
  /** Карточка товара по штрихкоду (нажатие строки или штрихкод в поле). */
  onFetchOffProduct: (code: string) => Promise<OffProductResult>
  /** Карточка получена: родитель показывает ProductCard. */
  onOpenProduct: (product: OffProduct) => void
}

function OffResultRow({ product, onPick }: { product: OffProduct; onPick: (code: string) => void }) {
  const { per100 } = product
  return (
    <li>
      <button type="button" className="card off-result" onClick={() => onPick(product.code)}>
        <span className="off-result__name">{product.name}</span>
        {(product.brand !== '' || product.quantityText !== '') && (
          <span className="off-result__meta">
            {[product.brand, product.quantityText].filter(s => s !== '').join(' · ')}
          </span>
        )}
        <span className="off-result__nums">
          {formatPer100(per100.kcal)} ккал · Б {formatPer100(per100.p)} · Ж {formatPer100(per100.f)} · У {formatPer100(per100.c)} на 100 г
        </span>
        {!product.plausible && <span className="chip off-result__badge">числа сомнительные</span>}
      </button>
    </li>
  )
}

export function FoodSearch({ query, onQueryChange, onSearchOff, onFetchOffProduct, onOpenProduct }: FoodSearchProps) {
  const [view, setView] = useState<OffView>({ phase: 'idle' })
  /* Загрузка карточки по строке списка или штрихкоду. Отдельно от списка: отказ
     карточки не стирает найденное. */
  const [card, setCard] = useState<CardView>({ phase: 'idle' })
  const seqRef = useRef(0)

  const trimmed = query.trim()
  const busy = view.phase === 'loading' || card.phase === 'loading'

  async function fetchCard(code: string): Promise<void> {
    const seq = ++seqRef.current
    setCard({ phase: 'loading' })
    const result = await onFetchOffProduct(code)
    if (seq !== seqRef.current) return
    if (result.ok) {
      setCard({ phase: 'idle' })
      onOpenProduct(result.product)
    } else {
      setCard({ phase: 'error', text: offFailureText(result.reason, result.error) })
    }
  }

  async function search(): Promise<void> {
    if (trimmed === '' || busy) return
    if (isBarcode(trimmed)) {
      await fetchCard(normalizeBarcode(trimmed))
      return
    }
    const seq = ++seqRef.current
    setCard({ phase: 'idle' })
    setView({ phase: 'loading' })
    const result = await onSearchOff(trimmed, OFF_SEARCH_LIMIT)
    if (seq !== seqRef.current) return
    if (!result.ok) {
      setView({ phase: 'error', text: offFailureText(result.reason, result.error) })
    } else if (result.items.length === 0) {
      setView({ phase: 'empty', invalid: result.invalid })
    } else {
      setView({ phase: 'list', items: result.items, skipped: result.skipped })
    }
  }

  return (
    <div className="custom-food-search">
      <form
        className="custom-food-search__form"
        role="search"
        onSubmit={e => {
          e.preventDefault()
          void search()
        }}
      >
        <input
          type="search"
          className="field__input custom-food-search__input"
          aria-label="Название или штрихкод"
          placeholder="Название или штрихкод"
          value={query}
          enterKeyHint="search"
          onChange={e => onQueryChange(e.target.value)}
        />
        <button type="submit" className="btn btn--secondary custom-food-search__submit" disabled={trimmed === '' || busy}>
          Найти
        </button>
      </form>

      {(view.phase !== 'idle' || card.phase !== 'idle') && (
        <section className="custom-food-off" aria-label="Open Food Facts">
          <h3 className="custom-food__section-title">Open Food Facts</h3>
          {card.phase === 'loading' && <p className="custom-food-off__status" role="status">{OFF_LOADING_TEXT}</p>}
          {card.phase === 'error' && <p className="custom-food__error" role="alert">{card.text}</p>}
          {view.phase === 'loading' && <p className="custom-food-off__status" role="status">{OFF_LOADING_TEXT}</p>}
          {view.phase === 'empty' && (
            <p className="custom-food-off__status" role="status">
              {view.invalid > 0 ? OFF_INVALID_TEXT : OFF_EMPTY_TEXT}
            </p>
          )}
          {view.phase === 'error' && <p className="custom-food__error" role="alert">{view.text}</p>}
          {view.phase === 'list' && (
            <>
              <ul className="custom-food-off__list">
                {view.items.map(item => (
                  <OffResultRow key={item.code} product={item} onPick={code => void fetchCard(code)} />
                ))}
              </ul>
              {view.skipped > 0 && <p className="custom-food-off__skipped">Ещё {view.skipped} без КБЖУ не показаны.</p>}
            </>
          )}
        </section>
      )}
    </div>
  )
}

export default FoodSearch
