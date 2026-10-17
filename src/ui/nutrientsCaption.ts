/* Подпись блока нутриентов: что именно вошло в сумму. Чистая функция без
   React, вынесена из NutrientsBlock.tsx, чтобы её проверяли тесты. */

import { SLOT_TITLE } from '../core/types.ts'
import type { ExtraLogEntry } from '../core/types.ts'
import { fractionLabel } from './fractions.ts'
import type { DaySlotProgress } from './slots.ts'

/** Режим списка нутриентов. Нормы суточные, поэтому процент считается только
    за день или за проекцию дня; «этот приём» показывает те же строки без
    полос и процентов.
    - `day` — сумма записанных в дневник приёмов.
    - `projected` — та же сумма плюс текущий приём целиком, то есть каким
      станет день, если его съесть. Существует только пока текущий приём
      есть в меню и ещё не записан — записанный приём день уже содержит.
    - `meal` — только текущий приём, без процентов: сравнивать его с
      суточной нормой было бы враньём. */
export type NutrientsMode = 'day' | 'projected' | 'meal'

/** Строка-подпись под чипами режимов: что именно вошло в сумму. `day` и
    `projected` перечисляют записанные слоты дня по порядку `SLOTS`,
    приём со статусом «съел часть» — с долей; `projected` дописывает
    текущий приём отдельно, потому что он в дневник ещё не попал.

    Если среди записанных слотов дня есть хоть один со снапшотом по чужой или
    отсутствующей ревизии справочника, подпись коротко предупреждает об этом:
    подробности — в meal-revision-note у самой записи (см. `revisionNote`),
    здесь только флаг, что день считает по смеси справочников. Добавленная
    еда (`extras`) перечисляется отдельным хвостом «+ добавлено: …» — она не
    входит в meals и своего слота-подписи не имеет, но входит в те же суммы
    dayTotals/dayNutrientTotals. Записанных слотов нет — добавленная еда
    перечисляется сразу после «записано:». */
export function nutrientsCaption(
  mode: NutrientsMode,
  daySlots: DaySlotProgress[],
  productsRevision: string,
  extras: ExtraLogEntry[]
): string {
  if (mode === 'meal') return ''
  const loggedSlots = daySlots.filter(s => s.status !== undefined)
  const parts = loggedSlots.map(s => {
    const name = SLOT_TITLE[s.slot].toLowerCase()
    /* Пропущенный приём в дневнике есть, а в сумме его нет — назвать его
       просто «записано: обед» значило бы сказать, что обед в числах. */
    if (s.status === 'skipped') return `${name} (пропущен)`
    if (s.status === 'partial' && s.fraction !== undefined) return `${name} (${fractionLabel(s.fraction)})`
    return name
  })
  const extrasList = extras.map(e => `${e.title} (${fractionLabel(e.fraction)})`).join(', ')
  /* Без записанных слотов (цикл меню выключен, журнал из одних наклеек и своей
     еды) добавленное и есть «записано», а не довесок к пустому дню: иначе
     подпись говорила бы «ничего не записано + добавлено: …» сама себе поперёк. */
  const base = parts.length > 0
    ? `записано: ${parts.join(', ')}`
    : extras.length > 0 ? `записано: ${extrasList}` : 'за день пока ничего не записано'
  const withProjected = mode === 'projected' ? `${base} + этот приём (не записан)` : base
  const withExtras = parts.length > 0 && extras.length > 0
    ? `${withProjected} + добавлено: ${extrasList}`
    : withProjected
  // Пропущенный приём в сумму дня не входит (см. комментарий выше и
  // scaleNutrientTotals) — его ревизия справочника не влияет на то, по каким
  // числам посчитана сама сумма, и не должна включать оговорку о смеси
  // справочников. Проверяем только слоты, реально вошедшие в сумму, и
  // добавленные блюда меню (kind 'menu') — своя еда (kind 'custom') не несёт
  // productsRevision вовсе, у неё источник другой (USDA через воркер).
  const hasOldRevisionMeals = loggedSlots.some(s => s.status !== 'skipped' && s.productsRevision !== productsRevision)
  const hasOldRevisionExtras = extras.some(e => e.kind === 'menu' && e.productsRevision !== productsRevision)
  return (hasOldRevisionMeals || hasOldRevisionExtras)
    ? `${withExtras} · часть записей по прежнему справочнику`
    : withExtras
}
