/* Строка состояния заказа на разбор: общая для шторки «Своя еда» и очереди
   в «Журнале дня». Рисует только то, что заказ не готов (pending, failed,
   expired): готовый разбор показывает вызывающая сторона, здесь для done
   честно возвращается null.

   Тексты pending и expired дословно из DESIGN.md, раздел про шторку «Своя
   еда»: отступать от них нельзя, это единственное место, где человек узнаёт,
   что происходит с его запросом на дальнем компьютере. Причина failed
   показывается как пришла с компьютера. Кнопки зависят от вида заказа:
   текстовый можно «Повторить» с тем же текстом, а снимок наклейки повторять
   нечем (снимок после разбора вырезается из наряда), поэтому у 'label'
   вместо этого «Переснять». У заказа по товару (kind === 'product') витамины
   считает компьютер, но запись в журнал от него не зависит: пока заказ ждёт,
   его можно записать сразу без витаминов (onLogNow), а в failed и expired
   кнопки «Записать без витаминов», «Повторить» и «Убрать». */

import { useState } from 'react'
import { formatDateShort } from '../core/export/index.ts'
import type { FoodRequest } from '../core/types.ts'

export type RequestActionResult = { ok: true } | { ok: false; error: string }

export interface RequestStatusProps {
  request: FoodRequest
  /** Только для заказов kind === 'text': новый запрос с тем же текстом. */
  onRetry: (id: string) => Promise<RequestActionResult>
  /** Только для kind === 'label': открыть съёмку заново. */
  onRetake: (id: string) => void
  onDiscard: (id: string) => void
  /** Только для kind === 'product': записать товар без витаминов, не дожидаясь компьютера. */
  onLogNow?: (id: string) => void
  /** Дата сводки, на которой стоит строка (YYYY-MM-DD). Дата заказа другая:
      к названию добавляется «за ДД.ММ», чтобы заказ вчерашнего дня не выглядел
      сегодняшним. Не задана: дату не показываем. */
  summaryDate?: string
}

/** Русское склонение по числу - та же форма, что entryWord в App.tsx и
    daysWord в SettingsSheet.tsx, своя копия по той же причине (разные файлы,
    разные задачи одновременно). */
function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  switch (n % 10) {
    case 1: return one
    case 2:
    case 3:
    case 4: return few
    default: return many
  }
}

/** «45 минут» / «3 часа» / «2 дня» - грубая (округлённая до одной единицы)
    длительность простоя компьютера для текста pending при pcAgo > 120 с. */
function formatOfflineDuration(pcAgoSeconds: number): string {
  if (pcAgoSeconds < 3600) {
    const n = Math.max(1, Math.round(pcAgoSeconds / 60))
    return `${n} ${pluralRu(n, 'минута', 'минуты', 'минут')}`
  }
  if (pcAgoSeconds < 86_400) {
    const n = Math.max(1, Math.round(pcAgoSeconds / 3600))
    return `${n} ${pluralRu(n, 'час', 'часа', 'часов')}`
  }
  const n = Math.max(1, Math.round(pcAgoSeconds / 86_400))
  return `${n} ${pluralRu(n, 'день', 'дня', 'дней')}`
}

/** Текст состояния заказа; null у done (его показывает разбор). */
export function requestStatusText(request: FoodRequest): string | null {
  switch (request.status) {
    case 'pending':
      if (request.pcAgo === null) return 'Запрос в очереди, компьютер ещё ни разу не выходил на связь.'
      if (request.pcAgo <= 120) {
        return `Запрос в очереди, компьютер на связи (${request.pcAgo} с назад). Обычно разбор занимает около минуты.`
      }
      return `Запрос в очереди, компьютер не в сети уже ${formatOfflineDuration(request.pcAgo)}, разбор придёт, когда он включится; запрос живёт сутки.`
    case 'failed':
      return request.error ?? 'Разбор не удался'
    case 'expired':
      return 'Компьютер не взял запрос за сутки.'
    case 'done':
      return null
  }
}

/** Что заказывали: у текстового это сам текст, у снимка наклейки заметка
    человека, а если её нет, то нейтральная подпись. */
function requestTitle(request: FoodRequest): string {
  if (request.kind === 'product' && request.product) return `${request.product.name} · ${request.grams} г`
  const base = request.kind === 'label'
    ? (request.text.trim() !== '' ? request.text : 'Снимок наклейки')
    : request.text
  return request.grams !== null ? `${base} · ${request.grams} г` : base
}

export default function RequestStatus({ request, onRetry, onRetake, onDiscard, onLogNow, summaryDate }: RequestStatusProps) {
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)

  const statusText = requestStatusText(request)
  if (statusText === null) return null

  const stuck = request.status === 'failed' || request.status === 'expired'
  const canLogNow = request.kind === 'product' && onLogNow !== undefined

  async function handleRetry(): Promise<void> {
    setRetrying(true)
    setRetryError(null)
    const result = await onRetry(request.id)
    setRetrying(false)
    if (!result.ok) setRetryError(result.error)
  }

  return (
    <div className={stuck ? 'request-status request-status--stuck' : 'request-status'}>
      <span className="request-status__text">
        {requestTitle(request)}
        {summaryDate !== undefined && request.target.date !== summaryDate && ` · за ${formatDateShort(request.target.date)}`}
      </span>
      <p className="request-status__message">{statusText}</p>
      {request.status === 'pending' && canLogNow && (
        <div className="request-status__actions">
          <button type="button" className="btn btn--secondary" onClick={() => onLogNow(request.id)}>
            Записать сейчас без витаминов
          </button>
        </div>
      )}
      {stuck && (
        <div className="request-status__actions">
          {canLogNow && (
            <button type="button" className="btn btn--secondary" onClick={() => onLogNow(request.id)}>
              Записать без витаминов
            </button>
          )}
          {request.kind === 'label'
            ? (
              <button type="button" className="btn btn--secondary" onClick={() => onRetake(request.id)}>
                Переснять
              </button>
            )
            : (
              <button type="button" className="btn btn--secondary" disabled={retrying} onClick={handleRetry}>
                Повторить
              </button>
            )}
          <button type="button" className="btn btn--secondary" onClick={() => onDiscard(request.id)}>
            Убрать
          </button>
        </div>
      )}
      {retryError && <p className="custom-food__error" role="alert">{retryError}</p>}
    </div>
  )
}
