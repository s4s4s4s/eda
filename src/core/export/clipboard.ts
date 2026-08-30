/* Канал «буфер обмена». Доступен только там, где браузер даёт Clipboard API;
   send подтверждает успех только после того, как запись реально ушла в буфер. */

import { dayClipboardText, mealClipboardText } from './format.ts'
import type { Availability, ExportChannel, ExportPayload, ExportResult } from './types.ts'

function textFor(payload: ExportPayload): string {
  return payload.kind === 'meal' ? mealClipboardText(payload) : dayClipboardText(payload)
}

function getClipboard(): { writeText: (text: string) => Promise<void> } | undefined {
  const nav = (globalThis as unknown as { navigator?: { clipboard?: { writeText?: unknown } } }).navigator
  const clip = nav?.clipboard
  if (clip && typeof clip.writeText === 'function') {
    return clip as { writeText: (text: string) => Promise<void> }
  }
  return undefined
}

const NO_CLIPBOARD_REASON = 'Браузер не даёт доступ к буферу обмена'

export function clipboardChannel(): ExportChannel {
  return {
    id: 'clipboard',
    title: 'Скопировать в буфер',
    availability(): Availability {
      return getClipboard() ? { available: true } : { available: false, reason: NO_CLIPBOARD_REASON }
    },
    async send(payload: ExportPayload): Promise<ExportResult> {
      const clip = getClipboard()
      if (!clip) return { ok: false, error: NO_CLIPBOARD_REASON }
      try {
        await clip.writeText(textFor(payload))
        return { ok: true }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        return { ok: false, error: `Не удалось скопировать: ${message}` }
      }
    }
  }
}
