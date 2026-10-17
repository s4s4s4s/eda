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
import type { ReactNode } from 'react'
import type { OffProductResult, OffSearchResult } from '../core/foodClient.ts'
import type { OffProduct } from '../core/types.ts'
import {
  createOffSearch, formatPer100, OFF_EMPTY_TEXT, OFF_IDLE_STATE, OFF_INVALID_TEXT, OFF_LOADING_TEXT, offInvalidText, offSkippedText
} from './foodLogic.ts'
import type { OffSearchController, OffSearchDeps } from './foodLogic.ts'

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
  /** Раздел «Из книги»: стоит между полем и разделом Open Food Facts (порядок плана). */
  children?: ReactNode
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

export function FoodSearch({ query, onQueryChange, onSearchOff, onFetchOffProduct, onOpenProduct, children }: FoodSearchProps) {
  const [{ view, card }, setState] = useState(OFF_IDLE_STATE)
  const depsRef = useRef<OffSearchDeps>({ searchOff: onSearchOff, fetchProduct: onFetchOffProduct, openProduct: onOpenProduct })
  depsRef.current = { searchOff: onSearchOff, fetchProduct: onFetchOffProduct, openProduct: onOpenProduct }
  const controllerRef = useRef<OffSearchController | null>(null)
  controllerRef.current ??= createOffSearch(() => depsRef.current, setState)
  const controller = controllerRef.current

  const trimmed = query.trim()
  const busy = view.phase === 'loading' || card.phase === 'loading'

  return (
    <div className="custom-food-search">
      <form
        className="custom-food-search__form"
        role="search"
        onSubmit={e => {
          e.preventDefault()
          void controller.search(query)
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

      {children}

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
                  <OffResultRow key={item.code} product={item} onPick={code => void controller.fetchCard(code)} />
                ))}
              </ul>
              {offSkippedText(view.skipped) !== null && <p className="custom-food-off__skipped">{offSkippedText(view.skipped)}</p>}
              {offInvalidText(view.invalid) !== null && <p className="custom-food-off__skipped" role="status">{offInvalidText(view.invalid)}</p>}
            </>
          )}
        </section>
      )}
    </div>
  )
}

export default FoodSearch
