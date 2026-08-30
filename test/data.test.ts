/**
 * Тесты парсера продуктов и меню (src/core/data.ts). Фикстуры — синтетический
 * YAML в коде теста, файлы data/*.yaml не читаем: это территория другого
 * агента и может ещё не существовать. Гоняются node-ом после сборки esbuild:
 * `npm run test:data`.
 */
import { parseMenu, parseProducts } from '../src/core/data'
import type { ProductIndex } from '../src/core/types'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}
function group(name: string): void { console.log(`  ok ${name}`); passed++ }

function assertThrows(fn: () => void, mustInclude: string[], label: string): void {
  try {
    fn()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    for (const part of mustInclude) {
      assert(msg.includes(part), `${label}: сообщение должно содержать «${part}», получено «${msg}»`)
    }
    group(label)
    return
  }
  throw new Error(`${label}: ожидалась ошибка, но парсер не упал`)
}

const PRODUCTS_YAML = `
source: "USDA FoodData Central, SR Legacy 2018-04"
products:
  salmon:
    name: лосось
    fdcId: 175167
    fdcDescription: "Fish, salmon, Atlantic, farmed, raw"
    tags: [fish]
    per100g: { kcal: 208, protein: 20.42, fat: 13.42, carbs: 0 }
    # honest zero: в датасете у лосося реально записан 0 клетчатки;
    # vitK отсутствует — строки в датасете нет
    micro100g: { fiber: 0, calcium: 9, vitD: 11.1, water: 64.89 }
  brazil-nut:
    name: бразильский орех
    fdcId: 170569
    fdcDescription: "Nuts, brazilnuts, dried, unblanched"
    tags: [nuts, brazil]
    pieceG: 5
    pieceSource: fdc
    per100g: { kcal: 659, protein: 14.32, fat: 67.1, carbs: 11.74 }
  flaxseed:
    name: семена льна
    fdcId: 169414
    fdcDescription: "Seeds, flaxseed"
    tags: [flax]
    tbspG: 10
    tbspSource: fdc
    per100g: { kcal: 534, protein: 18.29, fat: 42.16, carbs: 28.88 }
  oats:
    name: овсяные хлопья
    fdcId: 173904
    fdcDescription: "Cereals, oats, regular"
    tags: [grain]
    per100g: { kcal: 380, protein: 13.15, fat: 6.9, carbs: 67.7 }
`

function baseProducts(): ProductIndex {
  return parseProducts(PRODUCTS_YAML)
}

// ---- parseProducts: валидная фикстура ---------------------------------------

function parseProductsChecks(): void {
  const idx = baseProducts()
  assert(idx.size === 4, `ожидалось 4 продукта, получено ${idx.size}`)

  const salmon = idx.get('salmon')!
  assert(salmon.name === 'лосось' && salmon.fdcId === 175167, 'лосось: name/fdcId')
  assert(salmon.tags.includes('fish'), 'лосось: тег fish')
  assert(salmon.per100.kcal === 208 && salmon.per100.p === 20.42 && salmon.per100.f === 13.42 && salmon.per100.c === 0,
    `лосось: per100 переименован kcal/protein/fat/carbs -> kcal/p/f/c, получено ${JSON.stringify(salmon.per100)}`)

  const brazil = idx.get('brazil-nut')!
  assert(brazil.pieceG === 5, `бразильский орех: pieceG ожидалось 5, получено ${brazil.pieceG}`)
  assert(brazil.tags.includes('brazil') && brazil.tags.includes('nuts'), 'бразильский орех: теги nuts, brazil')

  const flax = idx.get('flaxseed')!
  assert(flax.tbspG === 10, `семена льна: tbspG ожидалось 10, получено ${flax.tbspG}`)

  group('parseProducts: валидная фикстура разбирается в ожидаемую структуру (переименование per100g->per100)')
}

// ---- substitute сохраняется --------------------------------------------------

function substituteChecks(): void {
  const yamlText = `
products:
  cottage-cheese:
    name: творог
    fdcId: 172182
    fdcDescription: "Cheese, cottage, lowfat, 2% milkfat"
    substitute: "русского творога в SR Legacy нет; заменён американским cottage cheese"
    tags: [tvorog]
    per100g: { kcal: 90, protein: 11.1, fat: 2, carbs: 4.3 }
`
  const idx = parseProducts(yamlText)
  const p = idx.get('cottage-cheese')!
  assert(p.substitute === 'русского творога в SR Legacy нет; заменён американским cottage cheese', 'substitute должен сохраняться как есть')
  group('parseProducts: поле substitute сохраняется в структуру')
}

// ---- валидное меню -------------------------------------------------------------

function validMenuYaml(): string {
  return `
cycleDays: 2
days:
  - day: 1
    meals:
      - slot: breakfast
        title: Овсянка с бразильским орехом
        steps: [Разогреть контейнер, Досыпать пакетик]
        items:
          - { product: oats, g: 90, where: container }
          - { product: brazil-nut, pieces: 2, where: packet }
          - { product: flaxseed, tbsp: 1, where: packet }
      - slot: lunch
        title: Лосось
        steps: []
        items:
          - { product: salmon, g: 170, where: container }
      - slot: dinner
        title: Лосось на ужин
        steps: []
        items:
          - { product: salmon, g: 150, where: container }
      - slot: snack
        title: Орехи
        steps: []
        items:
          - { product: brazil-nut, pieces: 2, where: packet }
  - day: 2
    meals:
      - slot: breakfast
        title: Овсянка
        steps: []
        items:
          - { product: oats, g: 90, where: container }
      - slot: lunch
        title: Лосось
        steps: []
        items:
          - { product: salmon, g: 170, where: container }
      - slot: dinner
        title: Лосось
        steps: []
        items:
          - { product: salmon, g: 170, where: container }
      - slot: snack
        title: Лён
        steps: []
        items:
          - { product: flaxseed, tbsp: 1, where: packet }
`
}

function parseMenuValidChecks(): void {
  const products = baseProducts()
  const menu = parseMenu(validMenuYaml(), products)
  assert(menu.cycleDays === 2, `cycleDays ожидалось 2, получено ${menu.cycleDays}`)
  assert(menu.days.length === 2, `дней ожидалось 2, получено ${menu.days.length}`)
  assert(menu.days[0].day === 1 && menu.days[1].day === 2, 'дни отсортированы по номеру')
  const breakfast = menu.days[0].meals.find(m => m.slot === 'breakfast')!
  assert(breakfast.items.length === 3, `в завтраке дня 1 ожидалось 3 позиции, получено ${breakfast.items.length}`)
  assert(breakfast.items[1].pieces === 2, 'позиция бразильского ореха задана в pieces')
  group('parseMenu: валидная фикстура разбирается в ожидаемую структуру')
}

// ---- кривые случаи --------------------------------------------------------------

function brokenMenuChecks(): void {
  const products = baseProducts()

  // 1. ссылка на несуществующий продукт
  assertThrows(() => parseMenu(`
cycleDays: 1
days:
  - day: 1
    meals:
      - slot: breakfast
        title: t
        steps: []
        items: [{ product: unicorn-meat, g: 100, where: container }]
      - slot: lunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - slot: dinner
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - slot: snack
        title: t
        steps: []
        items: [{ product: flaxseed, tbsp: 1, where: packet }]
`, products), ['День 1', 'unicorn-meat'], 'несуществующий продукт')

  // 2. два количества сразу
  assertThrows(() => parseMenu(dayWithItem({ product: 'salmon', g: 100, pieces: 1, where: 'container' }), products),
    ['День 1', 'Завтрак'], 'два количества сразу у позиции')

  // 3. ни одного количества
  assertThrows(() => parseMenu(dayWithItem({ product: 'salmon', where: 'container' }), products),
    ['День 1', 'Завтрак'], 'ни одного количества у позиции')

  // 4. pieces у продукта без pieceG
  assertThrows(() => parseMenu(dayWithItem({ product: 'salmon', pieces: 2, where: 'container' }), products),
    ['День 1', 'pieceG'], 'pieces у продукта без pieceG')

  // 5. tbsp у продукта без tbspG
  assertThrows(() => parseMenu(dayWithItem({ product: 'salmon', tbsp: 1, where: 'container' }), products),
    ['День 1', 'tbspG'], 'tbsp у продукта без tbspG')

  // 6. число дней не равно cycleDays
  assertThrows(() => parseMenu(`
cycleDays: 2
days:
${validDayBlock(1)}
`, products), ['cycleDays'], 'число дней не совпадает с cycleDays')

  // 7. номера дней не 1..cycleDays без пропусков (пропуск)
  assertThrows(() => parseMenu(`
cycleDays: 2
days:
${validDayBlock(1)}
${validDayBlock(3)}
`, products), ['День 3'], 'номер дня вне диапазона 1..cycleDays')

  // 7b. дубль номера дня
  assertThrows(() => parseMenu(`
cycleDays: 2
days:
${validDayBlock(1)}
${validDayBlock(1)}
`, products), ['День 1', 'повторяется'], 'дубль номера дня')

  // 8. не все четыре приёма в дне
  assertThrows(() => parseMenu(`
cycleDays: 1
days:
  - day: 1
    meals:
      - slot: breakfast
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
`, products), ['День 1', 'не хватает'], 'в дне не все четыре приёма')

  // 8b. дубль slot в дне
  assertThrows(() => parseMenu(`
cycleDays: 1
days:
  - day: 1
    meals:
      - slot: breakfast
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - slot: breakfast
        title: t2
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - slot: lunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - slot: dinner
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - slot: snack
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
`, products), ['День 1', 'дважды'], 'дубль slot в дне')

  // 9. отсутствует where
  assertThrows(() => parseMenu(dayWithItem({ product: 'salmon', g: 100 } as never), products),
    ['День 1', 'where'], 'отсутствует where')

  // 10. неизвестное значение slot
  assertThrows(() => parseMenu(`
cycleDays: 1
days:
  - day: 1
    meals:
      - slot: brunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
`, products), ['День 1', 'brunch'], 'неизвестное значение slot')

  // 11. неизвестное значение where
  assertThrows(() => parseMenu(dayWithItem({ product: 'salmon', g: 100, where: 'fridge' }), products),
    ['День 1', 'fridge'], 'неизвестное значение where')

  // 12. отрицательное количество
  assertThrows(() => parseMenu(dayWithItem({ product: 'salmon', g: -10, where: 'container' }), products),
    ['День 1', 'положительным'], 'отрицательное количество')

  // 12b. нулевое количество
  assertThrows(() => parseMenu(dayWithItem({ product: 'salmon', g: 0, where: 'container' }), products),
    ['День 1', 'положительным'], 'нулевое количество')
}

/** Мини-меню из одного дня с одним «сломанным» item в завтраке (остальные приёмы валидны). */
function dayWithItem(item: Record<string, unknown>): string {
  return `
cycleDays: 1
days:
  - day: 1
    meals:
      - slot: breakfast
        title: t
        steps: []
        items: [${yamlInlineItem(item)}]
      - slot: lunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - slot: dinner
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - slot: snack
        title: t
        steps: []
        items: [{ product: flaxseed, tbsp: 1, where: packet }]
`
}

function yamlInlineItem(item: Record<string, unknown>): string {
  const parts = Object.entries(item).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : v}`)
  return `{ ${parts.join(', ')} }`
}

/** Валидный блок одного дня меню с заданным номером — для тестов на структуру days. */
function validDayBlock(day: number): string {
  return `  - day: ${day}
    meals:
      - slot: breakfast
        title: t
        steps: []
        items: [{ product: oats, g: 90, where: container }]
      - slot: lunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - slot: dinner
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - slot: snack
        title: t
        steps: []
        items: [{ product: flaxseed, tbsp: 1, where: packet }]`
}

// ---- parseProducts: micro100g ------------------------------------------------

/* Отсутствие ключа в micro100g — норма и значимая информация: в USDA SR Legacy
   у продукта может не быть строки по нутриенту. Ключ вне закрытого списка —
   наоборот, ошибка: справочник собирает скрипт, и лишний ключ означает, что
   скрипт и код разошлись. */

function microChecks(): void {
  const idx = baseProducts()

  const salmon = idx.get('salmon')!
  assert(salmon.micro100.fiber === 0, `честный ноль обязан сохраниться как 0, получено ${salmon.micro100.fiber}`)
  assert(salmon.micro100.calcium === 9 && salmon.micro100.water === 64.89, 'числа micro100g переносятся как есть')
  assert(!('vitK' in salmon.micro100), 'отсутствующий в YAML нутриент не должен появляться в структуре (даже нулём)')
  assert(!('fiber' in idx.get('oats')!.micro100), 'продукт без блока micro100g получает пустую карту, а не нули')

  group('parseProducts: micro100g разбирается, честный ноль сохраняется, отсутствующий ключ не подставляется нулём')
}

function microErrorChecks(): void {
  const unknownKey = `
products:
  x:
    name: x
    fdcId: 1
    fdcDescription: x
    tags: []
    per100g: { kcal: 1, protein: 1, fat: 1, carbs: 1 }
    micro100g: { fiber: 1, omega3: 2 }
`
  assertThrows(() => parseProducts(unknownKey), ['x', 'omega3'],
    'parseProducts: неизвестный ключ в micro100g — ошибка с именем продукта и ключа')

  const notANumber = `
products:
  x:
    name: x
    fdcId: 1
    fdcDescription: x
    tags: []
    per100g: { kcal: 1, protein: 1, fat: 1, carbs: 1 }
    micro100g: { fiber: "много" }
`
  assertThrows(() => parseProducts(notANumber), ['x', 'fiber', 'числом'],
    'parseProducts: нечисловое значение нутриента — ошибка')

  const notAMap = `
products:
  x:
    name: x
    fdcId: 1
    fdcDescription: x
    tags: []
    per100g: { kcal: 1, protein: 1, fat: 1, carbs: 1 }
    micro100g: [1, 2]
`
  assertThrows(() => parseProducts(notAMap), ['x', 'micro100g'],
    'parseProducts: micro100g не в виде набора «ключ: число» — ошибка')
}

function main(): void {
  console.log('data — парсер продуктов и меню')
  parseProductsChecks()
  substituteChecks()
  microChecks()
  microErrorChecks()
  parseMenuValidChecks()
  brokenMenuChecks()
  console.log(`\nВсе проверки data пройдены (${passed} групп).`)
}

try {
  main()
} catch (e) {
  console.error('\n✗ ТЕСТ DATA УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}
