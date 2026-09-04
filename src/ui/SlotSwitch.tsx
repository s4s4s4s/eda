/* Навигация по приёмам. Один компонент, три облика, и все три задаёт CSS
   (layout.css), а не вторая ветка разметки - DESIGN.md, «Навигация: сводка
   первая»:
   - узкий экран, вид приёма: сегментированный контрол из четырёх приёмов над
     содержимым, глиф SlotIcon над подписью; кнопка «Сводка» в нём скрыта -
     назад ведёт «← Сводка» (App.tsx), а на приём со сводки ведут карточки;
   - узкий экран, вид сводки: переключателя нет вовсе;
   - широкий (`@media (min-width: 48rem)`): та же nav - липкая боковая колонка
     из пяти пунктов, у каждого приёма вторая строка со статусом
     (`.slot-switch__sub`, на узком скрыта чистым CSS).

   Кнопки - обычные `<button>`, и ПЕРВЫЙ ТЕКСТОВЫЙ УЗЕЛ кнопки - подпись
   «Сводка»/«Завтрак»/«Обед»/«Ужин»/«Перекус». Глиф стоит над подписью, но в
   разметке идёт ПОСЛЕ неё и поднимается наверх свойством order: сценарий
   снимков (scripts/shots.mjs, navBtn) сравнивает именно первый текстовый узел,
   и порядок в DOM менять нельзя. */

import { SLOT_TITLE, SLOTS } from '../core/types.ts'
import type { Slot } from '../core/types.ts'
import { fractionLabel } from './fractions.ts'
import SlotIcon from './SlotIcon.tsx'
import type { DaySlotProgress } from './slots.ts'
import type { View } from './App.tsx'

/** Короткая строка статуса приёма для второй строки кнопки в широком облике.
    Тот же смысл, что и у строки статуса в карточке DaySummary, но короче -
    там она делит место с названием блюда и планом в ккал, здесь его нет. */
function slotStatusShort(s: DaySlotProgress): string {
  if (s.status === undefined) return 'не записан'
  if (s.status === 'skipped') return 'пропустил'
  if (s.status === 'partial' && s.fraction !== undefined) return `съел ${fractionLabel(s.fraction)}`
  return 'съел'
}

interface SlotSwitchProps {
  /** Выбранный сейчас вид - 'day' (сводка) или конкретный приём. */
  view: View
  /** Приём, который идёт сейчас по времени суток - отмечается точкой,
      отдельно от того, какой вид выбран. */
  currentSlot: Slot
  /** Прогресс всех четырёх приёмов - источник строки статуса в широком
      облике. */
  daySlots: DaySlotProgress[]
  onSelect: (view: View) => void
}

export default function SlotSwitch({ view, currentSlot, daySlots, onSelect }: SlotSwitchProps) {
  return (
    <nav className="slot-switch">
      <button
        type="button"
        className={`slot-switch__btn slot-switch__btn--summary${view === 'day' ? ' slot-switch__btn--active' : ''}`}
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
            {/* Глиф идёт после подписи намеренно, см. комментарий в шапке. */}
            <span className="slot-switch__icon">
              <SlotIcon slot={s} />
            </span>
            {/* Точка - «этот приём идёт сейчас». Заливка - «этот выбран».
                Два разных признака: они могут стоять на разных кнопках. */}
            {s === currentSlot && <span className="slot-switch__now-dot" aria-label="сейчас" />}
            {progress && <span className="slot-switch__sub nums">{slotStatusShort(progress)}</span>}
          </button>
        )
      })}
    </nav>
  )
}
