/**
 * Тесты подгонки граммов под КБЖУ наклейки (scripts/lib/label-fit.mjs) на
 * настоящих строках USDA из test/fixtures/fdc-mini: лосось 175167 и банан 173944.
 *
 * Сборка и запуск - как у остальных test:* в package.json:
 *   esbuild test/label-fit.test.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.cache/eda/label-fit.mjs && node node_modules/.cache/eda/label-fit.mjs
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

// @ts-expect-error - .mjs без деклараций типов, тест проверяет поведение по значениям
import { loadFoods, loadCategories, loadNutrientsFor, resolveSpec } from '../scripts/lib/usda.mjs'
// @ts-expect-error - .mjs без деклараций типов
import { fitGrams } from '../scripts/lib/label-fit.mjs'

interface Kbju { kcal: number; p: number; f: number; c: number }
interface Comp { fdcId: number; grams: number; per100: { kbju: Kbju } }

let passed = 0
function group(name: string): void { console.log(`  ok ${name}`); passed++ }

function findRepoRoot(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 12; i++) {
    if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'data'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`Не удалось найти корень репозитория вверх от ${startDir}`)
}

const FIXTURE_DIR = path.join(findRepoRoot(process.cwd()), 'test', 'fixtures', 'fdc-mini')
const SALMON = 175167
const BANANA = 173944

async function components(grams: [number, number]): Promise<Comp[]> {
  const tables = {
    foods: await loadFoods(FIXTURE_DIR),
    categories: await loadCategories(FIXTURE_DIR),
    nutrientsById: await loadNutrientsFor(FIXTURE_DIR, new Set([String(SALMON), String(BANANA)])),
  }
  const res = resolveSpec({
    title: 't',
    components: [{ fdcId: SALMON, grams: grams[0] }, { fdcId: BANANA, grams: grams[1] }],
  }, tables)
  return res.components as Comp[]
}

function totals(comps: Comp[], grams: number[]): Kbju {
  const t = { kcal: 0, p: 0, f: 0, c: 0 }
  comps.forEach((c, i) => {
    for (const k of ['kcal', 'p', 'f', 'c'] as const) t[k] += (c.per100.kbju[k] * grams[i]) / 100
  })
  return t
}

function relErr(actual: number, wanted: number): number {
  return Math.abs(actual - wanted) / wanted
}

async function main(): Promise<void> {
  console.log('label-fit: подгонка граммов под КБЖУ наклейки')
  const truth = await components([150, 100])
  const target = totals(truth, [150, 100])
  const start = await components([100, 150])

  // (а) старт 100/150 восстанавливает истинные 150/100 с точностью 3 %
  const fitted = fitGrams(start, target, 250)
  assert.ok(fitted)
  assert.ok(relErr(fitted.grams[0], 150) < 0.03, `лосось: ${fitted.grams[0]}`)
  assert.ok(relErr(fitted.grams[1], 100) < 0.03, `банан: ${fitted.grams[1]}`)
  assert.equal(fitted.fit.poor, false)
  group('восстановление граммов 150/100 из старта 100/150')

  // (б) масса соблюдена в пределах 2 %
  const sum = fitted.grams[0] + fitted.grams[1]
  assert.ok(relErr(sum, 250) < 0.02, `масса ${sum}`)
  assert.ok(Math.abs(fitted.fit.massDeviationPct) < 2)
  group('масса состава в пределах 2 % от веса порции')

  // (в) заведомо несовместимая цель: граммы остаются в границах, poor === true
  const absurd = { kcal: 5000, p: 1, f: 1, c: 1 }
  const clamped = fitGrams(start, absurd, 250)
  assert.ok(clamped)
  start.forEach((c, i) => {
    assert.ok(clamped.grams[i] >= Math.max(1, 0.2 * c.grams) - 1e-9, `нижняя граница ${i}`)
    assert.ok(clamped.grams[i] <= 4 * c.grams + 1e-9, `верхняя граница ${i}`)
  })
  assert.equal(clamped.fit.poor, true)
  group('границы [0.2*g0, 4*g0] и poor на несовместимой цели')

  // (г) детерминизм
  assert.deepStrictEqual(fitGrams(start, target, 250), fitGrams(start, target, 250))
  group('два вызова дают одинаковый результат')

  // (д) пустой состав
  assert.equal(fitGrams([], target, 250), null)
  group('пустой состав даёт null')

  // без массы подгонка идёт только по КБЖУ и не падает
  const noMass = fitGrams(start, target, null)
  assert.ok(noMass)
  assert.equal(noMass.fit.massDeviationPct, null)
  group('без массы порции massDeviationPct равен null')

  console.log(`\nВсе проверки label-fit пройдены (${passed} групп).`)
}

main().catch((e) => {
  console.error('\nТЕСТ LABEL-FIT УПАЛ:\n' + (e instanceof Error ? e.stack : String(e)))
  process.exit(1)
})
