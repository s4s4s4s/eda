import type { Kbju, MealLogEntry, NutrientTotals, Slot } from '../types.ts'

/* Контракт канала выгрузки.
   Смысл контракта — в честности кнопки. Канал обязан уметь сказать про себя
   «я недоступен и вот почему», а `send` обязан вернуть ok только тогда, когда
   действие ДЕЙСТВИТЕЛЬНО произошло. Кнопка, которая делает вид, что отправила,
   запрещена: если канал не может подтвердить доставку сам, он возвращает
   `pending` и объясняет, чем подтверждение придёт. */

export type ExportPayload =
  | {
      kind: 'meal'
      date: string
      slot: Slot
      title: string
      /** СНАПШОТ ПОЛНОГО приёма, без учёта доли. Долю применяет каждый потребитель
          сам, через `eatenOf(kbju, fraction)`. Держать здесь уже домноженное число
          нельзя: тогда `fraction` в этой же полезной нагрузке становится ловушкой —
          потребитель, применивший её ещё раз, тихо занизит выгрузку вдвое. */
      kbju: Kbju
      /** Тоже СНАПШОТ ПОЛНОГО приёма — соглашение ровно то же, что для kbju:
          долю применяет потребитель. Второго соглашения тут нет и быть не должно.
          Полнота (known/total) долей не меняется. */
      nutrients: NutrientTotals
      fraction: number
    }
  | {
      kind: 'day'
      date: string
      meals: MealLogEntry[]
      total: Kbju
      /** Дневная сумма нутриентов — уже съеденное (доли применены при сборке
          дня, ровно как у total). */
      nutrients: NutrientTotals
    }

export type Availability =
  | { available: true }
  /** reason показывается человеку вместо кнопки — обычными словами. */
  | { available: false; reason: string }

export type ExportResult =
  /** Доставка подтверждена здесь и сейчас. */
  | { ok: true; note?: string }
  /** Действие начато, подтверждение придёт извне (возврат из Команд).
      Экран обязан показать это как «ждём подтверждения», а не как «готово». */
  | { ok: 'pending'; note: string }
  | { ok: false; error: string }

export interface ExportChannel {
  id: string
  title: string
  /** Зовётся при каждом открытии шторки экспорта, синхронно. */
  availability(): Availability
  send(payload: ExportPayload): Promise<ExportResult>
}
