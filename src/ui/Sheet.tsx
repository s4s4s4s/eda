/* Каркас шторки: подложка, панель, полоска-хват, шапка с заголовком и
   закрытием. Один каркас на все шторки — настройки, выгрузка, неделя, —
   чтобы поведение и разметка не расходились по копиям. */

import { useId } from 'react'
import type { ReactNode } from 'react'
import { useSheet } from './useSheet.ts'

interface SheetProps {
  title: string
  onClose: () => void
  children: ReactNode
}

export default function Sheet({ title, onClose, children }: SheetProps) {
  const panelRef = useSheet(onClose)
  const titleId = useId()

  return (
    <div className="sheet">
      <div className="sheet__backdrop" onClick={onClose} />
      <div
        className="sheet__panel"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <span className="sheet__grabber" aria-hidden="true" />
        <header className="sheet__header">
          <h1 className="sheet__title" id={titleId}>{title}</h1>
          <button type="button" className="sheet__close" onClick={onClose} aria-label="Закрыть">✕</button>
        </header>
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  )
}
