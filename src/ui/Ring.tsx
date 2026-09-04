/* Кольцо прогресса - зрительный центр сводки дня. SVG, а не полоса: у дня
   есть цель, и «сколько осталось» читается кольцом с одного взгляда, тогда
   как полоса требует сравнить две длины.

   Честность (DESIGN.md, «Честность - часть дизайна»): цели нет (max <= 0) -
   заливки нет вовсе, кольцо остаётся пустой дорожкой. Доля от неизвестного
   не рисуется. Съедено больше цели - кольцо целиком заливается --ring-over,
   и отметка 100 % остаётся видимой засечкой на старте дуги: иначе «на пределе»
   и «вдвое сверх» выглядели бы одинаково полным кругом. */

import type { ReactNode } from 'react'

interface RingProps {
  /** Сторона квадрата в системе координат SVG (viewBox). Экранный размер
      задаёт CSS (--ring-size, --ring-size-wide), SVG масштабируется. */
  size: number
  /** Толщина дуги в той же системе координат. */
  stroke: number
  value: number
  /** Цель. Ноль или меньше означает «цели нет»: заливки не будет. */
  max: number
  /** Единица для голосового описания: «ккал», «г». */
  unit: string
  /** Содержимое центра кольца - число и подпись под ним. */
  children?: ReactNode
}

export default function Ring({ size, stroke, value, max, unit, children }: RingProps) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const hasTarget = max > 0
  const ratio = hasTarget ? value / max : 0
  const over = ratio > 1
  const shown = Math.min(1, Math.max(0, ratio))

  const label = hasTarget
    ? (over
      ? `${Math.round(value)} из ${Math.round(max)} ${unit}, сверх цели ${Math.round(value - max)} ${unit}`
      : `${Math.round(value)} из ${Math.round(max)} ${unit}, осталось ${Math.round(max - value)} ${unit}`)
    : `${Math.round(value)} ${unit}, цели нет`

  const center = size / 2

  return (
    <div className="ring" role="img" aria-label={label}>
      <svg className="ring__svg" viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true" focusable="false">
        <circle
          className="ring__track"
          cx={center} cy={center} r={radius}
          fill="none" strokeWidth={stroke}
        />
        {hasTarget && (
          <circle
            className={`ring__fill${over ? ' ring__fill--over' : ''}`}
            cx={center} cy={center} r={radius}
            fill="none" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - (over ? 1 : shown))}
            transform={`rotate(-90 ${center} ${center})`}
          />
        )}
        {/* Засечка на отметке 100 %: у кольца конец совпадает с началом, и без
            неё полный круг сверх цели не отличить от ровно набранной цели. */}
        {over && (
          <line
            className="ring__mark"
            x1={center} y1={center - radius - stroke / 2}
            x2={center} y2={center - radius + stroke / 2}
          />
        )}
      </svg>
      <div className="ring__center">{children}</div>
    </div>
  )
}
