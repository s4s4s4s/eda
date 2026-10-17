/**
 * Тесты scripts/resolve-product.mjs на фикстуре fdc-mini и
 * test/fixtures/product-spec.json (Snickers из Open Food Facts). Резолвер
 * запускается как процесс, ровно так, как его зовёт раннер.
 *
 * Сборка и запуск - как у остальных test:* в package.json:
 *   esbuild test/product-resolve.test.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.cache/eda/product-resolve.mjs && node node_modules/.cache/eda/product-resolve.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

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

const ROOT = findRepoRoot(process.cwd())
const FDC = path.join(ROOT, 'test', 'fixtures', 'fdc-mini')
const SCRIPT = path.join(ROOT, 'scripts', 'resolve-product.mjs')
const readFixture = (name: string) => JSON.parse(readFileSync(path.join(ROOT, 'test', 'fixtures', name), 'utf8'))
const baseSpec = readFixture('product-spec.json')
const emptySpec = readFixture('product-spec-empty.json')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

interface Run { code: number | null; stdout: string; stderr: string; out: Json }

function runWith(fdcDir: string, input: string): Run {
  const r = spawnSync(process.execPath, [SCRIPT, '--fdc', fdcDir], { input, encoding: 'utf8', cwd: ROOT })
  let out: Json = null
  try { out = JSON.parse(r.stdout) } catch { /* stdout пуст при сбое скрипта */ }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out }
}

function run(spec: unknown): Run {
  return runWith(FDC, JSON.stringify(spec))
}

function withProduct(spec: Json, over: Json): Json {
  return { ...spec, product: { ...spec.product, ...over } }
}

function main(): void {
  console.log('product-resolve: resolve-product.mjs на fdc-mini')

  // CLI: одна строка JSON, spec 3, source с USDA, kbju = per100 x 50 / 100
  const cli = run(baseSpec)
  assert.equal(cli.code, 0, cli.stderr)
  assert.equal(cli.stdout.trim().split('\n').length, 1)
  assert.equal(cli.out.ok, true)
  assert.equal(cli.out.spec, 3)
  assert.equal(cli.out.source, 'Open Food Facts + USDA SR Legacy 2018-04')
  assert.deepStrictEqual(cli.out.kbju, { kcal: 240.5, p: 4.3, f: 11.25, c: 30.25 })
  assert.deepStrictEqual(cli.out.product.perPortion, cli.out.kbju)
  assert.equal(cli.out.product.grams, 50)
  assert.equal(cli.out.product.code, '5000159461122')
  assert.equal(cli.out.product.remark, baseSpec.remark)
  assert.equal(cli.out.components.length, baseSpec.components.length)
  group('resolveProduct: spec 3, source с USDA, kbju = per100 x 50 / 100 с округлением до 2 знаков')

  // напечатанное перекрывает USDA
  const pm = baseSpec.product.printedMicro
  for (const key of ['fiber', 'sodium', 'cholesterol', 'sugar', 'satFat']) {
    const expected = Math.round((pm[key] * 50) / 100 * 1000) / 1000
    assert.deepStrictEqual(cli.out.nutrients[key], { value: expected, known: 1, total: 1 }, key)
  }
  assert.equal(cli.out.nutrients.fiber.value, 2.15)
  assert.equal(cli.out.nutrients.sodium.value, 125.75)
  assert.equal(cli.out.nutrients.cholesterol.value, 3.35)
  group('resolveProduct: fiber/sodium/cholesterol перекрыты напечатанным: value = printed x 0.5 (3 знака), known 1, total 1')

  // ключи без напечатанного берутся из состава
  const nonPrinted = Object.keys(cli.out.nutrients).filter((k) => !(k in pm))
  assert.equal(nonPrinted.length, 35)
  for (const k of nonPrinted) assert.equal(cli.out.nutrients[k].total, cli.out.components.length, k)
  assert.equal(cli.out.nutrients.calcium.known, 3)
  assert.ok(cli.out.nutrients.calcium.value > 0)
  assert.equal(cli.out.nutrients.vitC.known, 3)
  group('resolveProduct: ключ без напечатанного берётся из состава')

  // fit присутствует
  assert.equal(typeof cli.out.fit.poor, 'boolean')
  assert.ok(cli.out.fit.usdaKbju.kcal > 0)
  group('resolveProduct: fit присутствует')

  // пустые components
  const empty = run(emptySpec)
  assert.equal(empty.code, 0, empty.stdout)
  assert.equal(empty.out.source, 'Open Food Facts')
  assert.deepStrictEqual(empty.out.components, [])
  assert.equal('fit' in empty.out, false)
  assert.deepStrictEqual(empty.out.kbju, cli.out.kbju)
  for (const k of Object.keys(empty.out.nutrients)) {
    const expected = k in pm
      ? { value: Math.round((pm[k] * 50) / 100 * 1000) / 1000, known: 1, total: 1 }
      : { value: 0, known: 0, total: 1 }
    assert.deepStrictEqual(empty.out.nutrients[k], expected, k)
  }
  assert.equal(run({ ...emptySpec, components: undefined }).code, 0)
  group('resolveProduct: пустые components -> source "Open Food Facts", nutrients known 0 total 1 кроме напечатанных, fit отсутствует')

  // отказы с кодом 2
  const noGrams = { ...baseSpec }
  delete noGrams.grams
  for (const bad of [noGrams, { ...baseSpec, grams: 0 }, { ...baseSpec, grams: 5001 }, { ...baseSpec, grams: '50' }]) {
    const r = run(bad)
    assert.equal(r.code, 2, r.stdout)
    assert.equal(r.out.ok, false)
  }
  assert.ok(run(noGrams).out.error.includes('grams'))
  const zeroMicro = run(withProduct(baseSpec, { printedMicro: { ...pm, sugar: 0 } }))
  assert.equal(zeroMicro.code, 2)
  assert.ok(zeroMicro.out.error.includes('printedMicro.sugar'), zeroMicro.out.error)
  const foreignKey = run(withProduct(baseSpec, { printedMicro: { ...pm, vitC: 5 } }))
  assert.equal(foreignKey.code, 2)
  assert.ok(foreignKey.out.error.includes('vitC'), foreignKey.out.error)
  assert.equal(run(withProduct(baseSpec, { code: 'abc' })).code, 2)
  assert.equal(run(withProduct(baseSpec, { per100: { kcal: 1, p: 1, f: -1, c: 1 } })).code, 2)
  assert.equal(run(withProduct(baseSpec, { per100: { kcal: 1, p: 1, f: 1 } })).code, 2)
  assert.equal(run({ ...baseSpec, product: undefined }).code, 2)
  assert.equal(run({ ...baseSpec, title: ' ' }).code, 2)
  assert.equal(run({ ...baseSpec, components: [{ fdcId: 999999999, grams: 10 }] }).code, 2)
  group('resolveProduct: без grams -> FoodSpecError; printedMicro с нулём -> FoodSpecError; чужой ключ printedMicro -> FoodSpecError')

  // детерминизм: два запуска байт в байт
  assert.equal(run(baseSpec).stdout, cli.stdout)
  group('resolveProduct: детерминирован')

  // фикстура совпадает с выводом резолвера плюс request
  const stored = readFixture('product-result.json')
  assert.deepStrictEqual(stored, { ...cli.out, request: { text: '', grams: 50 } })
  group('resolveProduct: результат совпадает с product-result.json без request')

  // битый stdin: код 2
  const broken = runWith(FDC, '{не json')
  assert.equal(broken.code, 2)
  assert.equal(broken.out.ok, false)
  group('CLI: битый stdin -> код 2 и {ok:false}')

  // сбой скрипта: нет выгрузки, код 1, stdout пуст
  const noDir = runWith(path.join(ROOT, 'test', 'fixtures', 'нет-такой-выгрузки'), JSON.stringify(baseSpec))
  assert.equal(noDir.code, 1)
  assert.equal(noDir.stdout, '')
  group('CLI: нет каталога выгрузки -> код 1, stdout пуст')

  console.log(`\nВсе проверки product-resolve пройдены (${passed} групп).`)
}

try {
  main()
} catch (e) {
  console.error('\nТЕСТ PRODUCT-RESOLVE УПАЛ:\n' + (e instanceof Error ? e.stack : String(e)))
  process.exit(1)
}
