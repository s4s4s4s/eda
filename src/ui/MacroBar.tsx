/* Строка макроса: подпись, съедено/цель в граммах и полоса своим цветом.

   Цели может не быть: у белка она задана в настройках, а у жиров и углеводов
   её нет вовсе - там знаменателем работает план меню на день, и в дни без
   меню его тоже нет. Тогда полосы нет, остаётся одно число: доля от
   неизвестного - враньё (DESIGN.md, «Честность - часть дизайна»).

   Поэтому же подпись знаменателя приходит пропсом (caption): «цель» и «из
   плана меню» - разные утверждения, и подменять одно другим нельзя. */

import type { CSSProperties } from 'react'

interface MacroBarProps {
  label: string
  eatenG: number
  /** Знаменатель. Ноль или меньше означает «его нет»: полосы не будет. */
  targetG: number
  /** Имя цветового токена полосы: '--macro-protein', '--macro-fat',
      '--macro-carbs'. Цвет по месту не задаётся, только токеном. */
  color: string
  /** Что за знаменатель: «цель», «из плана меню». Виден только когда он есть. */
  caption: string
}

export default function MacroBar({ label, eatenG, targetG, color, caption }: MacroBarProps) {
  const hasTarget = targetG > 0
  const ratio = hasTarget ? eatenG / targetG : 0
  /* Сверх знаменателя полоса не растёт, но меняет цвет: «съел ровно план»
     и «съел вдвое больше» не имеют права выглядеть одинаково (DESIGN.md,
     «Покрытие норм»). */
  const over = ratio > 1
  const style = { '--macro-color': `var(${color})` } as CSSProperties

  return (
    <div className="macro" style={style}>
      <span className="macro__dot" aria-hidden="true" />
      <span className="macro__label">{label}</span>
      <span className="macro__value nums">
        {hasTarget ? `${Math.round(eatenG)} / ${Math.round(targetG)} г` : `${Math.round(eatenG)} г`}
        {/* Знаменатель подписан прямо у числа, а не отдельной строкой: три
            строки на макрос делали карточку выше кольца. */}
        {hasTarget && <span className="macro__caption">{caption}</span>}
      </span>
      {hasTarget && (
        <span className="macro__bar">
          <span
            className={`macro__fill${over ? ' macro__fill--over' : ''}`}
            style={{ width: `${Math.min(1, ratio) * 100}%` }}
          />
        </span>
      )}
    </div>
  )
}
