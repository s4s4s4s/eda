/**
 * Тесты парсера продуктов и меню (src/core/data.ts). Фикстуры — синтетический
 * YAML в коде теста, файлы data/*.yaml не читаем: это территория другого
 * агента и может ещё не существовать. Гоняются node-ом после сборки esbuild:
 * `npm run test:data`.
 */
import { parseMenu, parseProducts, parseProductsRevision } from '../src/core/data'
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

// ---- parseProductsRevision: дата последней правки справочника ----------------

function productsRevisionChecks(): void {
  const withRevision = `
revision: "2026-09-03"
products:
  salmon:
    name: лосось
    fdcId: 175167
    fdcDescription: "Fish, salmon, Atlantic, farmed, raw"
    tags: [fish]
    per100g: { kcal: 208, protein: 20.42, fat: 13.42, carbs: 0 }
`
  assert(parseProductsRevision(withRevision) === '2026-09-03',
    `revision должен разбираться из верхнего уровня, получено «${parseProductsRevision(withRevision)}»`)

  // ключ revision — не продукт: parseProducts обязан пройти мимо него и
  // не создать запись с id «revision»
  const idx = parseProducts(withRevision)
  assert(idx.size === 1 && !idx.has('revision'),
    `parseProducts не должен превращать revision в продукт, получено ${idx.size} записей: ${[...idx.keys()].join(', ')}`)

  assertThrows(() => parseProductsRevision(PRODUCTS_YAML), ['revision'],
    'parseProductsRevision: без поля revision — ошибка')

  const badFormat = withRevision.replace('"2026-09-03"', '"03.09.2026"')
  assertThrows(() => parseProductsRevision(badFormat), ['revision'],
    'parseProductsRevision: кривой формат даты (не ГГГГ-ММ-ДД) — ошибка')

  group('parseProductsRevision: разбирает ГГГГ-ММ-ДД, ошибка без поля и при кривом формате; parseProducts игнорирует revision как не-продукт')
}

// ---- меню: редакции -------------------------------------------------------------

/** Сдвигает каждую непустую строку текста на заданное число пробелов —
    используется, чтобы вложить блок дней внутрь «- title: …\n  days:», не
    переписывая вручную отступы во всех фикстурах. */
function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return text.split('\n').map(line => (line.length > 0 ? pad + line : line)).join('\n')
}

/** Собирает YAML одной редакции — элемент списка editions. daysContent — тот
    же текст, что раньше шёл прямо под корневым `days:` (начинается с
    «  - day: N»), просто вложенный на 4 пробела глубже. */
function edition(title: string, daysContent: string, from?: string): string {
  const header = from !== undefined
    ? `  - from: "${from}"\n    title: ${title}\n    days:\n`
    : `  - title: ${title}\n    days:\n`
  return header + indent(daysContent, 4)
}

/** Собирает файл меню целиком из cycleDays и готовых блоков редакций (edition()). */
function menuYaml(cycleDays: number, editions: string[]): string {
  return `\ncycleDays: ${cycleDays}\neditions:\n${editions.join('\n')}\n`
}

function validMenuYaml(): string {
  return menuYaml(2, [edition('неделя без изменений, дни 1 и 2', `  - day: 1
    meals:
      - id: fixture-meal-1
        slot: breakfast
        title: Овсянка с бразильским орехом
        steps: [Разогреть контейнер, Досыпать пакетик]
        items:
          - { product: oats, g: 90, where: container }
          - { product: brazil-nut, pieces: 2, where: packet }
          - { product: flaxseed, tbsp: 1, where: packet }
      - id: fixture-meal-2
        slot: lunch
        title: Лосось
        steps: []
        items:
          - { product: salmon, g: 170, where: container }
      - id: fixture-meal-3
        slot: dinner
        title: Лосось на ужин
        steps: []
        items:
          - { product: salmon, g: 150, where: container }
      - id: fixture-meal-4
        slot: snack
        title: Орехи
        steps: []
        items:
          - { product: brazil-nut, pieces: 2, where: packet }
  - day: 2
    meals:
      - id: fixture-meal-5
        slot: breakfast
        title: Овсянка
        steps: []
        items:
          - { product: oats, g: 90, where: container }
      - id: fixture-meal-6
        slot: lunch
        title: Лосось
        steps: []
        items:
          - { product: salmon, g: 170, where: container }
      - id: fixture-meal-7
        slot: dinner
        title: Лосось
        steps: []
        items:
          - { product: salmon, g: 170, where: container }
      - id: fixture-meal-8
        slot: snack
        title: Лён
        steps: []
        items:
          - { product: flaxseed, tbsp: 1, where: packet }`)])
}

function parseMenuValidChecks(): void {
  const products = baseProducts()
  const menu = parseMenu(validMenuYaml(), products)
  assert(menu.cycleDays === 2, `cycleDays ожидалось 2, получено ${menu.cycleDays}`)
  assert(menu.editions.length === 1, `редакций ожидалось 1, получено ${menu.editions.length}`)
  assert(menu.editions[0].from === undefined, 'единственная редакция — базовая, from не задан')
  const days = menu.editions[0].days
  assert(days.length === 2, `дней ожидалось 2, получено ${days.length}`)
  assert(days[0].day === 1 && days[1].day === 2, 'дни отсортированы по номеру')
  const breakfast = days[0].meals.find(m => m.slot === 'breakfast')!
  assert(breakfast.items.length === 3, `в завтраке дня 1 ожидалось 3 позиции, получено ${breakfast.items.length}`)
  assert(breakfast.items[1].pieces === 2, 'позиция бразильского ореха задана в pieces')
  group('parseMenu: валидная фикстура (одна редакция) разбирается в ожидаемую структуру')
}

// ---- кривые случаи --------------------------------------------------------------

function brokenMenuChecks(): void {
  const products = baseProducts()

  // 1. ссылка на несуществующий продукт
  assertThrows(() => parseMenu(menuYaml(1, [edition('ссылка на несуществующий продукт', `  - day: 1
    meals:
      - id: fixture-meal-9
        slot: breakfast
        title: t
        steps: []
        items: [{ product: unicorn-meat, g: 100, where: container }]
      - id: fixture-meal-10
        slot: lunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-meal-11
        slot: dinner
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-meal-12
        slot: snack
        title: t
        steps: []
        items: [{ product: flaxseed, tbsp: 1, where: packet }]`)]), products), ['День 1', 'unicorn-meat'], 'несуществующий продукт')

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

  // 6. первая редакция описывает не весь цикл
  assertThrows(() => parseMenu(menuYaml(2, [edition('только день 1 из двух', validDayBlock(1))]), products),
    ['первая редакция', 'не весь цикл', 'нет дней 2 из 2'], 'первая редакция не описывает весь цикл')

  // 7. номера дней не 1..cycleDays без пропусков (пропуск)
  assertThrows(() => parseMenu(menuYaml(2, [edition('день вне диапазона', `${validDayBlock(1)}\n${validDayBlock(3)}`)]), products),
    ['День 3'], 'номер дня вне диапазона 1..cycleDays')

  // 7b. дубль номера дня
  assertThrows(() => parseMenu(menuYaml(2, [edition('дубль номера дня', `${validDayBlock(1)}\n${validDayBlock(1)}`)]), products),
    ['День 1', 'повторяется'], 'дубль номера дня')

  // 8. не все четыре приёма в дне
  assertThrows(() => parseMenu(menuYaml(1, [edition('не хватает приёмов', `  - day: 1
    meals:
      - id: fixture-meal-13
        slot: breakfast
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]`)]), products), ['День 1', 'не хватает'], 'в дне не все четыре приёма')

  // 8b. дубль slot в дне
  assertThrows(() => parseMenu(menuYaml(1, [edition('дубль slot', `  - day: 1
    meals:
      - id: fixture-meal-14
        slot: breakfast
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-meal-15
        slot: breakfast
        title: t2
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-meal-16
        slot: lunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-meal-17
        slot: dinner
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-meal-18
        slot: snack
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]`)]), products), ['День 1', 'дважды'], 'дубль slot в дне')

  // 9. отсутствует where
  assertThrows(() => parseMenu(dayWithItem({ product: 'salmon', g: 100 } as never), products),
    ['День 1', 'where'], 'отсутствует where')

  // 10. неизвестное значение slot
  assertThrows(() => parseMenu(menuYaml(1, [edition('неизвестный slot', `  - day: 1
    meals:
      - slot: brunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]`)]), products), ['День 1', 'brunch'], 'неизвестное значение slot')

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

/** Мини-меню из одной редакции с одним «сломанным» item в завтраке (остальные приёмы валидны). */
function dayWithItem(item: Record<string, unknown>): string {
  const daysContent = `  - day: 1
    meals:
      - id: fixture-meal-19
        slot: breakfast
        title: t
        steps: []
        items: [${yamlInlineItem(item)}]
      - id: fixture-meal-20
        slot: lunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-meal-21
        slot: dinner
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-meal-22
        slot: snack
        title: t
        steps: []
        items: [{ product: flaxseed, tbsp: 1, where: packet }]`
  return menuYaml(1, [edition('позиция с проверяемым набором полей', daysContent)])
}

function yamlInlineItem(item: Record<string, unknown>): string {
  const parts = Object.entries(item).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : v}`)
  return `{ ${parts.join(', ')} }`
}

/** Валидный блок одного дня меню с заданным номером — для тестов на структуру days. */
function validDayBlock(day: number): string {
  return `  - day: ${day}
    meals:
      - id: fixture-meal-23
        slot: breakfast
        title: t
        steps: []
        items: [{ product: oats, g: 90, where: container }]
      - id: fixture-meal-24
        slot: lunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-meal-25
        slot: dinner
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-meal-26
        slot: snack
        title: t
        steps: []
        items: [{ product: flaxseed, tbsp: 1, where: packet }]`
}

// ---- редакции: правила формата и порядка --------------------------------------

function editionRulesChecks(): void {
  const products = baseProducts()

  // вторая редакция без from — запрещена
  assertThrows(() => parseMenu(menuYaml(2, [
    edition('первая редакция — весь цикл', `${validDayBlock(1)}\n${validDayBlock(2)}`),
    edition('вторая редакция без даты', validDayBlock(2))
  ]), products), ['идёт не первой', 'обязана задать from'], 'вторая редакция без from — запрещена')

  // from не в формате ГГГГ-ММ-ДД
  assertThrows(() => parseMenu(menuYaml(2, [
    edition('первая редакция — весь цикл', `${validDayBlock(1)}\n${validDayBlock(2)}`),
    edition('вторая редакция с кривой датой', validDayBlock(2), '04.09.2026')
  ]), products), ['from', 'ГГГГ-ММ-ДД'], 'from не в формате ГГГГ-ММ-ДД — запрещён')

  // редакции идут не по возрастанию даты
  assertThrows(() => parseMenu(menuYaml(2, [
    edition('первая редакция — весь цикл', `${validDayBlock(1)}\n${validDayBlock(2)}`),
    edition('редакция от 4 сентября', validDayBlock(1), '2026-09-04'),
    edition('редакция от 2 сентября — раньше предыдущей', validDayBlock(1), '2026-09-02')
  ]), products), ['не по возрастанию даты'], 'редакции идут не по возрастанию даты — запрещено')

  // редакция без title
  assertThrows(() => parseMenu(`
cycleDays: 1
editions:
  - days:
${indent(validDayBlock(1), 4)}
`, products), ['не задан title'], 'редакция без title — запрещена')

  // редакция с пустым days: []
  assertThrows(() => parseMenu(`
cycleDays: 1
editions:
  - title: пустая редакция
    days: []
`, products), ['не заданы дни'], 'редакция с пустым days: [] — запрещена')

  // editions: [] — запрещено
  assertThrows(() => parseMenu(`
cycleDays: 1
editions: []
`, products), ['список редакций пуст'], 'editions: [] — запрещено')

  // файл без editions вовсе — запрещён
  assertThrows(() => parseMenu(`
cycleDays: 1
`, products), ['cycleDays', 'editions'], 'файл без editions вовсе — запрещён')

  // позитив: вторая редакция вправе описывать подмножество дней
  const menu = parseMenu(menuYaml(2, [
    edition('первая редакция — весь цикл', `${validDayBlock(1)}\n${validDayBlock(2)}`),
    edition('вторая редакция — только изменённый день 2', validDayBlock(2), '2026-09-04')
  ]), products)
  assert(menu.editions.length === 2, `редакций ожидалось 2, получено ${menu.editions.length}`)
  assert(menu.editions[1].from === '2026-09-04', 'вторая редакция несёт заданную дату from')
  assert(menu.editions[1].days.length === 1 && menu.editions[1].days[0].day === 2,
    'вторая редакция вправе описывать подмножество дней цикла (только изменённый день)')

  group('parseMenu: правила редакций — from обязателен со второй, формат даты, порядок возрастания, title и days обязательны, editions не может быть пуст или отсутствовать, подмножество дней разрешено')
}

/** Один и тот же id блюда в разных редакциях допустим намеренно — это то же
    блюдо с новой раскладкой. Внутри одной редакции такой дубль по-прежнему
    запрещён (см. mealIdChecks, проверка 4). */
function crossEditionMealIdChecks(): void {
  const products = baseProducts()

  const dayWithId = (id: string, title: string): string => `  - day: 1
    meals:
      - id: ${id}
        slot: breakfast
        title: ${title}
        steps: []
        items: [{ product: oats, g: 90, where: container }]
      - id: fixture-meal-cross-lunch
        slot: lunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-meal-cross-dinner
        slot: dinner
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-meal-cross-snack
        slot: snack
        title: t
        steps: []
        items: [{ product: flaxseed, tbsp: 1, where: packet }]`

  const menu = parseMenu(menuYaml(1, [
    edition('первая редакция', dayWithId('cross-edition-dish', 'Овсянка')),
    edition('вторая редакция — новая раскладка того же блюда', dayWithId('cross-edition-dish', 'Овсянка с орехами'), '2026-09-04')
  ]), products)

  assert(menu.editions[0].days[0].meals[0].id === 'cross-edition-dish', 'id блюда сохранён в первой редакции')
  assert(menu.editions[1].days[0].meals[0].id === 'cross-edition-dish', 'тот же id допустим в другой редакции с иной раскладкой')
  group('parseMenu: один и тот же id блюда в разных редакциях допустим (новая раскладка того же блюда)')
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

// ---- Meal.id -----------------------------------------------------------------

function mealIdChecks(): void {
  const products = baseProducts()

  // 1. id отсутствует
  assertThrows(() => parseMenu(menuYaml(1, [edition('без id у приёма', `  - day: 1
    meals:
      - slot: breakfast
        title: t
        steps: []
        items: [{ product: oats, g: 90, where: container }]
      - id: fixture-id-lunch
        slot: lunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-id-dinner
        slot: dinner
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-id-snack
        slot: snack
        title: t
        steps: []
        items: [{ product: flaxseed, tbsp: 1, where: packet }]`)]), products), ['День 1', 'id'], 'у приёма не задан id')

  // 2. id с заглавными буквами
  assertThrows(() => parseMenu(menuYaml(1, [edition('id с заглавными буквами', `  - day: 1
    meals:
      - id: Fixture-Id
        slot: breakfast
        title: t
        steps: []
        items: [{ product: oats, g: 90, where: container }]
      - id: fixture-id-lunch
        slot: lunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-id-dinner
        slot: dinner
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-id-snack
        slot: snack
        title: t
        steps: []
        items: [{ product: flaxseed, tbsp: 1, where: packet }]`)]), products), ['День 1', 'Fixture-Id'], 'id с заглавными буквами — ошибка формата')

  // 3. id кириллицей
  assertThrows(() => parseMenu(menuYaml(1, [edition('id кириллицей', `  - day: 1
    meals:
      - id: "овсянка"
        slot: breakfast
        title: t
        steps: []
        items: [{ product: oats, g: 90, where: container }]
      - id: fixture-id-lunch
        slot: lunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-id-dinner
        slot: dinner
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-id-snack
        slot: snack
        title: t
        steps: []
        items: [{ product: flaxseed, tbsp: 1, where: packet }]`)]), products), ['День 1', 'овсянка'], 'id кириллицей — ошибка формата')

  // 4. один и тот же id у двух РАЗНЫХ по составу блюд внутри одной редакции — ошибка
  assertThrows(() => parseMenu(menuYaml(2, [edition('дубль id при разном составе', `  - day: 1
    meals:
      - id: shared-id
        slot: breakfast
        title: Овсянка
        steps: []
        items: [{ product: oats, g: 90, where: container }]
      - id: fixture-id-lunch-1
        slot: lunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-id-dinner-1
        slot: dinner
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-id-snack-1
        slot: snack
        title: t
        steps: []
        items: [{ product: flaxseed, tbsp: 1, where: packet }]
  - day: 2
    meals:
      - id: shared-id
        slot: breakfast
        title: Лосось
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-id-lunch-2
        slot: lunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-id-dinner-2
        slot: dinner
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-id-snack-2
        slot: snack
        title: t
        steps: []
        items: [{ product: flaxseed, tbsp: 1, where: packet }]`)]), products), ['shared-id', 'День 2'], 'один id у двух разных по составу блюд внутри одной редакции — ошибка')

  // 5. один и тот же id у ДВУХ ОДИНАКОВЫХ по составу блюд в разных днях одной редакции — допустимо
  const reusedIdMenu = parseMenu(menuYaml(2, [edition('повтор id при одинаковом составе', `  - day: 1
    meals:
      - id: same-dish
        slot: breakfast
        title: Овсянка
        steps: []
        items: [{ product: oats, g: 90, where: container }]
      - id: fixture-id-lunch-3
        slot: lunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-id-dinner-3
        slot: dinner
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-id-snack-3
        slot: snack
        title: t
        steps: []
        items: [{ product: flaxseed, tbsp: 1, where: packet }]
  - day: 2
    meals:
      - id: same-dish
        slot: breakfast
        title: Овсянка
        steps: []
        items: [{ product: oats, g: 90, where: container }]
      - id: fixture-id-lunch-4
        slot: lunch
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-id-dinner-4
        slot: dinner
        title: t
        steps: []
        items: [{ product: salmon, g: 170, where: container }]
      - id: fixture-id-snack-4
        slot: snack
        title: t
        steps: []
        items: [{ product: flaxseed, tbsp: 1, where: packet }]`)]), products)
  const reusedDays = reusedIdMenu.editions[0].days
  assert(reusedDays[0].meals[0].id === 'same-dish' && reusedDays[1].meals[0].id === 'same-dish',
    'id одного и того же блюда, повторённого буквально в другом дне одной редакции, допустим без ошибки')
  group('parseMenu: id обязателен, формат ^[a-z0-9-]+$, дубль id при разном составе — ошибка, при одинаковом — допустим')
}

function main(): void {
  console.log('data — парсер продуктов и меню')
  parseProductsChecks()
  substituteChecks()
  productsRevisionChecks()
  microChecks()
  microErrorChecks()
  parseMenuValidChecks()
  brokenMenuChecks()
  editionRulesChecks()
  crossEditionMealIdChecks()
  mealIdChecks()
  console.log(`\nВсе проверки data пройдены (${passed} групп).`)
}

try {
  main()
} catch (e) {
  console.error('\n✗ ТЕСТ DATA УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}
