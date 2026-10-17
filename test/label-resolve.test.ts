/**
 * Тесты scripts/resolve-label.mjs (CLI) на фикстуре fdc-mini и
 * test/fixtures/label-spec.json. Резолвер запускается как процесс, ровно так,
 * как его зовёт раннер.
 *
 * Сборка и запуск - как у остальных test:* в package.json:
 *   esbuild test/label-resolve.test.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.cache/eda/label-resolve.mjs && node node_modules/.cache/eda/label-resolve.mjs
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
const SCRIPT = path.join(ROOT, 'scripts', 'resolve-label.mjs')
const baseSpec = JSON.parse(readFileSync(path.join(ROOT, 'test', 'fixtures', 'label-spec.json'), 'utf8'))
const SALMON = { fdcId: 175167, grams: 150 }
const BANANA = { fdcId: 173944, grams: 100 }

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

function withSpec(over: Json): Json {
  return { ...baseSpec, ...over }
}

function main(): void {
  console.log('label-resolve: resolve-label.mjs на fdc-mini')

  // CLI: одна строка JSON, код 0, dishNo и printed проходят
  const cli = run(baseSpec)
  assert.equal(cli.code, 0, cli.stderr)
  assert.equal(cli.stdout.trim().split('\n').length, 1)
  assert.equal(cli.out.ok, true)
  assert.equal(cli.out.spec, 2)
  assert.equal(cli.out.source, 'Наклейка + USDA SR Legacy 2018-04')
  assert.equal(cli.out.label.dishNo, 3)
  assert.equal(cli.out.label.portionG, 370)
  assert.deepStrictEqual(cli.out.label.printed, { kcal: 442.1, p: 47.7, f: 19.7, c: 18.5 })
  assert.equal(cli.out.label.ingredients.length, 15)
  group('CLI: одна строка JSON, код 0, dishNo и printed проходят')

  // kbju равно perPortion; basis portion: perPortion равно printed
  assert.deepStrictEqual(cli.out.kbju, cli.out.label.perPortion)
  assert.deepStrictEqual(cli.out.kbju, cli.out.label.printed)
  group('kbju равно perPortion (basis portion: напечатанному)')

  // nutrients.total равно числу компонентов по каждому ключу
  const keys = Object.keys(cli.out.nutrients)
  assert.equal(keys.length, 40)
  for (const k of keys) assert.equal(cli.out.nutrients[k].total, cli.out.components.length, k)
  group('nutrients.total равно числу компонентов по каждому из 40 ключей')

  // fit присутствует
  assert.equal(typeof cli.out.fit.poor, 'boolean')
  assert.ok(cli.out.fit.usdaKbju.kcal > 0)
  group('fit присутствует')

  // детерминизм: два запуска байт в байт
  assert.equal(run(baseSpec).stdout, cli.stdout)
  group('два запуска дают байт в байт один вывод')

  // dishNo вне диапазона, не целое или отсутствует: null, наклейка не отклоняется
  for (const bad of [0, 13, 2.5, '3', null]) {
    const r = run(withSpec({ dishNo: bad }))
    assert.equal(r.code, 0)
    assert.equal(r.out.label.dishNo, null)
  }
  const noDish = { ...baseSpec }
  delete noDish.dishNo
  assert.equal(run(noDish).out.label.dishNo, null)
  group('dishNo вне 1..12, не целое или отсутствует даёт null')

  // 100g с portionG 350: perPortion = printed * 3.5
  const per100 = run(withSpec({ portionG: 350, label: { basis: '100g', kcal: 120, p: 10, f: 4, c: 8 }, components: [SALMON, BANANA] }))
  assert.equal(per100.code, 0, per100.stdout)
  assert.deepStrictEqual(per100.out.label.perPortion, { kcal: 420, p: 35, f: 14, c: 28 })
  assert.deepStrictEqual(per100.out.kbju, per100.out.label.perPortion)
  group('basis 100g с portionG 350: perPortion равно printed * 3.5')

  // 100g без portionG и grams, но с составом: масса равна сумме граммов
  const label100 = { basis: '100g', kcal: 100, p: 10, f: 5, c: 20 }
  const sumMass = run(withSpec({ portionG: null, label: label100, components: [SALMON, BANANA] }))
  assert.equal(sumMass.code, 0, sumMass.stdout)
  assert.deepStrictEqual(sumMass.out.label.perPortion, { kcal: 250, p: 25, f: 12.5, c: 50 })
  group('basis 100g без веса, но с составом: масса равна сумме граммов')

  // запасной вес grams приоритетнее суммы граммов
  const fallback = run(withSpec({ portionG: null, grams: 200, label: label100, components: [SALMON, BANANA] }))
  assert.deepStrictEqual(fallback.out.label.perPortion, { kcal: 200, p: 20, f: 10, c: 40 })
  group('запасной вес grams приоритетнее суммы граммов')

  // без веса и без состава: код 2 и текст про вес
  const noMass = run(withSpec({ portionG: null, label: label100, components: [] }))
  assert.equal(noMass.code, 2)
  assert.equal(noMass.out.ok, false)
  assert.ok(noMass.out.error.includes('вес порции неизвестен'), noMass.out.error)
  group('basis 100g без веса и состава: код 2 с текстом про вес')

  // пустой состав при basis portion: нули, fit отсутствует
  const empty = run(withSpec({ components: [] }))
  assert.equal(empty.code, 0, empty.stdout)
  assert.deepStrictEqual(empty.out.components, [])
  assert.equal('fit' in empty.out, false)
  assert.deepStrictEqual(empty.out.kbju, empty.out.label.printed)
  for (const k of Object.keys(empty.out.nutrients)) {
    assert.deepStrictEqual(empty.out.nutrients[k], { value: 0, known: 0, total: 0 }, k)
  }
  group('пустой состав: все known 0 и total 0, fit отсутствует')

  // отказы: неизвестный fdcId, плохой basis, отрицательные числа, нет label, битый JSON
  assert.equal(run(withSpec({ components: [{ fdcId: 999999999, grams: 100 }] })).code, 2)
  assert.equal(run(withSpec({ label: { basis: 'kg', kcal: 1, p: 1, f: 1, c: 1 } })).code, 2)
  assert.equal(run(withSpec({ label: { basis: 'portion', kcal: -1, p: 1, f: 1, c: 1 } })).code, 2)
  assert.equal(run(withSpec({ label: undefined })).code, 2)
  const broken = runWith(FDC, '{не json')
  assert.equal(broken.code, 2)
  assert.equal(broken.out.ok, false)
  group('честные отказы с кодом 2: fdcId, basis, отрицательные числа, нет label, битый JSON')

  // сбой скрипта: нет выгрузки, код 1, stdout пуст
  const noDir = runWith(path.join(ROOT, 'test', 'fixtures', 'нет-такой-выгрузки'), JSON.stringify(baseSpec))
  assert.equal(noDir.code, 1)
  assert.equal(noDir.stdout, '')
  group('нет каталога выгрузки: код 1, stdout пуст')

  // фикстура label-result.json совпадает с выводом резолвера плюс request
  const stored = JSON.parse(readFileSync(path.join(ROOT, 'test', 'fixtures', 'label-result.json'), 'utf8'))
  assert.deepStrictEqual(stored, { ...cli.out, request: { text: '', grams: null } })
  group('label-result.json соответствует выводу резолвера на label-spec.json')

  console.log(`\nВсе проверки label-resolve пройдены (${passed} групп).`)
}

try {
  main()
} catch (e) {
  console.error('\nТЕСТ LABEL-RESOLVE УПАЛ:\n' + (e instanceof Error ? e.stack : String(e)))
  process.exit(1)
}
