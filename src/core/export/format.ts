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

/** Разрядность по величине ОКРУГЛЁННОГО числа, а не исходного: три значащие
    цифры дают magnitude+1 целых разрядов и (2 - magnitude) дробных, но не
    больше трёх дробных знаков и не меньше нуля. */
function decimalsForMagnitude(magnitude: number): number {
  return Math.max(0, Math.min(3, 2 - magnitude))
}

/** Три значащие цифры, честный ноль и без прыжков разрядности на границе
    сотни. Раньше 0 и 0.0004 печатались одинаково («0.000») — это две разные
    лжи (нулевое значение и «слишком мало, чтобы увидеть» — читаются как одно
    и то же), а 99.99 и 100.4 попадали в разные ветки по ИСХОДНОМУ числу и
    печатались «100.0» и «100» — тоже мимо смысла «три значащие цифры».
    Разрядность здесь всегда считается уже ПОСЛЕ округления: 99.99 сначала
    округляется до 100 (три значащие цифры), и только потом по числу 100
    выбирается ноль дробных знаков, а не наоборот. */
export function formatNutrientAmount(value: number): string {
  if (value === 0) return '0'
  const abs = Math.abs(value)
  // Меньше тысячной доли — округление до трёх знаков дало бы «0.000», то есть
  // выглядело бы как честный ноль, которым не является: датасет знает про
  // это число, просто оно совсем маленькое.
  if (abs < 0.0005) return '< 0.001'
  /* Отдельной ветки для чисел меньше единицы нет намеренно: общая формула даёт
     для них те же три знака, а 0.9996 после округления становится единицей и
     печатается «1.00», а не «1.000» — четвёртая значащая цифра была бы ложью
     о точности. */
  const magnitude = Math.floor(Math.log10(abs))
  const rounded = Number(value.toFixed(decimalsForMagnitude(magnitude)))
  const roundedMagnitude = rounded === 0 ? 0 : Math.floor(Math.log10(Math.abs(rounded)))
  return rounded.toFixed(decimalsForMagnitude(roundedMagnitude))
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

/** Доля добавленной еды в скобках рядом с названием: «+ Тирамису (1/2)».
    Полная порция скобок не получает — приписка «(целиком)» к каждой строке
    была бы шумом, а не сведением. */
function extraFractionSuffix(fraction: number): string {
  if (fraction === 1) return ''
  const label = FRACTION_LABEL[String(fraction)] ?? `${round(fraction * 100)}%`
  return ` (${label})`
}

/** Текст дня: дата, затем строка на каждый записанный приём (в порядке SLOTS,
    съеденное = снапшот × доля), затем добавленная сверх меню еда строками
    «+ название (доля)», итог — суммой, которую передал вызывающий.
    Добавленное печатается отдельным списком, а не подмешивается к приёмам:
    «обед» в тексте означает блюдо меню, и десерт, съеденный после него, — не он. */
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
  for (const extra of payload.extras) {
    lines.push(`+ ${extra.title}${extraFractionSuffix(extra.fraction)}`)
    lines.push(kbjuLine(eatenOf(extra.kbju, extra.fraction)))
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

/** Значение колонки `status` у строки добавленной еды. Собственный статус, а не
    'eaten': строка описывает съеденное сверх меню, и подставить сюда статус
    приёма значило бы объявить, что приём меню съеден, — статуса, которого у
    добавленной еды нет по устройству (см. ExtraLogEntry в types.ts). */
export const CSV_EXTRA_STATUS = 'extra'

/** Одна строка CSV: съеденное (снапшот × доля), нутриенты и перечень тех из
    них, чьё число посчитано не по всем позициям. */
function csvEntryRow(
  date: string,
  slot: string,
  title: string,
  kbju: Kbju,
  totals: NutrientTotals,
  fraction: number,
  status: string
): string {
  const eaten = eatenOf(kbju, fraction)
  const nutrients = eatenNutrientsOf(totals, fraction)
  const incomplete = NUTRIENT_KEYS.filter(key => {
    const t = nutrients[key]
    return t.known > 0 && t.known < t.total
  })
  return csvRow([
    date,
    slot,
    title,
    eaten.kcal.toFixed(1),
    eaten.p.toFixed(1),
    eaten.f.toFixed(1),
    eaten.c.toFixed(1),
    fraction,
    status,
    ...NUTRIENT_KEYS.map(key => csvNutrientCell(nutrients[key])),
    incomplete.join(' ')
  ])
}

/** CSV за день: заголовок + строка на каждую запись дневника (в порядке SLOTS),
    затем строка на каждую добавленную сверх меню еду (в порядке добавления,
    status = extra), десятичные через точку, CRLF, BOM для Excel/кириллицы.
    Колонки: макросы (1 знак), затем по колонке на каждый ключ NUTRIENT_KEYS и
    перечень неполных. */
export function buildDayCsv(payload: DayPayload): string {
  const rows: string[] = []
  for (const slot of SLOTS) {
    const entry: MealLogEntry | undefined = payload.meals.find(m => m.slot === slot)
    if (!entry) continue
    rows.push(csvEntryRow(payload.date, entry.slot, entry.title, entry.kbju, entry.nutrients, entry.fraction, entry.status))
  }
  for (const extra of payload.extras) {
    rows.push(csvEntryRow(payload.date, extra.slot, extra.title, extra.kbju, extra.nutrients, extra.fraction, CSV_EXTRA_STATUS))
  }
  return '﻿' + [CSV_HEADER, ...rows].join('\r\n')
}
