/* Чистые функции форматирования выгрузки: текст для буфера обмена и CSV за день.
   Никакого DOM/navigator — только строки из данных. Округление тут же, потому что
   формат печати — это забота печатающего, а не общей арифметики КБЖУ (nutrition.ts). */

import { NUTRIENT_KEYS, NUTRIENT_TITLE, NUTRIENT_UNIT, SLOTS, SLOT_TITLE } from '../types.ts'
import type { Kbju, MealLogEntry, NutrientKey, NutrientTotal, NutrientTotals, NutrientUnit } from '../types.ts'
import { scaleNutrientTotals } from '../nutrition.ts'
import type { ExportPayload } from './types.ts'

type MealPayload = Extract<ExportPayload, { kind: 'meal' }>
type DayPayload = Extract<ExportPayload, { kind: 'day' }>

/** «2026-08-30» → «30.08». Год не печатаем — приём всегда про недавний день. */
export function formatDateShort(dateISO: string): string {
  const parts = dateISO.split('-')
  const d = parts[2] ?? dateISO
  const m = parts[1] ?? ''
  return m ? `${d}.${m}` : d
}

function round(n: number): number {
  return Math.round(n)
}

/** Доля → человеческая метка. 1 не печатается вовсе (обычный полный приём). */
const FRACTION_LABEL: Record<string, string> = {
  '0.75': '3/4',
  '0.5': '1/2',
  '0.25': '1/4',
  '0': 'пропущено'
}

function fractionLine(fraction: number): string | null {
  if (fraction === 1) return null
  const label = FRACTION_LABEL[String(fraction)] ?? `${round(fraction * 100)}%`
  return `съедено ${label}`
}

function kbjuLine(k: Kbju): string {
  return `${round(k.kcal)} ккал · Б ${round(k.p)} · Ж ${round(k.f)} · У ${round(k.c)}`
}

export function eatenOf(kbju: Kbju, fraction: number): Kbju {
  return { kcal: kbju.kcal * fraction, p: kbju.p * fraction, f: kbju.f * fraction, c: kbju.c * fraction }
}

/** Съеденные нутриенты: то же соглашение, что и eatenOf для КБЖУ. Отдельной
    арифметики тут нет — доля применяется общей scaleNutrientTotals, полнота при
    этом не меняется. */
export const eatenNutrientsOf = scaleNutrientTotals

/** Так печатается нутриент, о котором не знает НИ ОДНА позиция приёма. Ноль тут
    писать нельзя: «0 мг» и «неизвестно» — разные утверждения, и первое врёт. */
export const NO_DATA_TEXT = 'нет данных'

/** Разрядность по величине числа: 12 мг незачем печатать с тремя знаками, а
    0.004 мкг без них превратится в ноль, то есть в ложь. */
export function formatNutrientAmount(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 100) return value.toFixed(0)
  if (abs >= 10) return value.toFixed(1)
  if (abs >= 1) return value.toFixed(2)
  return value.toFixed(3)
}

/** Одна строка нутриента для человека: «Клетчатка: 12.3 г»,
    «Клетчатка: 12.3 г (известно по 3 из 5 позиций)» либо «Витамин K: нет данных». */
export function nutrientLine(key: NutrientKey, total: NutrientTotal): string {
  const title = NUTRIENT_TITLE[key]
  if (total.known === 0) return `${title}: ${NO_DATA_TEXT}`
  const amount = `${formatNutrientAmount(total.value)} ${NUTRIENT_UNIT[key]}`
  if (total.known < total.total) {
    return `${title}: ${amount} (известно по ${total.known} из ${total.total} позиций)`
  }
  return `${title}: ${amount}`
}

/** Блок нутриентов для буфера обмена — все ключи NUTRIENT_KEYS в их порядке.
    Скрывать неизвестные нельзя: пропавшая строка читается как «этого в еде нет»,
    а на деле это «мы не знаем». */
export function nutrientLines(totals: NutrientTotals): string[] {
  return NUTRIENT_KEYS.map(key => nutrientLine(key, totals[key]))
}

/** Текст одного приёма для буфера обмена:
    ```
    30.08, обед — Лосось с киноа
    986 ккал · Б 62 · Ж 41 · У 88
    съедено 1/2
    ```
    Числа — СЪЕДЕННОЕ: снапшот приёма домножается на долю, ровно как в дневном тексте,
    в CSV и в канале Health. Печатать здесь полный приём нельзя — человек копирует эту
    строку в чужой дневник, и при доле 1/2 она соврала бы вдвое. */
export function mealClipboardText(payload: MealPayload): string {
  const lines = [
    `${formatDateShort(payload.date)}, ${SLOT_TITLE[payload.slot].toLowerCase()} — ${payload.title}`,
    kbjuLine(eatenOf(payload.kbju, payload.fraction))
  ]
  const fl = fractionLine(payload.fraction)
  if (fl) lines.push(fl)
  lines.push('', 'Нутриенты:', ...nutrientLines(eatenNutrientsOf(payload.nutrients, payload.fraction)))
  return lines.join('\n')
}

/** Текст дня: дата, затем строка на каждый записанный приём (в порядке SLOTS,
    съеденное = снапшот × доля), итог — суммой, которую передал вызывающий. */
export function dayClipboardText(payload: DayPayload): string {
  const lines = [formatDateShort(payload.date)]
  for (const slot of SLOTS) {
    const entry = payload.meals.find(m => m.slot === slot)
    if (!entry) continue
    lines.push(`${SLOT_TITLE[slot]} — ${entry.title}`)
    lines.push(kbjuLine(eatenOf(entry.kbju, entry.fraction)))
    const fl = fractionLine(entry.fraction)
    if (fl) lines.push(fl)
  }
  lines.push(`Итого: ${kbjuLine(payload.total)}`)
  lines.push('', 'Нутриенты за день:', ...nutrientLines(payload.nutrients))
  return lines.join('\n')
}

/** Экранирование поля по RFC 4180: кавычки/запятые/переводы строк → в кавычках,
    внутренняя кавычка удваивается. */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function csvRow(fields: (string | number)[]): string {
  return fields.map(f => csvField(String(f))).join(',')
}

/** Латинское имя единицы для заголовка CSV: кириллица в имени колонки ломает
    разбор в чужих инструментах, а единица в имени нужна — иначе число без
    размерности. */
const CSV_UNIT_SUFFIX: Record<NutrientUnit, string> = { 'г': 'g', 'мг': 'mg', 'мкг': 'ug' }

/** Имена колонок нутриентов: fiber_g, calcium_mg, vitK_ug, ... */
export const CSV_NUTRIENT_COLUMNS: string[] = NUTRIENT_KEYS.map(
  key => `${key}_${CSV_UNIT_SUFFIX[NUTRIENT_UNIT[key]]}`
)

/** Колонка с перечнем нутриентов, посчитанных не по всем позициям приёма.
    Без неё частичная сумма в CSV выглядела бы полной — та же ложь, что и ноль
    вместо «нет данных», только тише. */
export const CSV_INCOMPLETE_COLUMN = 'incomplete'

export const CSV_HEADER = [
  'date', 'slot', 'title', 'kcal', 'protein', 'fat', 'carbs', 'fraction', 'status',
  ...CSV_NUTRIENT_COLUMNS,
  CSV_INCOMPLETE_COLUMN
].join(',')

/** Ячейка нутриента. ПУСТАЯ ячейка — «нет данных» (known === 0); честный ноль
    из датасета печатается как 0 и от пустой ячейки отличается. */
function csvNutrientCell(total: NutrientTotal): string {
  if (total.known === 0) return ''
  return formatNutrientAmount(total.value)
}

/** CSV за день: заголовок + строка на каждую запись дневника (в порядке SLOTS),
    десятичные через точку, CRLF, BOM для Excel/кириллицы. Колонки: макросы
    (1 знак), затем по колонке на каждый ключ NUTRIENT_KEYS и перечень неполных. */
export function buildDayCsv(payload: DayPayload): string {
  const rows: string[] = []
  for (const slot of SLOTS) {
    const entry: MealLogEntry | undefined = payload.meals.find(m => m.slot === slot)
    if (!entry) continue
    const eaten = eatenOf(entry.kbju, entry.fraction)
    const nutrients = eatenNutrientsOf(entry.nutrients, entry.fraction)
    const incomplete = NUTRIENT_KEYS.filter(key => {
      const t = nutrients[key]
      return t.known > 0 && t.known < t.total
    })
    rows.push(csvRow([
      payload.date,
      entry.slot,
      entry.title,
      eaten.kcal.toFixed(1),
      eaten.p.toFixed(1),
      eaten.f.toFixed(1),
      eaten.c.toFixed(1),
      entry.fraction,
      entry.status,
      ...NUTRIENT_KEYS.map(key => csvNutrientCell(nutrients[key])),
      incomplete.join(' ')
    ]))
  }
  return '﻿' + [CSV_HEADER, ...rows].join('\r\n')
}
