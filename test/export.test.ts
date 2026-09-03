/**
 * Тесты слоя выгрузки (src/core/export/*) — чистые функции и честность каналов,
 * без браузера: navigator/location/window подменяются заглушками через globalThis.
 *
 * Запуск: `npm run test:export` (esbuild бандлит файл и node его исполняет).
 */
import type { ExportChannel, ExportPayload } from '../src/core/export/types.ts'
import {
  buildDayCsv, CSV_HEADER, CSV_NUTRIENT_COLUMNS, dayClipboardText, formatNutrientAmount, mealClipboardText, NO_DATA_TEXT
} from '../src/core/export/format.ts'
import { emptyNutrientTotals } from '../src/core/nutrition.ts'
import { NUTRIENT_KEYS, NUTRIENT_UNIT } from '../src/core/types.ts'
import type { NutrientTotals } from '../src/core/types.ts'
import { clipboardChannel } from '../src/core/export/clipboard.ts'
import { CSV_FALLBACK_NOTE, CSV_NOT_A_DAY_ERROR, csvChannel } from '../src/core/export/csv.ts'
import { buildShortcutUrl, healthNutrients, healthShortcutChannel, NO_HEALTHKIT_TYPE, readCallback } from '../src/core/export/health-shortcut.ts'
import { buildChannels, sendViaChannel, SKIPPED_MEAL_REASON } from '../src/core/export/index.ts'
import type { Kbju, MealLogEntry } from '../src/core/types.ts'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}
function group(name: string): void { console.log(`  ✓ ${name}`); passed++ }

// ---- фабрики ---------------------------------------------------------------

const kbju = (kcal: number, p: number, f: number, c: number): Kbju => ({ kcal, p, f, c })

/** Сумма нутриентов поверх пустой: перечисленные ключи известны, остальные
    остаются «нет данных» (known === 0) — ровно как у настоящего приёма. */
function totals(parts: Partial<Record<keyof NutrientTotals, { value: number; known: number; total: number }>>): NutrientTotals {
  return { ...emptyNutrientTotals(), ...parts } as NutrientTotals
}

function mealPayload(overrides: Partial<Extract<ExportPayload, { kind: 'meal' }>> = {}): Extract<ExportPayload, { kind: 'meal' }> {
  return {
    kind: 'meal',
    date: '2026-08-30',
    slot: 'lunch',
    title: 'Лосось с киноа',
    kbju: kbju(986, 62, 41, 88),
    nutrients: totals({
      fiber: { value: 12, known: 3, total: 3 },
      sodium: { value: 0, known: 3, total: 3 },
      vitK: { value: 40, known: 2, total: 3 }
    }),
    fraction: 0.5,
    ...overrides
  }
}

function mealEntry(overrides: Partial<MealLogEntry> = {}): MealLogEntry {
  return {
    slot: 'lunch',
    mealId: 'kasha',
    status: 'eaten',
    fraction: 1,
    kbju: kbju(400, 20, 10, 30),
    nutrients: totals({
      fiber: { value: 8, known: 2, total: 2 },
      sodium: { value: 0, known: 2, total: 2 },
      vitK: { value: 30, known: 1, total: 2 }
    }),
    title: 'Каша',
    loggedAt: '2026-08-30T09:00:00',
    ...overrides
  }
}

function dayPayload(meals: MealLogEntry[], total: Kbju, nutrients?: NutrientTotals): Extract<ExportPayload, { kind: 'day' }> {
  return {
    kind: 'day',
    date: '2026-08-30',
    meals,
    total,
    nutrients: nutrients ?? totals({
      fiber: { value: 20, known: 4, total: 4 },
      sodium: { value: 0, known: 4, total: 4 },
      vitK: { value: 30, known: 1, total: 4 }
    })
  }
}

/** Восстанавливает заглушку navigator/window/document/location между тестами. */
function resetGlobals(): void {
  delete (globalThis as Record<string, unknown>).navigator
  delete (globalThis as Record<string, unknown>).location
  delete (globalThis as Record<string, unknown>).window
  delete (globalThis as Record<string, unknown>).document
}

// ---- format.ts: текст приёма -----------------------------------------------

function mealClipboardTextChecks(): void {
  const full = mealClipboardText(mealPayload({ fraction: 1 }))
  assert(full.includes('30.08'), `текст должен содержать дату, получено:\n${full}`)
  assert(full.includes('Лосось с киноа'), `текст должен содержать название, получено:\n${full}`)
  assert(full.includes('986'), 'должен быть kcal')
  assert(full.includes('62'), 'должен быть protein')
  assert(full.includes('41'), 'должен быть fat')
  assert(full.includes('88'), 'должен быть carbs')
  assert(!full.includes('съедено'), 'полный приём (fraction=1) не печатает строку доли')

  // Съедена половина — в буфер обязаны уйти ПОЛОВИННЫЕ числа, как на экране,
  // в CSV и в Health. Полный приём здесь означал бы, что буфер врёт вдвое.
  const half = mealClipboardText(mealPayload({ fraction: 0.5 }))
  assert(half.includes('1/2'), `доля 0.5 должна печататься как «1/2», получено:\n${half}`)
  assert(half.includes('493'), `при доле 1/2 должно быть 493 ккал, получено:\n${half}`)
  assert(half.includes('31'), `при доле 1/2 должно быть 31 г белка, получено:\n${half}`)
  assert(half.includes('44'), `при доле 1/2 должно быть 44 г углеводов, получено:\n${half}`)
  assert(!half.includes('986'), `при доле 1/2 полное число ккал печатать нельзя:\n${half}`)

  group('mealClipboardText: дата, название, числа с учётом доли, доля печатается')
}

function dayClipboardTextChecks(): void {
  const meals = [
    mealEntry({ slot: 'breakfast', title: 'Омлет', kbju: kbju(320, 20, 24, 4), fraction: 1 }),
    mealEntry({ slot: 'lunch', title: 'Лосось с киноа', kbju: kbju(986, 62, 41, 88), fraction: 0.5 })
  ]
  const total = kbju(320 + 493, 20 + 31, 24 + 20.5, 4 + 44)
  const text = dayClipboardText(dayPayload(meals, total))
  assert(text.includes('30.08'), 'день должен содержать дату')
  assert(text.includes('Омлет') && text.includes('Лосось с киноа'), 'строки по каждому приёму')
  assert(text.includes('1/2'), 'доля второго приёма видна')
  assert(text.includes('Итого'), 'есть строка итога')
  group('dayClipboardText: строки по приёмам в порядке слотов и итог')
}

// ---- format.ts: CSV ----------------------------------------------------------

function csvChecks(): void {
  const meals = [
    mealEntry({ slot: 'breakfast', title: 'Каша, овсяная', kbju: kbju(300, 10, 5, 40), fraction: 1 }),
    mealEntry({ slot: 'lunch', title: 'Салат "Цезарь"', kbju: kbju(500.4, 20.25, 15.5, 30.1), fraction: 0.5 })
  ]
  const csv = buildDayCsv(dayPayload(meals, kbju(550.2, 20, 12.75, 55)))

  assert(csv.charCodeAt(0) === 0xfeff, 'файл должен начинаться с BOM (U+FEFF)')
  const body = csv.slice(1)
  const lines = body.split('\r\n')
  // заголовок вырос ровно на колонки нутриентов и колонку неполноты; прежние
  // девять колонок остались на своих местах и в прежнем порядке
  assert(lines[0].startsWith('date,slot,title,kcal,protein,fat,carbs,fraction,status,'), `неверное начало заголовка: ${lines[0]}`)
  assert(lines[0] === CSV_HEADER, `заголовок должен совпадать с CSV_HEADER: ${lines[0]}`)
  // Колонки нутриентов идут строго от списка ключей, а не от отдельного
  // перечня: тест сверяется с NUTRIENT_KEYS, а не с числом, которое устареет
  // при следующем расширении списка нутриентов.
  assert(CSV_NUTRIENT_COLUMNS.length === NUTRIENT_KEYS.length,
    `колонок нутриентов ожидалось ${NUTRIENT_KEYS.length} (по числу NUTRIENT_KEYS), получено ${CSV_NUTRIENT_COLUMNS.length}`)
  assert(lines[0].split(',').length === 9 + NUTRIENT_KEYS.length + 1,
    `колонок ожидалось ${9 + NUTRIENT_KEYS.length + 1}, получено ${lines[0].split(',').length}`)
  assert(lines.length === meals.length + 1, `строк ожидалось ${meals.length + 1} (заголовок + записи), получено ${lines.length}`)
  assert(body.includes('\r\n') && !body.replace(/\r\n/g, '').includes('\n'), 'перевод строки должен быть CRLF, а не голым LF')

  assert(lines[1].includes('"Каша, овсяная"'), `поле с запятой должно быть в кавычках: ${lines[1]}`)
  assert(lines[2].includes('"Салат ""Цезарь"""'), `поле с кавычкой должно экранироваться удвоением: ${lines[2]}`)
  assert(lines[2].includes('250.2'), `десятичное число должно быть с точкой (500.4*0.5=250.2): ${lines[2]}`)

  group('buildDayCsv: заголовок, число строк, CRLF, BOM, экранирование запятой и кавычки, точка в десятичных')
}

// ---- format.ts: formatNutrientAmount — три значащие цифры, честный ноль ------

function formatNutrientAmountChecks(): void {
  assert(formatNutrientAmount(0) === '0', `0 должен печататься как «0», получено «${formatNutrientAmount(0)}»`)
  assert(formatNutrientAmount(0.0004) === '< 0.001',
    `0.0004 (меньше 0.0005) должен печататься как «< 0.001», получено «${formatNutrientAmount(0.0004)}»`)
  assert(formatNutrientAmount(0) !== formatNutrientAmount(0.0004),
    'ноль и «слишком мало, чтобы увидеть» обязаны различаться')
  assert(formatNutrientAmount(0.1234) === '0.123', `0.1234 → «0.123», получено «${formatNutrientAmount(0.1234)}»`)
  assert(formatNutrientAmount(0.01234) === '0.012', `0.01234 → «0.012» (не больше трёх дробных знаков), получено «${formatNutrientAmount(0.01234)}»`)
  assert(formatNutrientAmount(0.9996) === '1.00', `0.9996 → «1.00» (округлилось до единицы — разрядность по округлённому), получено «${formatNutrientAmount(0.9996)}»`)
  assert(formatNutrientAmount(1.234) === '1.23', `1.234 → «1.23», получено «${formatNutrientAmount(1.234)}»`)
  assert(formatNutrientAmount(12.34) === '12.3', `12.34 → «12.3», получено «${formatNutrientAmount(12.34)}»`)
  assert(formatNutrientAmount(99.99) === '100', `99.99 → «100» (не «100.0»), получено «${formatNutrientAmount(99.99)}»`)
  assert(formatNutrientAmount(100.4) === '100', `100.4 → «100» (не «100.4»/«101»), получено «${formatNutrientAmount(100.4)}»`)
  assert(formatNutrientAmount(1234) === '1234', `1234 → «1234» (целое не режется до трёх значащих цифр), получено «${formatNutrientAmount(1234)}»`)
  group('formatNutrientAmount: 0, «< 0.001», три значащие цифры, разрядность не прыгает на границе сотни')
}

// ---- clipboard.ts ------------------------------------------------------------

async function clipboardChecks(): Promise<void> {
  resetGlobals()
  const noClip = clipboardChannel()
  const availNo = noClip.availability()
  assert(availNo.available === false && !!availNo.reason, 'без navigator.clipboard.writeText канал недоступен с причиной')

  let written: string | undefined
  ;(globalThis as Record<string, unknown>).navigator = {
    clipboard: { writeText: async (t: string) => { written = t } }
  }
  const ok = clipboardChannel()
  assert(ok.availability().available === true, 'с navigator.clipboard.writeText канал доступен')
  const res = await ok.send(mealPayload())
  assert(res.ok === true, `send должен подтвердить успех после await, получено ${JSON.stringify(res)}`)
  assert(!!written && written.includes('Лосось с киноа'), 'в буфер должен был уйти правильный текст')

  ;(globalThis as Record<string, unknown>).navigator = {
    clipboard: { writeText: async () => { throw new Error('Доступ запрещён') } }
  }
  const failing = clipboardChannel()
  const failRes = await failing.send(mealPayload())
  assert(failRes.ok === false && failRes.error.length > 0, `отказ буфера должен вернуть ok:false с текстом ошибки, получено ${JSON.stringify(failRes)}`)

  resetGlobals()
  group('clipboardChannel: availability по navigator.clipboard, send подтверждает только после успешного await, отказ — ok:false')
}

// ---- csv.ts channel ------------------------------------------------------------

async function csvChannelChecks(): Promise<void> {
  resetGlobals()
  const channel = csvChannel()
  assert(channel.availability().available === true, 'CSV-канал всегда доступен (в худшем случае — текст на экране)')

  const notDay = await channel.send(mealPayload())
  assert(notDay.ok === false && notDay.error === CSV_NOT_A_DAY_ERROR, 'CSV на payload вида meal должен честно отказать')

  const day = dayPayload([mealEntry()], kbju(400, 20, 10, 30))
  const noShare = await channel.send(day)
  assert(noShare.ok === true && noShare.note === CSV_FALLBACK_NOTE,
    `без navigator.share — фолбэк на текст, получено ${JSON.stringify(noShare)}`)

  resetGlobals()
  group('csvChannel: недоступен только для payload не «день», без file-share честно отдаёт текстовый фолбэк')
}

// ---- health-shortcut.ts --------------------------------------------------------

function healthAvailabilityChecks(): void {
  resetGlobals()
  const notIos = healthShortcutChannel(() => 'МояКоманда', 'https://eda.example/')
  const a1 = notIos.availability()
  assert(a1.available === false && !!a1.reason, 'без iOS navigator канал недоступен с причиной')

  ;(globalThis as Record<string, unknown>).navigator = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', maxTouchPoints: 5 }
  const emptyName = healthShortcutChannel(() => '', 'https://eda.example/')
  const a2 = emptyName.availability()
  assert(a2.available === false && !!a2.reason, 'на iOS, но с пустым именем команды канал недоступен с причиной')

  const ready = healthShortcutChannel(() => 'МояКоманда', 'https://eda.example/')
  const a3 = ready.availability()
  assert(a3.available === true, 'на iOS с заданным именем команды канал доступен')

  resetGlobals()
  group('healthShortcutChannel.availability: не-iOS и пустое имя команды дают available:false с причиной')
}

function healthLinkChecks(): void {
  const payload = mealPayload({ fraction: 1, kbju: kbju(986, 62.1, 41.3, 88.4) })
  const now = new Date(2026, 7, 30, 13, 5, 0) // 30.08.2026 13:05:00, месяцы с 0
  const url = buildShortcutUrl('МояКоманда', payload, now, 'https://eda.example/')

  assert(url.startsWith('shortcuts://x-callback-url/run-shortcut?'), `ссылка должна запускать x-callback-url, получено: ${url}`)
  assert(url.includes('name=%D0%9C%D0%BE%D1%8F%D0%9A%D0%BE%D0%BC%D0%B0%D0%BD%D0%B4%D0%B0'), 'имя команды закодировано через encodeURIComponent')
  assert(url.includes('input=text'), 'input должен быть text')

  const params = new URLSearchParams(url.slice(url.indexOf('?') + 1))
  const text = params.get('text')
  assert(!!text, 'параметр text обязан присутствовать')
  const decoded = JSON.parse(decodeURIComponent(text!))
  assert(decoded.kcal === 986, `kcal ожидался 986, получено ${decoded.kcal}`)
  assert(decoded.protein === 62.1, `protein ожидался 62.1, получено ${decoded.protein}`)
  assert(decoded.fat === 41.3, `fat ожидался 41.3, получено ${decoded.fat}`)
  assert(decoded.carbs === 88.4, `carbs ожидался 88.4, получено ${decoded.carbs}`)
  assert(decoded.date === '2026-08-30T13:05:00', `date ожидалась 2026-08-30T13:05:00, получено ${decoded.date}`)

  const success = params.get('x-success')
  assert(!!success && success.startsWith('https://eda.example/?exported='), `x-success должен указывать назад на приложение, получено ${success}`)

  group('buildShortcutUrl: JSON корректно закодирован в text и восстанавливается теми же числами, x-success ведёт назад в приложение')
}

function readCallbackChecks(): void {
  assert(readCallback('?exported=abc123') === 'abc123', 'должен извлекать id из query-строки')
  assert(readCallback('?exported=abc123&other=1') === 'abc123', 'извлекает id среди прочих параметров')
  assert(readCallback('') === null, 'пустая строка запроса — null')
  assert(readCallback('?other=1') === null, 'параметр exported отсутствует — null')
  group('readCallback: достаёт id операции из query-строки возврата, null при отсутствии')
}

// ---- реестр и честный выбор канала ---------------------------------------------

function buildChannelsChecks(): void {
  const channels = buildChannels({ getShortcutName: () => '', appUrl: 'https://eda.example/' })
  assert(channels.map(c => c.id).join(',') === 'clipboard,csv,health-shortcut',
    `порядок каналов ожидался буфер,CSV,Health, получено ${channels.map(c => c.id).join(',')}`)
  group('buildChannels: порядок показа — буфер, CSV, Health')
}

// ---- пропущенный приём: ни один канал ничего не отправляет --------------------

function skippedMealAvailabilityChecks(): void {
  resetGlobals()
  // Готовое устройство: буфер обмена есть, телефон — iOS с заданной командой.
  // Если бы это было причиной отказа, тест бы это не проверял — здесь важно,
  // что отказывают ИМЕННО из-за пропущенного приёма, при остальном исправном.
  ;(globalThis as Record<string, unknown>).navigator = {
    clipboard: { writeText: async () => {} },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    maxTouchPoints: 5
  }
  const channels = buildChannels({ getShortcutName: () => 'МояКоманда', appUrl: 'https://eda.example/' })
  const skipped = mealPayload({ fraction: 0 })

  for (const channel of channels) {
    const avail = channel.availability(skipped)
    assert(avail.available === false && avail.reason === SKIPPED_MEAL_REASON,
      `канал «${channel.id}» обязан отказать на пропущенном приёме с причиной «${SKIPPED_MEAL_REASON}», получено ${JSON.stringify(avail)}`)
  }

  // тот же payload, но съеденный (доля 1) — каждый канал доступен так же, как
  // если бы проверки пропуска не было вовсе
  const eaten = mealPayload({ fraction: 1 })
  for (const channel of channels) {
    const withGuard = channel.availability(eaten)
    const withoutGuard = channel.availability()
    assert(withGuard.available === withoutGuard.available,
      `канал «${channel.id}» на съеденном приёме не должен отличаться от собственной доступности, получено ${JSON.stringify(withGuard)} vs ${JSON.stringify(withoutGuard)}`)
  }

  // и sendViaChannel не должен звать send() у канала на пропущенном приёме
  resetGlobals()
  group('buildChannels: пропущенный приём (fraction 0) — все три канала available:false с одной причиной; съеденный — как обычно')
}

async function skippedMealSendChecks(): Promise<void> {
  const channels = buildChannels({ getShortcutName: () => 'МояКоманда', appUrl: 'https://eda.example/' })
  const skipped = mealPayload({ fraction: 0 })
  for (const channel of channels) {
    const result = await sendViaChannel(channel, skipped)
    assert(result.ok === false && result.error === SKIPPED_MEAL_REASON,
      `sendViaChannel(«${channel.id}», пропущенный приём) должен вернуть ok:false с причиной пропуска, получено ${JSON.stringify(result)}`)
  }
  group('sendViaChannel: пропущенный приём не уходит ни в один канал, даже если канал сам по себе доступен')
}

async function sendViaChannelChecks(): Promise<void> {
  let sendCalled = false
  const deadChannel: ExportChannel = {
    id: 'dead',
    title: 'Мёртвый канал',
    availability: () => ({ available: false, reason: 'Тестовая причина недоступности' }),
    send: async () => { sendCalled = true; return { ok: true } }
  }
  const result = await sendViaChannel(deadChannel, mealPayload())
  assert(sendCalled === false, 'sendViaChannel не должен звать send() у канала, объявившего себя недоступным')
  assert(result.ok === false && result.error === 'Тестовая причина недоступности',
    `sendViaChannel должен вернуть причину недоступности как ошибку, получено ${JSON.stringify(result)}`)

  let liveSendCalled = false
  const liveChannel: ExportChannel = {
    id: 'live',
    title: 'Живой канал',
    availability: () => ({ available: true }),
    send: async () => { liveSendCalled = true; return { ok: true } }
  }
  const liveResult = await sendViaChannel(liveChannel, mealPayload())
  assert(liveSendCalled === true, 'доступный канал обязан получить вызов send')
  assert(liveResult.ok === true, 'результат доступного канала должен дойти без изменений')

  group('sendViaChannel: недоступный канал не получает вызова send, доступный — получает')
}


// ---- CSV: пустая ячейка (нет данных) против честного нуля --------------------

function csvNutrientCellsChecks(): void {
  const entry = mealEntry({
    slot: 'breakfast',
    title: 'Каша',
    fraction: 1,
    kbju: kbju(300, 10, 5, 40),
    nutrients: totals({
      fiber: { value: 8, known: 2, total: 2 },
      sodium: { value: 0, known: 2, total: 2 },
      vitK: { value: 30, known: 1, total: 2 }
    })
  })
  const csv = buildDayCsv(dayPayload([entry], kbju(300, 10, 5, 40)))
  const lines = csv.slice(1).split('\r\n')
  const columns = lines[0].split(',')
  const row = lines[1].split(',')
  const cell = (name: string): string => row[columns.indexOf(name)]

  assert(columns.includes('fiber_g') && columns.includes('calcium_mg') && columns.includes('vitK_ug'),
    `имена колонок должны нести единицу измерения: ${lines[0]}`)

  assert(cell('fiber_g') === '8.00', `известное значение печатается числом, получено «${cell('fiber_g')}»`)
  // честный ноль — это 0, а не пустая ячейка
  assert(cell('sodium_mg') === '0', `честный ноль обязан печататься нулём, получено «${cell('sodium_mg')}»`)
  // «нет данных» — пустая ячейка, и она отличается от нуля
  assert(cell('vitB12_ug') === '', `нутриент без данных обязан быть пустой ячейкой, получено «${cell('vitB12_ug')}»`)
  assert(cell('sodium_mg') !== cell('vitB12_ug'), 'честный ноль и «нет данных» обязаны различаться в CSV')

  // неполный нутриент назван в отдельной колонке: число есть, но оно занижено
  assert(cell('vitK_ug') === '30.0', `неполное значение всё же печатается, получено «${cell('vitK_ug')}»`)
  assert(cell('incomplete').includes('vitK'), `неполнота обязана быть названа, получено «${cell('incomplete')}»`)

  group('buildDayCsv: колонка на каждый нутриент, пустая ячейка = нет данных, честный ноль = 0, неполные названы')
}

// ---- CSV: колонка на каждый NUTRIENT_KEYS, новый нутриент без данных -------

function csvColumnsMatchNutrientKeysChecks(): void {
  // Ровно одна колонка на ключ, без второго источника правды: список колонок
  // строится из NUTRIENT_KEYS, а не хранится отдельно.
  const suffixByKey: Record<string, string> = { 'г': 'g', 'мг': 'mg', 'мкг': 'ug' }
  const expectedColumns = NUTRIENT_KEYS.map(key => `${key}_${suffixByKey[NUTRIENT_UNIT[key]]}`)
  assert(CSV_NUTRIENT_COLUMNS.length === NUTRIENT_KEYS.length,
    `колонок нутриентов должно быть ровно ${NUTRIENT_KEYS.length} (по числу ключей), получено ${CSV_NUTRIENT_COLUMNS.length}`)
  assert(expectedColumns.every((c, i) => CSV_NUTRIENT_COLUMNS[i] === c),
    `колонки должны идти в порядке и составе NUTRIENT_KEYS, получено ${CSV_NUTRIENT_COLUMNS.join(',')}`)

  // Новый нутриент (холин), по которому нет ни одной позиции со знанием —
  // «нет данных» в CSV, то есть пустая ячейка, а не 0.
  const entry = mealEntry({
    slot: 'breakfast',
    title: 'Каша',
    fraction: 1,
    kbju: kbju(300, 10, 5, 40),
    nutrients: totals({
      fiber: { value: 8, known: 2, total: 2 }
      // choline, epa, dha, каротиноиды и т.д. намеренно не заданы — known остаётся 0
    })
  })
  const csv = buildDayCsv(dayPayload([entry], kbju(300, 10, 5, 40)))
  const lines = csv.slice(1).split('\r\n')
  const columns = lines[0].split(',')
  const row = lines[1].split(',')
  const cell = (name: string): string => row[columns.indexOf(name)]

  for (const key of ['choline_mg', 'epa_g', 'dha_g', 'betaCarotene_ug', 'lycopene_ug']) {
    assert(cell(key) === '', `новый нутриент без данных должен быть пустой ячейкой (нет данных), получено «${cell(key)}» для ${key}`)
  }

  group('buildDayCsv: колонки строго от NUTRIENT_KEYS, новый нутриент без данных — пустая ячейка')
}

// ---- буфер обмена: «нет данных» вместо нуля ---------------------------------

function clipboardNutrientsChecks(): void {
  const text = mealClipboardText(mealPayload({ fraction: 1 }))
  assert(text.includes('Клетчатка'), `в тексте приёма должны быть нутриенты, получено:\n${text}`)
  assert(text.includes('12.0 г') || text.includes('12.00 г'), `клетчатка печатается с единицей, получено:\n${text}`)
  assert(text.includes(`Витамин B12: ${NO_DATA_TEXT}`), `неизвестный нутриент печатается словами «${NO_DATA_TEXT}», получено:\n${text}`)
  assert(!text.includes('Витамин B12: 0'), 'неизвестный нутриент нельзя печатать нулём')
  assert(text.includes('Натрий: 0 мг'), `честный ноль печатается нулём, получено:\n${text}`)
  assert(/Витамин K: 40[.,]?\d* мкг \(известно по 2 из 3 позиций\)/.test(text),
    `неполный нутриент печатается с пометкой полноты, получено:\n${text}`)

  // доля применяется и к нутриентам — ровно как к КБЖУ
  const half = mealClipboardText(mealPayload({ fraction: 0.5 }))
  assert(half.includes('Клетчатка: 6.00 г'), `при доле 1/2 клетчатка должна быть 6.00 г, получено:\n${half}`)
  assert(half.includes('Витамин K: 20.0 мкг (известно по 2 из 3 позиций)'),
    `доля меняет число, но не полноту, получено:\n${half}`)

  const day = dayClipboardText(dayPayload([mealEntry()], kbju(400, 20, 10, 30)))
  assert(day.includes('Нутриенты за день'), `в тексте дня должен быть блок нутриентов, получено:\n${day}`)
  assert(day.includes(`Витамин B12: ${NO_DATA_TEXT}`), 'в дне неизвестный нутриент тоже «нет данных»')

  group('буфер обмена: нутриенты с единицами, «нет данных» вместо нуля, доля не меняет полноту')
}

// ---- Health: в словарь не попадает то, чего не знаем -------------------------

function healthNutrientsChecks(): void {
  const payload = mealPayload({ fraction: 1 })
  const dict = healthNutrients(payload)

  assert(dict.fiber === 12, `известный нутриент обязан попасть в словарь, получено ${dict.fiber}`)
  assert(dict.sodium === 0, 'честный ноль — это знание, он попадает в словарь как 0')
  assert('sodium' in dict, 'ключ честного нуля обязан присутствовать в словаре')
  assert(dict.vitK === 40, 'частично известный нутриент отправляется: он посчитан по реальным позициям')
  assert(!('vitB12' in dict), 'нутриент, о котором данных нет, в словарь Health попадать НЕ должен')
  const unknownKeys = NUTRIENT_KEYS.filter(k => payload.nutrients[k].known === 0)
  assert(unknownKeys.every(k => !(k in dict)), `в словарь просочились нутриенты без данных: ${unknownKeys.filter(k => k in dict).join(', ')}`)

  // доля применяется к нутриентам ровно так же, как к КБЖУ
  const halfDict = healthNutrients(mealPayload({ fraction: 0.5 }))
  assert(halfDict.fiber === 6, `при доле 1/2 клетчатка ожидалась 6, получено ${halfDict.fiber}`)

  // и то же самое в самой ссылке запуска команды
  const url = buildShortcutUrl('МояКоманда', payload, new Date(2026, 7, 30, 13, 5, 0), 'https://eda.example/')
  const params = new URLSearchParams(url.slice(url.indexOf('?') + 1))
  const decoded = JSON.parse(decodeURIComponent(params.get('text')!))
  assert(decoded.kcal === 986 && decoded.protein === 62, 'макросы в ссылке остались на месте')
  assert(decoded.fiber === 12 && decoded.sodium === 0, 'известные нутриенты уходят в Health')
  assert(!('vitB12' in decoded), 'нутриент без данных не должен попадать в JSON для Команд')

  group('healthNutrients: известные (включая честный ноль) уходят в Health, «нет данных» не отправляется вовсе')
}

// ---- Health: нутриенты без типа в HealthKit не отправляются НИКОГДА, даже известные ----

function healthNoTypeNutrientsChecks(): void {
  // Фиксация решения, а не догадка: у HealthKit нет отдельного quantity-типа
  // для этих одиннадцати нутриентов — они не должны попадать в Health, даже
  // если для них есть полное знание (known === total).
  const expectedNoType: string[] = [
    'linoleic', 'ala', 'epa', 'dha', 'retinol', 'choline',
    'betaCarotene', 'alphaCarotene', 'betaCryptoxanthin', 'lycopene', 'luteinZeaxanthin'
  ]
  assert(NO_HEALTHKIT_TYPE.length === expectedNoType.length
    && expectedNoType.every(k => NO_HEALTHKIT_TYPE.includes(k as typeof NO_HEALTHKIT_TYPE[number])),
    `набор нутриентов без типа в HealthKit разошёлся с ожидаемым, получено: ${NO_HEALTHKIT_TYPE.join(', ')}`)

  const fullKnowledge = { value: 5, known: 1, total: 1 }
  const payload = mealPayload({
    fraction: 1,
    nutrients: totals(Object.fromEntries(NUTRIENT_KEYS.map(k => [k, fullKnowledge])) as Partial<Record<keyof NutrientTotals, { value: number; known: number; total: number }>>)
  })
  const dict = healthNutrients(payload)

  assert(NO_HEALTHKIT_TYPE.every(k => !(k in dict)),
    `в Health не должны попадать нутриенты без HealthKit-типа, даже известные, просочились: ${NO_HEALTHKIT_TYPE.filter(k => k in dict).join(', ')}`)

  // dict — строгое подмножество NUTRIENT_KEYS (никаких посторонних ключей)
  const dictKeys = Object.keys(dict)
  assert(dictKeys.every(k => (NUTRIENT_KEYS as readonly string[]).includes(k)),
    `в словарь Health попал ключ вне NUTRIENT_KEYS: ${dictKeys.filter(k => !(NUTRIENT_KEYS as readonly string[]).includes(k)).join(', ')}`)

  // а нутриенты С типом в HealthKit при полном знании обязаны отправиться
  const someWithType = NUTRIENT_KEYS.filter(k => !NO_HEALTHKIT_TYPE.includes(k))
  assert(someWithType.every(k => k in dict),
    `нутриент с типом в HealthKit и полным знанием обязан уйти в словарь, отсутствуют: ${someWithType.filter(k => !(k in dict)).join(', ')}`)

  group('healthNutrients: подмножество NUTRIENT_KEYS без ключей из NO_HEALTHKIT_TYPE, даже при полном знании')
}

async function main(): Promise<void> {
  console.log('Export — clipboard/CSV/Health каналы, форматирование, реестр')
  formatNutrientAmountChecks()
  mealClipboardTextChecks()
  dayClipboardTextChecks()
  csvChecks()
  csvNutrientCellsChecks()
  csvColumnsMatchNutrientKeysChecks()
  clipboardNutrientsChecks()
  healthNutrientsChecks()
  healthNoTypeNutrientsChecks()
  await clipboardChecks()
  await csvChannelChecks()
  healthAvailabilityChecks()
  healthLinkChecks()
  readCallbackChecks()
  buildChannelsChecks()
  await sendViaChannelChecks()
  skippedMealAvailabilityChecks()
  await skippedMealSendChecks()
  console.log(`\nВсе проверки экспорта пройдены (${passed} групп).`)
}

main().catch(e => {
  console.error('\n✗ ТЕСТ ЭКСПОРТА УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
})
