/* Шторка выгрузки съеденного. Числа — крупно и первым делом: это запасной путь,
   который работает, даже если все каналы мертвы. Дальше — список каналов: доступный
   даёт кнопку, недоступный — неяркую строку с причиной. Канала нет в реестре —
   на экране его нет: список ровно повторяет то, что вернул buildChannels. */

import { useCallback, useEffect, useState } from 'react'
import { NUTRIENT_KEYS, NUTRIENT_TITLE, NUTRIENT_UNIT, SLOT_TITLE } from '../core/types.ts'
import { buildDayCsv, CSV_FALLBACK_NOTE, dayClipboardText, eatenNutrientsOf, eatenOf, formatDateShort, formatNutrientAmount, mealClipboardText, NO_DATA_TEXT, readCallback, sendViaChannel } from '../core/export/index.ts'
import type { ExportChannel, ExportPayload } from '../core/export/index.ts'
import type { Kbju, NutrientTotals } from '../core/types.ts'
import './export.css'

interface ExportSheetProps {
  payload: ExportPayload
  channels: ExportChannel[]
  /** Зовётся, когда экран сам обнаружил возврат callback-а (?exported=<id>) —
      родитель решает, что делать с адресной строкой дальше. */
  onConfirmed: (id: string) => void
}

type ChannelState =
  | { kind: 'sending' }
  | { kind: 'ok'; note?: string }
  | { kind: 'pending'; note: string; confirmed: boolean }
  | { kind: 'error'; error: string }

function round(n: number): number {
  return Math.round(n)
}

function displayedKbju(payload: ExportPayload): Kbju {
  return payload.kind === 'meal' ? eatenOf(payload.kbju, payload.fraction) : payload.total
}

/** Нутриенты выгрузки: у приёма снапшот полный, долю применяем здесь — ровно
    как для КБЖУ через eatenOf; у дня сумма уже съеденная. */
function displayedNutrients(payload: ExportPayload): NutrientTotals {
  return payload.kind === 'meal' ? eatenNutrientsOf(payload.nutrients, payload.fraction) : payload.nutrients
}

function headline(payload: ExportPayload): string {
  if (payload.kind === 'meal') {
    return `${formatDateShort(payload.date)}, ${SLOT_TITLE[payload.slot].toLowerCase()} — ${payload.title}`
  }
  return `${formatDateShort(payload.date)} — итог дня`
}

function previewText(payload: ExportPayload): string {
  return payload.kind === 'meal' ? mealClipboardText(payload) : dayClipboardText(payload)
}

export default function ExportSheet({ payload, channels, onConfirmed }: ExportSheetProps) {
  const [results, setResults] = useState<Record<string, ChannelState>>({})

  useEffect(() => {
    function checkCallback(): void {
      const id = readCallback(window.location.search)
      if (!id) return
      setResults(prev => {
        const health = prev['health-shortcut']
        if (!health || health.kind !== 'pending') return prev
        return { ...prev, 'health-shortcut': { ...health, confirmed: true } }
      })
      onConfirmed(id)
    }
    checkCallback()
    document.addEventListener('visibilitychange', checkCallback)
    window.addEventListener('focus', checkCallback)
    return () => {
      document.removeEventListener('visibilitychange', checkCallback)
      window.removeEventListener('focus', checkCallback)
    }
  }, [onConfirmed])

  const handleSend = useCallback(async (channel: ExportChannel) => {
    setResults(prev => ({ ...prev, [channel.id]: { kind: 'sending' } }))
    const result = await sendViaChannel(channel, payload)
    setResults(prev => {
      if (result.ok === true) return { ...prev, [channel.id]: { kind: 'ok', note: result.note } }
      if (result.ok === 'pending') return { ...prev, [channel.id]: { kind: 'pending', note: result.note, confirmed: false } }
      return { ...prev, [channel.id]: { kind: 'error', error: result.error } }
    })
  }, [payload])

  const k = displayedKbju(payload)
  const nutrients = displayedNutrients(payload)

  return (
    <div className="export-sheet">
      <div className="export-sheet__numbers">
        <div className="export-sheet__headline">{headline(payload)}</div>
        <div className="export-sheet__kcal">{round(k.kcal)} ккал</div>
        <div className="export-sheet__bju">Б {round(k.p)} · Ж {round(k.f)} · У {round(k.c)}</div>
      </div>

      <ul className="export-sheet__nutrients">
        {NUTRIENT_KEYS.map(key => {
          const total = nutrients[key]
          const known = total.known > 0
          return (
            <li key={key} className={`export-nutrient${known ? '' : ' export-nutrient--unknown'}`}>
              <span className="export-nutrient__name">{NUTRIENT_TITLE[key]}</span>
              <span className="export-nutrient__value">
                {known ? `${formatNutrientAmount(total.value)} ${NUTRIENT_UNIT[key]}` : NO_DATA_TEXT}
                {known && total.known < total.total && (
                  <span className="export-nutrient__hint">по {total.known} из {total.total} позиций</span>
                )}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="export-sheet__channels">
        {channels.map(channel => {
          const avail = channel.availability()
          if (!avail.available) {
            return (
              <div key={channel.id} className="export-channel export-channel--disabled">
                <span className="export-channel__title">{channel.title}</span>
                <span className="export-channel__reason">{avail.reason}</span>
              </div>
            )
          }

          const state = results[channel.id]
          return (
            <div key={channel.id} className="export-channel">
              <button
                type="button"
                className="export-channel__button"
                disabled={state?.kind === 'sending'}
                onClick={() => { void handleSend(channel) }}
              >
                {channel.title}
              </button>
              {state?.kind === 'sending' && (
                <span className="export-channel__status export-channel__status--pending">Отправляю…</span>
              )}
              {state?.kind === 'ok' && (
                <span className="export-channel__status export-channel__status--ok">
                  {state.note ?? 'Готово'}
                </span>
              )}
              {state?.kind === 'pending' && (
                <span className={`export-channel__status export-channel__status--pending${state.confirmed ? ' export-channel__status--ok' : ''}`}>
                  {state.confirmed ? 'Подтверждено' : state.note}
                </span>
              )}
              {state?.kind === 'error' && (
                <span className="export-channel__status export-channel__status--error">{state.error}</span>
              )}
              {channel.id === 'csv' && state?.kind === 'ok' && state.note === CSV_FALLBACK_NOTE && payload.kind === 'day' && (
                <textarea
                  className="export-channel__csv-text"
                  readOnly
                  value={buildDayCsv(payload)}
                  onFocus={e => e.currentTarget.select()}
                />
              )}
            </div>
          )
        })}
      </div>

      <details className="export-sheet__preview">
        <summary>Показать текстом (на случай, если ни один канал не сработал)</summary>
        <pre>{previewText(payload)}</pre>
      </details>
    </div>
  )
}
