/* Разбор data/products.yaml, data/menu.yaml и data/norms.yaml в доменные
   структуры (types.ts).
   Каждая некорректность формата — это Error с русским текстом, где сказано
   как минимум день, а для позиций и приёмов — ещё и приём (slot). Молча
   проглотить кривые данные нельзя: меню собирает человек руками. */

import yaml from 'js-yaml'
import { NUTRIENT_KEYS, NUTRIENT_TITLE, NUTRIENT_UNIT, SLOTS, SLOT_TITLE } from './types'
import type { Item, Meal, Menu, MenuDay, NormBasis, NutrientKey, NutrientNorm, NutrientNorms, Nutrients, Product, ProductIndex, Slot, Where } from './types'

const WHERES: readonly Where[] = ['container', 'packet']
const NORM_BASES: readonly NormBasis[] = ['rda', 'ai']

/* ---- products.yaml ---- */

interface RawKbju {
  kcal: number
  protein: number
  fat: number
  carbs: number
}

interface RawProduct {
  name: string
  fdcId: number
  fdcDescription: string
  substitute?: string
  tags: string[]
  pieceG?: number
  pieceSource?: string
  tbspG?: number
  tbspSource?: string
  per100g: RawKbju
  micro100g?: Record<string, unknown>
}

const NUTRIENT_KEY_SET: ReadonlySet<string> = new Set<string>(NUTRIENT_KEYS)

/** Разбирает micro100g одного продукта.
    Ключа нет — это НОРМА: в USDA SR Legacy у продукта может не быть строки по
    нутриенту, и отсутствие поля означает «неизвестно», а не ноль. Поэтому здесь
    ничего не подставляется по умолчанию.
    Ключ вне закрытого списка NUTRIENT_KEYS — ошибка: справочник собирается
    скриптом scripts/build-products.mjs, и лишний ключ означает, что скрипт и код
    разошлись; проглотить его молча значит потерять данные без следа. */
function parseMicro(raw: unknown, id: string): Nutrients {
  if (raw === undefined) return {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`Продукт «${id}»: micro100g должен быть набором «ключ: число»`)
  }
  const micro: Nutrients = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!NUTRIENT_KEY_SET.has(key)) {
      throw new Error(`Продукт «${id}»: неизвестный нутриент «${key}» в micro100g (допустимы только: ${NUTRIENT_KEYS.join(', ')})`)
    }
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new Error(`Продукт «${id}»: нутриент «${key}» в micro100g должен быть числом, получено ${JSON.stringify(value)}`)
    }
    micro[key as NutrientKey] = value
  }
  return micro
}

interface RawProductsFile {
  source: string
  products: Record<string, RawProduct>
}

export function parseProducts(yamlText: string): ProductIndex {
  const raw = yaml.load(yamlText) as RawProductsFile | undefined
  if (!raw || typeof raw !== 'object' || !raw.products || typeof raw.products !== 'object') {
    throw new Error('Файл продуктов: не найден корневой ключ products')
  }

  const map = new Map<string, Product>()
  for (const [id, p] of Object.entries(raw.products)) {
    if (!p || typeof p !== 'object') {
      throw new Error(`Продукт «${id}»: пустая или некорректная запись`)
    }
    if (typeof p.name !== 'string' || !p.name) {
      throw new Error(`Продукт «${id}»: не задано name`)
    }
    if (typeof p.fdcId !== 'number') {
      throw new Error(`Продукт «${id}»: не задан fdcId`)
    }
    if (typeof p.fdcDescription !== 'string' || !p.fdcDescription) {
      throw new Error(`Продукт «${id}»: не задан fdcDescription`)
    }
    if (!Array.isArray(p.tags)) {
      throw new Error(`Продукт «${id}»: не задан tags`)
    }
    if (!p.per100g || typeof p.per100g !== 'object') {
      throw new Error(`Продукт «${id}»: не задан per100g`)
    }
    const { kcal, protein, fat, carbs } = p.per100g
    if (typeof kcal !== 'number' || typeof protein !== 'number' || typeof fat !== 'number' || typeof carbs !== 'number') {
      throw new Error(`Продукт «${id}»: в per100g должны быть числа kcal/protein/fat/carbs`)
    }

    const product: Product = {
      id,
      name: p.name,
      fdcId: p.fdcId,
      fdcDescription: p.fdcDescription,
      tags: p.tags,
      per100: { kcal, p: protein, f: fat, c: carbs },
      micro100: parseMicro(p.micro100g, id)
    }
    if (p.substitute !== undefined) product.substitute = p.substitute
    if (p.pieceG !== undefined) product.pieceG = p.pieceG
    if (p.tbspG !== undefined) product.tbspG = p.tbspG

    map.set(id, product)
  }

  return map
}

/* ---- menu.yaml ---- */

interface RawItem {
  product: string
  g?: number
  pieces?: number
  tbsp?: number
  where?: string
}

interface RawMeal {
  id: string
  slot: string
  title: string
  steps: string[]
  items: RawItem[]
}

interface RawDay {
  day: number
  meals: RawMeal[]
}

interface RawMenu {
  cycleDays: number
  days: RawDay[]
}

function checkPositive(value: number, label: string): void {
  if (typeof value !== 'number' || Number.isNaN(value) || !(value > 0)) {
    throw new Error(`${label}: количество должно быть положительным числом, получено ${value}`)
  }
}

function parseItem(rawItem: RawItem, day: number, slot: Slot, products: ProductIndex): Item {
  const label = `День ${day}, ${SLOT_TITLE[slot]}`

  if (typeof rawItem.product !== 'string' || !rawItem.product) {
    throw new Error(`${label}: у позиции не задан product`)
  }
  const product = products.get(rawItem.product)
  if (!product) {
    throw new Error(`${label}: ссылка на несуществующий продукт «${rawItem.product}»`)
  }

  const quantityKeys = (['g', 'pieces', 'tbsp'] as const).filter(k => rawItem[k] !== undefined)
  if (quantityKeys.length === 0) {
    throw new Error(`${label}: у позиции «${product.name}» не задано количество (g/pieces/tbsp)`)
  }
  if (quantityKeys.length > 1) {
    throw new Error(`${label}: у позиции «${product.name}» задано больше одного количества сразу (${quantityKeys.join(', ')})`)
  }

  if (typeof rawItem.where !== 'string' || rawItem.where.length === 0) {
    throw new Error(`${label}: у позиции «${product.name}» не задано where`)
  }
  if (!(WHERES as readonly string[]).includes(rawItem.where)) {
    throw new Error(`${label}: неизвестное значение where «${rawItem.where}» у позиции «${product.name}»`)
  }
  const where = rawItem.where as Where

  const item: Item = { product: rawItem.product, where }

  if (rawItem.g !== undefined) {
    checkPositive(rawItem.g, `${label}: позиция «${product.name}» (g)`)
    item.g = rawItem.g
  } else if (rawItem.pieces !== undefined) {
    checkPositive(rawItem.pieces, `${label}: позиция «${product.name}» (pieces)`)
    if (product.pieceG === undefined) {
      throw new Error(`${label}: продукт «${product.name}» задан в штуках (pieces), но у него не задан pieceG`)
    }
    item.pieces = rawItem.pieces
  } else if (rawItem.tbsp !== undefined) {
    checkPositive(rawItem.tbsp, `${label}: позиция «${product.name}» (tbsp)`)
    if (product.tbspG === undefined) {
      throw new Error(`${label}: продукт «${product.name}» задан в ложках (tbsp), но у него не задан tbspG`)
    }
    item.tbsp = rawItem.tbsp
  }

  return item
}

/** Слаг: только латиница в нижнем регистре, цифры и дефис. Кириллица, заглавные
    буквы и любые другие символы недопустимы — id должен быть безопасен как ключ
    в хранилище оценок и в URL. */
const MEAL_ID_RE = /^[a-z0-9-]+$/

/** Отпечаток состава блюда: слот, название и позиции. Два блюда с одним id, но
    разным отпечатком — это ошибка данных: id обязан однозначно определять
    блюдо, иначе оценка одного блюда молча смешается с оценкой другого. */
function mealFingerprint(slot: Slot, title: string, items: RawItem[]): string {
  return JSON.stringify({ slot, title, items })
}

function parseMeal(rawMeal: RawMeal, day: number, products: ProductIndex, seenSlots: Set<Slot>, seenMealIds: Map<string, { day: number; fingerprint: string }>): Meal {
  if (typeof rawMeal.slot !== 'string' || !(SLOTS as readonly string[]).includes(rawMeal.slot)) {
    throw new Error(`День ${day}: неизвестное значение slot «${rawMeal.slot}»`)
  }
  const slot = rawMeal.slot as Slot
  if (seenSlots.has(slot)) {
    throw new Error(`День ${day}: приём «${SLOT_TITLE[slot]}» указан в дне дважды`)
  }
  seenSlots.add(slot)

  if (typeof rawMeal.id !== 'string' || !rawMeal.id) {
    throw new Error(`День ${day}, ${SLOT_TITLE[slot]}: не задан id`)
  }
  if (!MEAL_ID_RE.test(rawMeal.id)) {
    throw new Error(`День ${day}, ${SLOT_TITLE[slot]}: id «${rawMeal.id}» должен состоять только из латинских строчных букв, цифр и дефиса`)
  }

  if (typeof rawMeal.title !== 'string' || !rawMeal.title) {
    throw new Error(`День ${day}, ${SLOT_TITLE[slot]}: не задан title`)
  }
  if (!Array.isArray(rawMeal.steps)) {
    throw new Error(`День ${day}, ${SLOT_TITLE[slot]}: не заданы steps`)
  }
  if (!Array.isArray(rawMeal.items) || rawMeal.items.length === 0) {
    throw new Error(`День ${day}, ${SLOT_TITLE[slot]}: не заданы items`)
  }

  const fingerprint = mealFingerprint(slot, rawMeal.title, rawMeal.items)
  const seen = seenMealIds.get(rawMeal.id)
  if (seen && seen.fingerprint !== fingerprint) {
    throw new Error(`День ${day}, ${SLOT_TITLE[slot]}: id «${rawMeal.id}» уже занят другим блюдом (день ${seen.day}) — совпадение id при разном составе недопустимо`)
  }
  if (!seen) {
    seenMealIds.set(rawMeal.id, { day, fingerprint })
  }

  const items = rawMeal.items.map(rawItem => parseItem(rawItem, day, slot, products))

  return { slot, id: rawMeal.id, title: rawMeal.title, steps: rawMeal.steps, items }
}

function parseDay(rawDay: RawDay, cycleDays: number, products: ProductIndex, seenDays: Set<number>, seenMealIds: Map<string, { day: number; fingerprint: string }>): MenuDay {
  if (typeof rawDay.day !== 'number' || !Number.isInteger(rawDay.day)) {
    throw new Error('Меню: у дня не задан целочисленный номер (day)')
  }
  const day = rawDay.day
  if (day < 1 || day > cycleDays) {
    throw new Error(`День ${day}: номер дня должен лежать в диапазоне 1..${cycleDays}`)
  }
  if (seenDays.has(day)) {
    throw new Error(`День ${day}: номер дня повторяется`)
  }
  seenDays.add(day)

  if (!Array.isArray(rawDay.meals)) {
    throw new Error(`День ${day}: не заданы приёмы (meals)`)
  }

  const seenSlots = new Set<Slot>()
  const meals = rawDay.meals.map(rawMeal => parseMeal(rawMeal, day, products, seenSlots, seenMealIds))

  const missing = SLOTS.filter(s => !seenSlots.has(s))
  if (missing.length > 0) {
    throw new Error(`День ${day}: не хватает приёмов: ${missing.map(s => SLOT_TITLE[s]).join(', ')}`)
  }

  return { day, meals }
}

export function parseMenu(yamlText: string, products: ProductIndex): Menu {
  const raw = yaml.load(yamlText) as RawMenu | undefined
  if (!raw || typeof raw !== 'object' || typeof raw.cycleDays !== 'number' || !Array.isArray(raw.days)) {
    throw new Error('Файл меню: не заданы cycleDays или days')
  }
  const cycleDays = raw.cycleDays

  if (raw.days.length !== cycleDays) {
    throw new Error(`Меню: число дней (${raw.days.length}) не совпадает с cycleDays (${cycleDays})`)
  }

  const seenDays = new Set<number>()
  const seenMealIds = new Map<string, { day: number; fingerprint: string }>()
  const days = raw.days.map(rawDay => parseDay(rawDay, cycleDays, products, seenDays, seenMealIds))
  days.sort((a, b) => a.day - b.day)

  return { cycleDays, days }
}

/* ---- norms.yaml ---- */

interface RawNorm {
  amount?: unknown
  basis?: unknown
  unit?: unknown
  ul?: unknown
  cdrr?: unknown
  comparable?: unknown
  note?: unknown
}

interface RawNormsFile {
  norms?: Record<string, RawNorm>
}

const NORM_FIELDS: readonly string[] = ['amount', 'basis', 'unit', 'ul', 'cdrr', 'comparable', 'note']

/** Читает необязательное числовое поле нормы (ul, cdrr). */
function normNumber(value: unknown, label: string, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label}: ${field} должен быть числом, получено ${JSON.stringify(value)}`)
  }
  if (!(value > 0)) {
    throw new Error(`${label}: ${field} должен быть положительным, получено ${value}`)
  }
  return value
}

/** Проверяет unit записи против карты NUTRIENT_UNIT. Поле обязательно и не
    попадает в NutrientNorm — оно не второй источник правды о единице, а
    контрольная сумма к первому (NUTRIENT_UNIT в src/core/types.ts). Именно
    отсутствие такой сверки один раз уже стоило молчаливой ошибки в 1000 раз:
    медь была записана в мкг при коде, читающем норму в мг (900 вместо 0.9). */
function checkNormUnit(rawNorm: RawNorm, label: string, key: NutrientKey): void {
  const expected = NUTRIENT_UNIT[key]
  if (rawNorm.unit === undefined) {
    throw new Error(`${label}: не задано unit — ожидается «${expected}» (см. NUTRIENT_UNIT для ключа «${key}» в src/core/types.ts)`)
  }
  if (rawNorm.unit !== expected) {
    throw new Error(`${label}: unit «${JSON.stringify(rawNorm.unit)}» не совпадает с NUTRIENT_UNIT «${expected}» для ключа «${key}» — проверьте, не перепутаны ли единицы измерения при переносе числа из источника`)
  }
}

/** Разбирает data/norms.yaml.
    Отсутствие нутриента в файле — НЕ ошибка: это и означает «нормы нет»
    (см. шапку файла). Ошибка — ключ вне закрытого списка NUTRIENT_KEYS:
    единицы норм заданы картой NUTRIENT_UNIT, и норма по ключу, которого там
    нет, задана неизвестно в чём. Лишнее поле внутри записи тоже ошибка: опечатку
    в имени поля иначе не отличить от осознанного пропуска. unit обязателен и
    сверяется с NUTRIENT_UNIT[key] — это контрольная сумма к единице, а не
    второе место, где она хранится: расхождение или отсутствие роняет разбор,
    а не проходит молча (см. комментарий в шапке data/norms.yaml). */
export function parseNorms(yamlText: string): NutrientNorms {
  const raw = yaml.load(yamlText) as RawNormsFile | undefined
  if (!raw || typeof raw !== 'object' || !raw.norms || typeof raw.norms !== 'object' || Array.isArray(raw.norms)) {
    throw new Error('Файл норм: не найден корневой ключ norms')
  }

  const norms: NutrientNorms = {}
  for (const [key, rawNorm] of Object.entries(raw.norms)) {
    if (!NUTRIENT_KEY_SET.has(key)) {
      throw new Error(`Нормы: неизвестный нутриент «${key}» (допустимы только: ${NUTRIENT_KEYS.join(', ')})`)
    }
    const nutrientKey = key as NutrientKey
    const label = `Норма «${NUTRIENT_TITLE[nutrientKey]}»`

    if (!rawNorm || typeof rawNorm !== 'object' || Array.isArray(rawNorm)) {
      throw new Error(`${label}: пустая или некорректная запись`)
    }
    for (const field of Object.keys(rawNorm)) {
      if (!NORM_FIELDS.includes(field)) {
        throw new Error(`${label}: неизвестное поле «${field}» (допустимы только: ${NORM_FIELDS.join(', ')})`)
      }
    }

    checkNormUnit(rawNorm, label, nutrientKey)

    const amount = normNumber(rawNorm.amount, label, 'amount')

    if (typeof rawNorm.basis !== 'string' || !(NORM_BASES as readonly string[]).includes(rawNorm.basis)) {
      throw new Error(`${label}: basis должен быть одним из ${NORM_BASES.join(' / ')}, получено ${JSON.stringify(rawNorm.basis)}`)
    }

    if (rawNorm.comparable !== undefined && typeof rawNorm.comparable !== 'boolean') {
      throw new Error(`${label}: comparable должен быть true или false, получено ${JSON.stringify(rawNorm.comparable)}`)
    }
    if (rawNorm.note !== undefined && (typeof rawNorm.note !== 'string' || rawNorm.note.length === 0)) {
      throw new Error(`${label}: note должен быть непустой строкой`)
    }

    const norm: NutrientNorm = {
      amount,
      basis: rawNorm.basis as NormBasis,
      comparable: rawNorm.comparable === undefined ? true : rawNorm.comparable
    }

    if (rawNorm.ul !== undefined) {
      const ul = normNumber(rawNorm.ul, label, 'ul')
      if (ul < amount) {
        throw new Error(`${label}: верхний предел ul (${ul}) меньше самой нормы amount (${amount})`)
      }
      norm.ul = ul
    }
    if (rawNorm.cdrr !== undefined) norm.cdrr = normNumber(rawNorm.cdrr, label, 'cdrr')
    if (rawNorm.note !== undefined) norm.note = rawNorm.note as string

    norms[nutrientKey] = norm
  }

  return norms
}
