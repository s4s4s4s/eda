/* Консольная проверка меню: разбирает data/products.yaml и data/menu.yaml и
   гоняет их через checkMenu() из src/core/rules.ts. Вся логика правил живёт
   там — этот файл только читает файлы с диска, вызывает готовые функции и
   печатает отчёт по всем восьми дням цикла.

   Два класса проблем и два разных кода возврата:

   1. РАЗБОР ДАННЫХ (кривой YAML, ссылка на несуществующий продукт, дубль
      приёма, отсутствующая мера граммов/штук/ложек) — это поломка файла:
      меню физически не готово к использованию, повар не сможет закупиться
      по нему. Такая ошибка ВСЕГДА даёт код 1, даже с флагом --warn-only.

   2. НАРУШЕНИЯ ПРАВИЛ (день легче нормы, порция не той величины и т. п.) —
      меню разбирается и физически годно к готовке, но не дотягивает до
      целевых чисел. Это то, что можно сознательно занести в непрерывную
      сборку с флагом --warn-only: неидеальное по калориям меню не должно
      снимать с телефона уже работающее приложение, а вот меню со сломанной
      ссылкой на продукт — обязано валить сборку всегда.

   Запуск (через package.json): npm run check-menu [-- --warn-only]
*/

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { parseMenu, parseProducts } from '../src/core/data'
import { dayKbju, mealKbju } from '../src/core/nutrition'
import { checkEdition } from '../src/core/rules'
import { SLOT_TITLE, SLOTS } from '../src/core/types'
import type { Kbju, Menu, MenuDay, ProductIndex, Violation } from '../src/core/types'

/** Ищет корень репозитория вверх от cwd — npm run обычно уже ставит cwd в
    корень пакета, но полагаться на это молча нельзя: npm run может быть
    вызван из любого подкаталога через workspaces/скрипты, поэтому корень
    ищем явно по маркерам package.json + data/, а не берём cwd как есть. */
function findRepoRoot(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 12; i++) {
    if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'data'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`Не удалось найти корень репозитория (package.json + data/) вверх от ${startDir}`)
}

function fail(message: string): never {
  console.error(`Ошибка: ${message}`)
  process.exit(1)
  throw new Error(message) // недостижимо: process.exit завершает процесс раньше
}

function fmtKcal(n: number): string {
  return String(Math.round(n))
}

function fmt1(n: number): string {
  return n.toFixed(1)
}

function padL(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s
}

function padR(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

function fmtKbjuLine(kbju: Kbju): string {
  return `${padL(fmtKcal(kbju.kcal), 5)} ккал   Б ${padL(fmt1(kbju.p), 6)}   Ж ${padL(fmt1(kbju.f), 6)}   У ${padL(fmt1(kbju.c), 6)}`
}

function printDay(day: MenuDay, products: ProductIndex, dayViolations: Violation[]): void {
  const total = dayKbju(day, products)
  const corridorBroken = dayViolations.some(v => v.rule === 'day.kcal.low' || v.rule === 'day.kcal.high')

  console.log(`День ${day.day}`)
  const bySlot = new Map(day.meals.map(m => [m.slot, m]))
  for (const slot of SLOTS) {
    const meal = bySlot.get(slot)
    if (!meal) continue
    const kbju = mealKbju(meal, products)
    console.log(`  ${padR(SLOT_TITLE[slot] + ':', 11)} ${padL(fmtKcal(kbju.kcal), 5)} ккал`)
  }
  console.log(`  ${padR('Итого дня:', 11)} ${fmtKbjuLine(total)}`)
  console.log(`  Коридор: ${corridorBroken ? 'НЕ ПОПАЛ' : 'в норме'}`)
  console.log('')
}

/* Нарушения одной редакции печатаются двумя списками, и это не косметика.
   Правило, сработавшее больше чем в половине дней редакции, — не поломка
   данных, а другой замысел: диетолог прислал неделю, построенную иначе, и
   пятьдесят одинаковых строк про крупу 80 г вместо 130 не сообщают ничего
   сверх одной. Правило, сработавшее в одном-двух днях на фоне остальных, —
   ровно наоборот, кандидат в опечатку, и его надо видеть поимённо. Ни одно
   нарушение при этом не пропадает: систематические свёрнуты со счётчиком,
   а общий итог считается по всем. */
function printViolations(violations: Violation[], daysInEdition: number): void {
  const byRule = new Map<string, { days: Set<number>; items: Violation[] }>()
  for (const v of violations) {
    const entry = byRule.get(v.rule) ?? { days: new Set<number>(), items: [] }
    entry.days.add(v.scope.day)
    entry.items.push(v)
    byRule.set(v.rule, entry)
  }

  const systematic: { rule: string; days: number; items: Violation[] }[] = []
  const singular: Violation[] = []
  for (const [rule, entry] of byRule) {
    if (entry.days.size * 2 > daysInEdition) {
      systematic.push({ rule, days: entry.days.size, items: entry.items })
    } else {
      singular.push(...entry.items)
    }
  }
  singular.sort((a, b) => a.scope.day - b.scope.day)

  if (systematic.length > 0) {
    const total = systematic.reduce((acc, s) => acc + s.items.length, 0)
    console.log(`  Так устроена вся редакция — не опечатка, а другой замысел (${total}):`)
    for (const s of systematic) {
      console.log(`    - ${s.rule}: ${s.days} дн. из ${daysInEdition}, например «${s.items[0].message}»`)
    }
  }
  if (singular.length > 0) {
    console.log(`  Выбивается из редакции — проверить (${singular.length}):`)
    for (const v of singular) {
      console.log(`    - ${v.message}`)
    }
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const warnOnly = args.includes('--warn-only')

  const repoRoot = findRepoRoot(process.cwd())
  const productsPath = path.join(repoRoot, 'data', 'products.yaml')
  const menuPath = path.join(repoRoot, 'data', 'menu.yaml')

  if (!existsSync(productsPath)) fail(`не найден файл ${productsPath}`)
  if (!existsSync(menuPath)) fail(`не найден файл ${menuPath}`)

  let products: ProductIndex
  let menu: Menu
  try {
    products = parseProducts(readFileSync(productsPath, 'utf8'))
    menu = parseMenu(readFileSync(menuPath, 'utf8'), products)
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }

  /* Печатаем и считаем по редакциям, а не по номерам дней: день 4 есть в
     каждой присланной неделе, и свалить их в одну корзину значило бы приписать
     нарушения новой недели прежней. */
  let violations: Violation[] = []
  let daysChecked = 0
  for (const edition of menu.editions) {
    const editionViolations = checkEdition(edition, products)
    violations = violations.concat(editionViolations)
    daysChecked += edition.days.length

    const since = edition.from === undefined ? 'действовала с самого начала' : `действует с ${edition.from}`
    console.log('='.repeat(72))
    console.log(`РЕДАКЦИЯ: ${edition.title} (${since}); дней: ${edition.days.length} из ${menu.cycleDays}`)
    console.log('='.repeat(72))
    console.log('')

    const byDay = new Map<number, Violation[]>()
    for (const v of editionViolations) {
      const list = byDay.get(v.scope.day) ?? []
      list.push(v)
      byDay.set(v.scope.day, list)
    }
    for (const day of edition.days) {
      printDay(day, products, byDay.get(day.day) ?? [])
    }

    console.log(`Нарушений в редакции «${edition.title}»: ${editionViolations.length}`)
    printViolations(editionViolations, edition.days.length)
    console.log('')
  }

  const verdict = violations.length === 0 ? 'ЧИСТО' : `ЕСТЬ НАРУШЕНИЯ (${violations.length})`
  console.log(`Редакций проверено: ${menu.editions.length}`)
  console.log(`Дней проверено: ${daysChecked}`)
  console.log(`Нарушений: ${violations.length}`)
  console.log(`Вердикт: ${verdict}`)

  if (violations.length > 0 && !warnOnly) {
    process.exit(1)
  }
  process.exit(0)
}

main()
