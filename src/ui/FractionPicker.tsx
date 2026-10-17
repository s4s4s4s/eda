/* Выбор доли в процентах: четыре быстрых значения и поле для целого процента.
   Общий для шторки «Сфоткать наклейку» и правки доли в журнале. Недопустимый
   ввод не доходит до родителя: поле помечается aria-invalid, а значение
   выше по дереву остаётся прежним. */

import React, { useEffect, useState } from 'react'
import { fractionFromPercent, fractionLabel, PERCENT_PRESETS, percentFromFraction } from './fractions.ts'

export interface FractionPickerProps {
  /** Доля 0..1, как в ExtraLogEntry.fraction. */
  value: number
  onChange: (fraction: number) => void
  /** Префикс id поля ввода: на экране может быть несколько выборов долей. */
  idPrefix: string
}

/** Текст поля -> доля или null. Пустая строка и нецелое: недопустимый ввод. */
function parseDraft(draft: string): number | null {
  if (draft.trim() === '') return null
  return fractionFromPercent(Number(draft))
}

export function FractionPicker({ value, onChange, idPrefix }: FractionPickerProps): React.ReactElement {
  const percent = percentFromFraction(value)
  const [draft, setDraft] = useState(String(percent))

  /* Значение сменили снаружи (чип, правка в журнале): поле показывает его.
     Пока в поле недопустимый черновик, а value не менялось, эффект не
     срабатывает и черновик не затирается. */
  useEffect(() => {
    setDraft(String(percent))
  }, [percent])

  const invalid = parseDraft(draft) === null
  const inputId = `${idPrefix}-percent`

  const onInput = (text: string): void => {
    setDraft(text)
    const next = parseDraft(text)
    if (next !== null) onChange(next)
  }

  return (
    <div className="fraction-picker">
      <div className="fraction-picker__presets" role="group" aria-label="Быстрый выбор доли">
        {PERCENT_PRESETS.map(pct => (
          <button
            key={pct}
            type="button"
            className={'chip chip--tap fraction-picker__preset' + (!invalid && pct === percent ? ' chip--selected' : '')}
            aria-pressed={!invalid && pct === percent}
            onClick={() => onChange(pct / 100)}
          >
            {pct}%
          </button>
        ))}
      </div>
      <div className="fraction-picker__custom">
        <input
          id={inputId}
          className="fraction-picker__input"
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          step={1}
          aria-label="Процент съеденного"
          aria-invalid={invalid}
          value={draft}
          onChange={e => onInput(e.target.value)}
        />
        <span className="fraction-picker__unit" aria-hidden="true">%</span>
        <span className="fraction-picker__label" aria-live="polite">
          {invalid ? 'от 1 до 100' : fractionLabel(value)}
        </span>
      </div>
    </div>
  )
}
