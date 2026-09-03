/**
 * Тесты цикла готовки (src/core/cycle.ts): день цикла, партия готовки, текущий
 * приём по времени суток. Гоняются node-ом после сборки esbuild:
 * `npm run test:cycle`.
 */
import { batchDay, currentSlot, cycleDay, formatDateFull, todayLocal } from '../src/core/cycle'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}
function group(name: string): void { console.log(`  ok ${name}`); passed++ }

// ---- cycleDay ----------------------------------------------------------------

function cycleDayChecks(): void {
  const start = '2026-08-01'
  assert(cycleDay(start, '2026-08-01', 0, 8) === 1, '01.08 — день 1')
  assert(cycleDay(start, '2026-08-08', 0, 8) === 8, '08.08 — день 8')
  assert(cycleDay(start, '2026-08-09', 0, 8) === 1, '09.08 — снова день 1 (новый цикл)')
  assert(cycleDay(start, '2026-08-16', 0, 8) === 8, '16.08 — второй цикл, день 8')

  // дата раньше старта: цикл всё равно определён, без отрицательных дней
  assert(cycleDay(start, '2026-07-31', 0, 8) === 8, '31.07 (за день до старта) — день 8 предыдущего цикла')
  assert(cycleDay(start, '2026-07-25', 0, 8) === 2, '25.07 (за неделю до старта) — день 2 предыдущего цикла')
  assert(cycleDay(start, '2026-07-24', 0, 8) === 1, '24.07 (за 8 дней до старта) — день 1 предыдущего цикла')

  // сдвиг цикла shift
  assert(cycleDay(start, '2026-08-01', 1, 8) === 2, 'shift +1 сдвигает день цикла на 1 вперёд')
  assert(cycleDay(start, '2026-08-01', -1, 8) === 8, 'shift -1 от дня 1 уводит в день 8 предыдущего цикла')

  group('cycleDay: старт/конец цикла, переход в новый цикл, даты раньше старта, shift ±1')
}

// ---- batchDay ------------------------------------------------------------------

function batchDayChecks(): void {
  const expected: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 1, 6: 2, 7: 3, 8: 4 }
  for (const [day, batch] of Object.entries(expected)) {
    const got = batchDay(Number(day))
    assert(got === batch, `batchDay(${day}) ожидалось ${batch}, получено ${got}`)
  }
  group('batchDay: дни 1-4 и 5-8 дают одну и ту же партию 1-4')
}

// ---- currentSlot -----------------------------------------------------------------

function currentSlotChecks(): void {
  const cases: [number, string][] = [
    [4 * 60 + 59, 'snack'],   // 04:59 — ещё вчерашний перекус
    [5 * 60, 'breakfast'],    // 05:00 — завтрак начался
    [10 * 60 + 59, 'breakfast'],
    [11 * 60, 'lunch'],       // 11:00 — обед начался
    [15 * 60 + 59, 'lunch'],
    [16 * 60, 'dinner'],      // 16:00 — ужин начался
    [19 * 60 + 59, 'dinner'],
    [20 * 60, 'snack'],       // 20:00 — перекус начался
    [23 * 60 + 59, 'snack'],
    [0, 'snack'],             // полночь — ещё перекус
    [3 * 60, 'snack']         // 03:00 — ещё перекус
  ]
  for (const [minutes, expected] of cases) {
    const got = currentSlot(minutes)
    assert(got === expected, `currentSlot(${minutes}) ожидалось ${expected}, получено ${got}`)
  }
  group('currentSlot: границы 04:59/05:00, 10:59/11:00, 15:59/16:00, 19:59/20:00, 23:59/00:00/03:00')
}

// ---- todayLocal ---------------------------------------------------------------

function todayLocalChecks(): void {
  const d = new Date(2026, 7, 5, 23, 30, 0) // 05.08.2026, локальное время
  assert(todayLocal(d) === '2026-08-05', `todayLocal ожидалось 2026-08-05, получено ${todayLocal(d)}`)
  const d2 = new Date(2026, 0, 9, 0, 5, 0) // 09.01.2026, чуть за полночь
  assert(todayLocal(d2) === '2026-01-09', `todayLocal ожидалось 2026-01-09, получено ${todayLocal(d2)}`)
  group('todayLocal: локальная дата YYYY-MM-DD по локальным полям Date')
}

// ---- formatDateFull -------------------------------------------------------------

function formatDateFullChecks(): void {
  // семь дней подряд одной известной недели (проверено по календарю)
  const week: [string, string][] = [
    ['2026-08-31', 'понедельник, 31 августа'],
    ['2026-09-01', 'вторник, 1 сентября'],
    ['2026-09-02', 'среда, 2 сентября'],
    ['2026-09-03', 'четверг, 3 сентября'],
    ['2026-09-04', 'пятница, 4 сентября'],
    ['2026-09-05', 'суббота, 5 сентября'],
    ['2026-09-06', 'воскресенье, 6 сентября']
  ]
  for (const [iso, expected] of week) {
    const got = formatDateFull(iso)
    assert(got === expected, `formatDateFull(${iso}) ожидалось "${expected}", получено "${got}"`)
  }

  // первое и последнее число месяца, без ведущего нуля у дня
  assert(formatDateFull('2026-09-01') === 'вторник, 1 сентября', '1 сентября — без ведущего нуля')
  assert(formatDateFull('2026-09-30') === 'среда, 30 сентября', '30 сентября — последний день месяца')

  // граница года
  assert(formatDateFull('2026-12-31') === 'четверг, 31 декабря', '31 декабря 2026')
  assert(formatDateFull('2027-01-01') === 'пятница, 1 января', '1 января 2027, следующий день после 31.12')

  // високосный год, 29 февраля
  assert(formatDateFull('2028-02-29') === 'вторник, 29 февраля', '29 февраля 2028 (високосный год)')
  assert(formatDateFull('2028-03-01') === 'среда, 1 марта', '1 марта 2028, день после 29 февраля')

  group('formatDateFull: неделя подряд, границы месяца/года, високосное 29 февраля')
}

function main(): void {
  console.log('cycle — день цикла, партия готовки, текущий приём')
  cycleDayChecks()
  batchDayChecks()
  currentSlotChecks()
  todayLocalChecks()
  formatDateFullChecks()
  console.log(`\nВсе проверки cycle пройдены (${passed} групп).`)
}

try {
  main()
} catch (e) {
  console.error('\n✗ ТЕСТ CYCLE УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}
