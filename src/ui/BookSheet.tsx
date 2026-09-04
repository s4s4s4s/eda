/* Шторка «Книга»: где Александр говорит, что любит, чего не ест, и как ему
   было каждое блюдо (DESIGN.md, раздел «Книга предпочтений»). Каркас — общий
   Sheet.tsx. Шкала и поле комментария у оценки — готовый RatingEditor, свою
   не пишем. Все примитивы (.chip, .field, .stance-dot, .name--avoided,
   .rating) — из theme.css, свои аналоги не заводятся.

   Книга ничего не запрещает и не прячет: список блюд и список продуктов не
   сокращаются от того, что что-то отмечено «не ем» — это личный вкус, а не
   диагноз (DESIGN.md, «Честность — часть дизайна»). */

import { useMemo, useState } from 'react'
import { allMeals } from '../core/menu.ts'
import type { MealEntry, MealPlace } from '../core/menu.ts'
import { ratingOf, stanceOf } from '../core/preferences.ts'
import { SLOT_TITLE } from '../core/types.ts'
import type { IngredientStance, Menu, Preferences, Product, ProductIndex } from '../core/types.ts'
import RatingEditor from './RatingEditor.tsx'
import Sheet from './Sheet.tsx'

interface BookSheetProps {
  menu: Menu
  products: ProductIndex
  preferences: Preferences
  onSetStance: (productId: string, stance: IngredientStance | null) => void
  onRate: (mealId: string, score: number, comment: string) => void
  onClearRating: (mealId: string) => void
  onClose: () => void
}

type Section = 'dishes' | 'ingredients'

/* Список блюд книги собирает core/menu.ts (allMeals): одно блюдо — одна
   строка с одной оценкой, даже если оно стоит в нескольких днях и в
   нескольких присланных редакциях (DESIGN.md, раздел «Книга предпочтений»).
   Правило склейки живёт в ядре, а не здесь: второе его место рано или поздно
   разошлось бы с первым. Порядок строк — порядок первого появления блюда в
   меню: он не зависит от того, что человек уже оценил, и потому не прыгает
   под пальцем. */

/** Продукты справочника по алфавиту имени. Ключ сортировки — имя, не
    отметка: отмеченный продукт не перескакивает по списку. */
function buildIngredientRows(products: ProductIndex): Product[] {
  return [...products.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

function placeLabel(place: MealPlace): string {
  return `день ${place.day}, ${SLOT_TITLE[place.slot].toLowerCase()}`
}

function DishRowView({
  row,
  preferences,
  expanded,
  onToggle,
  onRate,
  onClearRating
}: {
  row: MealEntry
  preferences: Preferences
  expanded: boolean
  onToggle: () => void
  onRate: (mealId: string, score: number, comment: string) => void
  onClearRating: (mealId: string) => void
}) {
  const rating = ratingOf(preferences, row.meal.id)
  const meta = row.places.map(placeLabel).join(' · ')

  return (
    <li className="book-dish">
      <button
        type="button"
        className="book-dish__head"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="book-dish__title">{row.meal.title}</span>
        <span className="book-dish__meta">{meta}</span>
        {rating === undefined ? (
          <span className="book-dish__rating book-dish__rating--empty">не оценено</span>
        ) : (
          <span className="book-dish__rating">
            {rating.score}
            {rating.comment !== '' && <> · {rating.comment}</>}
          </span>
        )}
      </button>
      {expanded && (
        <div className="book-dish__editor">
          <RatingEditor
            rating={rating}
            onChange={(score, comment) => onRate(row.meal.id, score, comment)}
            onClear={() => onClearRating(row.meal.id)}
          />
        </div>
      )}
    </li>
  )
}

const STANCE_OPTIONS: { value: IngredientStance | null; label: string }[] = [
  { value: 'love', label: 'люблю' },
  { value: null, label: 'всё равно' },
  { value: 'avoid', label: 'не ем' }
]

function IngredientRowView({
  product,
  stance,
  onSetStance
}: {
  product: Product
  stance: IngredientStance | undefined
  onSetStance: (productId: string, stance: IngredientStance | null) => void
}) {
  const nameClass = stance === 'avoid' ? 'book-ingredient__name name--avoided' : 'book-ingredient__name'
  const dotClass = stance === 'love' ? 'stance-dot stance-dot--love' : stance === 'avoid' ? 'stance-dot stance-dot--avoid' : null

  return (
    <li className="list__row book-ingredient">
      <span className={nameClass}>
        {dotClass && <span className={dotClass} aria-hidden="true" />}
        {product.name}
      </span>
      <span className="book-ingredient__controls" role="group" aria-label={`Отношение к продукту «${product.name}»`}>
        {STANCE_OPTIONS.map(opt => {
          const selected = opt.value === (stance ?? null)
          return (
            <button
              key={opt.label}
              type="button"
              className={selected ? 'chip chip--tap chip--selected' : 'chip chip--tap'}
              aria-pressed={selected}
              onClick={() => onSetStance(product.id, opt.value)}
            >
              {opt.label}
            </button>
          )
        })}
      </span>
    </li>
  )
}

export default function BookSheet({ menu, products, preferences, onSetStance, onRate, onClearRating, onClose }: BookSheetProps) {
  const [section, setSection] = useState<Section>('dishes')
  const [expandedMealId, setExpandedMealId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const dishRows = useMemo(() => allMeals(menu), [menu])
  const ingredientRows = useMemo(() => buildIngredientRows(products), [products])

  const filterNeedle = filter.trim().toLowerCase()
  const filteredIngredients = filterNeedle === ''
    ? ingredientRows
    : ingredientRows.filter(p => p.name.toLowerCase().includes(filterNeedle))

  return (
    <Sheet title="Книга" onClose={onClose}>
      <div className="book-tabs" role="group" aria-label="Раздел книги">
        <button
          type="button"
          className={section === 'dishes' ? 'chip chip--tap chip--selected' : 'chip chip--tap'}
          aria-pressed={section === 'dishes'}
          onClick={() => setSection('dishes')}
        >
          Блюда
        </button>
        <button
          type="button"
          className={section === 'ingredients' ? 'chip chip--tap chip--selected' : 'chip chip--tap'}
          aria-pressed={section === 'ingredients'}
          onClick={() => setSection('ingredients')}
        >
          Ингредиенты
        </button>
      </div>

      {section === 'dishes' && (
        <section className="book-section" aria-label="Блюда">
          <div className="card">
            <ul className="book-list">
              {dishRows.map(row => (
                <DishRowView
                  key={row.meal.id}
                  row={row}
                  preferences={preferences}
                  expanded={expandedMealId === row.meal.id}
                  onToggle={() => setExpandedMealId(prev => (prev === row.meal.id ? null : row.meal.id))}
                  onRate={onRate}
                  onClearRating={onClearRating}
                />
              ))}
            </ul>
          </div>
        </section>
      )}

      {section === 'ingredients' && (
        <section className="book-section" aria-label="Ингредиенты">
          <label className="field book-filter">
            <span className="field__label">Найти продукт</span>
            <input
              type="text"
              className="field__input"
              value={filter}
              placeholder="например, лосось"
              onChange={e => setFilter(e.target.value)}
            />
          </label>

          {filteredIngredients.length === 0 ? (
            <p className="book-empty">Ничего не найдено</p>
          ) : (
            <div className="card">
              <ul className="book-list">
                {filteredIngredients.map(product => (
                  <IngredientRowView
                    key={product.id}
                    product={product}
                    stance={stanceOf(preferences, product.id)}
                    onSetStance={onSetStance}
                  />
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </Sheet>
  )
}
