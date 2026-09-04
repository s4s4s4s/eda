/* Навигация экрана: пять кнопок — «Сводка» плюс четыре приёма. Один компонент,
   два облика (DESIGN.md, «Навигация: сводка первая»):
   - узкий экран (по умолчанию) — горизонтальная полоса под шапкой, как раньше
     переключатель приёмов;
   - широкий экран (`@media (min-width: 48rem)`, см. screen.css) — та же nav
     становится липкой боковой колонкой слева от содержимого, кнопки
     вертикально, и у каждого приёма (не у «Сводки») появляется вторая строка
     со статусом — `.slot-switch__sub`, на узком экране она скрыта чистым CSS,
     JSX один и тот же для обоих обликов.

   Кнопки — обычные `<button>`, первый текстовый узел — подпись «Сводка»/
   «Завтрак»/«Обед»/«Ужин»/«Перекус», за ней в DOM идёт строка статуса
   `.slot-switch__sub` (на узком экране скрыта CSS, но в textContent входит).
   Сценарий снимков (scripts/shots.mjs, clickNav) сравнивает именно первый
   текстовый узел, а не textContent целиком — подписи менять нельзя. */

import { SLOT_TITLE, SLOTS } from '../core/types.ts'
import type { Slot } from '../core/types.ts'
import { fractionLabel } from './fractions.ts'
import type { DaySlotProgress } from './slots.ts'
import type { View } from './App.tsx'

/** Короткая строка статуса приёма для второй строки кнопки в широком облике.
    Тот же смысл, что и у строки статуса в карточке DaySummary, но короче —
    там она делит место с названием блюда и планом в ккал, здесь его нет. */
function slotStatusShort(s: DaySlotProgress): string {
  if (s.status === undefined) return 'не записан'
  if (s.status === 'skipped') return 'пропустил'
  if (s.status === 'partial' && s.fraction !== undefined) return `съел ${fractionLabel(s.fraction)}`
  return 'съел'
}

interface SlotSwitchProps {
  /** Выбранный сейчас вид — 'day' (сводка) или конкретный приём. */
  view: View
  /** Приём, который идёт сейчас по времени суток — отмечается точкой,
      отдельно от того, какой вид выбран. */
  currentSlot: Slot
  /** Прогресс всех четырёх приёмов — источник строки статуса в широком
      облике. */
  daySlots: DaySlotProgress[]
  onSelect: (view: View) => void
}

export default function SlotSwitch({ view, currentSlot, daySlots, onSelect }: SlotSwitchProps) {
  return (
    <nav className="slot-switch">
      <button
        type="button"
        className={`slot-switch__btn${view === 'day' ? ' slot-switch__btn--active' : ''}`}
        aria-pressed={view === 'day'}
        onClick={() => onSelect('day')}
      >
        Сводка
      </button>
      {SLOTS.map(s => {
        const progress = daySlots.find(d => d.slot === s)
        return (
          <button
            key={s}
            type="button"
            className={`slot-switch__btn${s === view ? ' slot-switch__btn--active' : ''}`}
            aria-pressed={s === view}
            onClick={() => onSelect(s)}
          >
            {SLOT_TITLE[s]}
            {/* Точка — «этот приём идёт сейчас». Заливка — «этот выбран».
                Два разных признака: они могут стоять на разных кнопках. */}
            {s === currentSlot && <span className="slot-switch__now-dot" aria-label="сейчас" />}
            {progress && <span className="slot-switch__sub nums">{slotStatusShort(progress)}</span>}
          </button>
        )
      })}
    </nav>
  )
}
