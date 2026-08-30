/* Поведение модальной шторки: Escape, ловушка фокуса, возврат фокуса на
   кнопку-источник, блокировка прокрутки фона. Всё это система делает сама
   для нативных диалогов, и её отсутствие человек чувствует сразу: экран
   уезжает под шторкой, Tab уходит в невидимое, Escape ничего не делает. */

import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/** Что вообще может получить фокус внутри шторки. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function focusableIn(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(el => el.offsetParent !== null || el === document.activeElement)
}

/**
 * Возвращает ref, который надо повесить на панель шторки.
 * Владелец панели обязан дать ей `tabIndex={-1}`, иначе фокусу некуда встать,
 * когда внутри ещё нет ни одного элемента.
 */
export function useSheet(onClose: () => void): RefObject<HTMLDivElement | null> {
  const panelRef = useRef<HTMLDivElement>(null)

  /* onClose держим в ref: иначе новая функция на каждый рендер родителя
     переподписывала бы обработчики и сбрасывала фокус в середине набора. */
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const returnTo = document.activeElement as HTMLElement | null

    const first = focusableIn(panel)[0]
    ;(first ?? panel).focus({ preventScroll: true })

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const items = focusableIn(panel)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const active = document.activeElement
      // край списка заворачивается внутрь, а не выпускает фокус на фон
      if (e.shiftKey && (active === firstItem || active === panel)) {
        e.preventDefault()
        lastItem.focus()
      } else if (!e.shiftKey && active === lastItem) {
        e.preventDefault()
        firstItem.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    /* Фон не должен ехать под пальцем. Позицию прокрутки запоминаем и
       возвращаем: без этого закрытие шторки выбрасывало бы человека наверх. */
    const body = document.body
    const prevOverflow = body.style.overflow
    body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      body.style.overflow = prevOverflow
      // фокус возвращается туда, откуда шторку открыли, — иначе он падает
      // в начало документа и следующий Tab начинается с шапки
      returnTo?.focus?.({ preventScroll: true })
    }
  }, [])

  return panelRef
}
