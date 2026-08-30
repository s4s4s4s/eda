/* Оценка блюда: балл 1–10 сеткой 5×2 и комментарий. Общий примитив — стоит и
   на главном экране сразу после записи приёма, и в книге предпочтений.
   Стили живут в theme.css рядом с остальными примитивами. */

import { useId } from 'react'
import type { DishRating } from '../core/types.ts'

interface RatingEditorProps {
  /** Текущая оценка блюда; undefined — «не оценено», это отдельное состояние. */
  rating: DishRating | undefined
  /** Балл обязателен, комментарий может быть пустым. */
  onChange: (score: number, comment: string) => void
  /** Снять оценку. Не показывается, пока оценки нет. */
  onClear: () => void
}

const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

export default function RatingEditor({ rating, onChange, onClear }: RatingEditorProps) {
  const commentId = useId()
  const scored = rating !== undefined

  return (
    <div className="rating">
      <div className="rating__scale" role="group" aria-label="Оценка блюда от 1 до 10">
        {SCORES.map(score => (
          <button
            key={score}
            type="button"
            className={score === rating?.score ? 'rating__btn rating__btn--selected' : 'rating__btn'}
            aria-pressed={score === rating?.score}
            onClick={() => onChange(score, rating?.comment ?? '')}
          >
            {score}
          </button>
        ))}
      </div>

      {/* Поле видно всегда, но пишется только после балла: комментарий без
          балла некуда положить — оценка без числа не оценка. */}
      <label className="rating__comment" htmlFor={commentId}>
        <span className="field__label">Что понравилось или нет</span>
        <textarea
          id={commentId}
          className="rating__comment-input"
          rows={2}
          value={rating?.comment ?? ''}
          disabled={!scored}
          placeholder={scored ? 'солёное, сухая индейка, мало соуса…' : 'сначала балл'}
          onChange={e => {
            if (rating) onChange(rating.score, e.target.value)
          }}
        />
      </label>

      {scored && (
        <button type="button" className="rating__clear" onClick={onClear}>
          Снять оценку
        </button>
      )}
    </div>
  )
}
