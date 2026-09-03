/**
 * Тесты чистого расчёта «своей еды» (scripts/lib/usda.mjs: resolveSpec,
 * per100Of) — доказывают, что resolve-food.mjs считает те же числа, что
 * scripts/build-products.mjs уже записал в data/products.yaml для тех же
 * fdcId. Фикстура test/fixtures/fdc-mini — настоящие строки выгрузки USDA SR
 * Legacy (лосось 175167, яйцо 171287, банан 173944), не выдуманные, поэтому
 * сверка с products.yaml реальна, а не совпадение синтетических чисел.
 *
 * Сборка и запуск — как у остальных test:* в package.json:
 *   esbuild test/food-resolve.test.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.cache/eda/food-resolve.mjs && node node_modules/.cache/eda/food-resolve.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { parseProducts } from '../src/core/data'
import { NUTRIENT_KEYS } from '../src/core/types'
import type { NutrientKey, Product, ProductIndex } from '../src/core/types'
// scripts/lib/usda.mjs — обычный ESM-модуль без типов, esbuild собирает его
// как есть вместе с TS-частью теста.
// @ts-expect-error — .mjs без деклараций типов, тест проверяет поведение по значениям
import { loadFoods, loadCategories, loadNutrientsFor, resolveSpec, FoodDataError, FoodSpecError, SOURCE } from '../scripts/lib/usda.mjs'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}
function group(name: string): void { console.log(`  ok ${name}`); passed++ }

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps
}

/** Корень репозитория ищем по маркерам, а не берём cwd как есть — та же
    логика, что в test/norms.test.ts. */
function findRepoRoot(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 12; i++) {
    if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'data'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`Не удалось найти корень репозитория (package.json + data/) вверх от ${startDir}`)
}

const REPO_ROOT = findRepoRoot(process.cwd())
const FIXTURE_DIR = path.join(REPO_ROOT, 'test', 'fixtures', 'fdc-mini')

function realProducts(): ProductIndex {
  const file = path.join(REPO_ROOT, 'data', 'products.yaml')
  return parseProducts(readFileSync(file, 'utf8'))
}

function productByFdcId(products: ProductIndex, fdcId: number): Product {
  for (const p of products.values()) {
    if (p.fdcId === fdcId) return p
  }
  throw new Error(`В data/products.yaml нет продукта с fdcId ${fdcId} — фикстура и справочник разошлись`)
}

interface Tables {
  foods: Map<string, { description: string; categoryId: string }>
  categories: Map<string, string>
  nutrientsById: Map<string, Record<string, number>>
}

async function loadFixtureTables(idSet: Set<string>): Promise<Tables> {
  const foods = await loadFoods(FIXTURE_DIR)
  const categories = await loadCategories(FIXTURE_DIR)
  const nutrientsById = await loadNutrientsFor(FIXTURE_DIR, idSet)
  return { foods, categories, nutrientsById }
}

// ---- resolveSpec на одном компоненте: сверка с products.yaml ---------------

async function salmon100gMatchesProductsYamlChecks(): Promise<void> {
  const products = realProducts()
  const salmon = productByFdcId(products, 175167)

  const tables = await loadFixtureTables(new Set(['175167']))
  const result = resolveSpec({ title: 'лосось', components: [{ fdcId: 175167, grams: 100 }] }, tables)

  assert(approx(result.kbju.kcal, salmon.per100.kcal), `kcal ожидался ${salmon.per100.kcal}, получено ${result.kbju.kcal}`)
  assert(approx(result.kbju.p, salmon.per100.p), `p ожидался ${salmon.per100.p}, получено ${result.kbju.p}`)
  assert(approx(result.kbju.f, salmon.per100.f), `f ожидался ${salmon.per100.f}, получено ${result.kbju.f}`)
  assert(approx(result.kbju.c, salmon.per100.c), `c ожидался ${salmon.per100.c}, получено ${result.kbju.c}`)
  assert(result.source === SOURCE, `source ожидался «${SOURCE}», получено «${result.source}»`)

  for (const key of NUTRIENT_KEYS) {
    const expected = salmon.micro100[key]
    const actual = result.nutrients[key]
    if (expected === undefined) {
      assert(actual.known === 0, `${key}: у лосося в датасете нет строки, known должен быть 0, получено ${actual.known}`)
    } else {
      assert(actual.known === 1, `${key}: ожидался known=1, получено ${actual.known}`)
      assert(approx(actual.value, expected), `${key}: ожидалось ${expected}, получено ${actual.value}`)
    }
  }
  group('resolveSpec: лосось 175167, 100 г — числа совпадают с products.yaml (КБЖУ и все 40 ключей micro)')
}

async function scalesLinearlyChecks(): Promise<void> {
  const products = realProducts()
  const salmon = productByFdcId(products, 175167)
  const tables = await loadFixtureTables(new Set(['175167']))

  const result = resolveSpec({ title: 'лосось', components: [{ fdcId: 175167, grams: 250 }] }, tables)
  assert(approx(result.kbju.kcal, salmon.per100.kcal * 2.5), `kcal при 250 г ожидался ${salmon.per100.kcal * 2.5}, получено ${result.kbju.kcal}`)
  assert(approx(result.nutrients.epa.value, salmon.micro100.epa! * 2.5), `epa при 250 г ожидался ${salmon.micro100.epa! * 2.5}, получено ${result.nutrients.epa.value}`)
  group('resolveSpec: 250 г масштабирует КБЖУ и нутриенты ровно в 2.5 раза')
}

// ---- два компонента: known/total считаются по позициям, не по нутриенту ---

/* Ни у одного из трёх продуктов fdc-mini (лосось/яйцо/банан) в датасете нет
   ни одной дыры среди 40 ключей — проверено отдельно (loadNutrientsFor на
   фикстуре, сверка с MICRO_NUTRIENT_IDS). Значит на реальных строках
   fdc-mini поведение «нутриент известен не всем позициям» не воспроизвести
   без добавления четвёртого продукта. Здесь — тот же приём, что и в
   test/nutrition.test.ts (product()/products()): resolveSpec — чистая
   функция, и синтетические таблицы той же формы, что дают loadFoods/
   loadCategories/loadNutrientsFor, проверяют именно её арифметику, а не
   содержимое конкретной выгрузки. */
async function twoComponentsKnownTotalChecks(): Promise<void> {
  const foods = new Map([
    ['1', { description: 'Food A', categoryId: '1' }],
    ['2', { description: 'Food B', categoryId: '1' }]
  ])
  const categories = new Map([['1', 'Test Category']])
  const nutrientsById = new Map([
    // '1278' — id ЭПК (epa); у первой позиции строка есть, у второй — нет.
    ['1', { '1008': 100, '1003': 0, '1004': 0, '1005': 0, '1278': 2 }],
    ['2', { '1008': 100, '1003': 0, '1004': 0, '1005': 0 }]
  ])
  const spec = { title: 'a+b', components: [{ fdcId: 1, grams: 100 }, { fdcId: 2, grams: 100 }] }
  const result = resolveSpec(spec, { foods, categories, nutrientsById })

  assert(result.components.length === 2, `ожидалось 2 компонента, получено ${result.components.length}`)
  assert(result.nutrients.epa.total === 2, `epa.total ожидался 2 (обе позиции вошли в сумму), получено ${result.nutrients.epa.total}`)
  assert(result.nutrients.epa.known === 1, `epa.known ожидался 1 (знает только первая позиция), получено ${result.nutrients.epa.known}`)
  assert(approx(result.nutrients.epa.value, 2), `epa.value ожидался вклад только первой позиции (2), получено ${result.nutrients.epa.value}`)

  // ключ, отсутствующий у обеих позиций, обязан дать known=0 при total=2 — не ноль-заглушка
  assert(result.nutrients.fiber.known === 0 && result.nutrients.fiber.total === 2,
    `fiber ожидался known=0,total=2, получено ${JSON.stringify(result.nutrients.fiber)}`)

  group('resolveSpec: два компонента — total считает обе позиции, known только там, где нутриент реально известен')
}

// ---- отказы ------------------------------------------------------------

async function unknownFdcIdChecks(): Promise<void> {
  const tables = await loadFixtureTables(new Set(['999999999']))
  let threw = false
  try {
    resolveSpec({ title: 'выдумка', components: [{ fdcId: 999999999, grams: 100 }] }, tables)
  } catch (e) {
    threw = true
    assert(e instanceof FoodDataError, `ожидалась FoodDataError, получено ${e instanceof Error ? e.constructor.name : String(e)}`)
    const msg = e instanceof Error ? e.message : String(e)
    assert(msg.includes('999999999'), `сообщение об ошибке должно называть fdcId, получено «${msg}»`)
  }
  assert(threw, 'неизвестный fdcId обязан приводить к отказу, а не к тихому результату')
  group('resolveSpec: неизвестный fdcId — отказ FoodDataError с именем id')
}

async function zeroGramsChecks(): Promise<void> {
  const tables = await loadFixtureTables(new Set(['175167']))
  let threw = false
  try {
    resolveSpec({ title: 'лосось', components: [{ fdcId: 175167, grams: 0 }] }, tables)
  } catch (e) {
    threw = true
    assert(e instanceof FoodSpecError, `ожидалась FoodSpecError, получено ${e instanceof Error ? e.constructor.name : String(e)}`)
  }
  assert(threw, 'grams: 0 обязан приводить к отказу — нулевая порция не имеет смысла')
  group('resolveSpec: grams: 0 — отказ FoodSpecError')
}

async function main(): Promise<void> {
  console.log('food-resolve — resolveSpec на fdc-mini, сверка с data/products.yaml')
  await salmon100gMatchesProductsYamlChecks()
  await scalesLinearlyChecks()
  await twoComponentsKnownTotalChecks()
  await unknownFdcIdChecks()
  await zeroGramsChecks()
  console.log(`\nВсе проверки food-resolve пройдены (${passed} групп).`)
}

main().catch((e) => {
  console.error('\n✗ ТЕСТ FOOD-RESOLVE УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
})
