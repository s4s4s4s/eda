/**
 * Тесты суточных норм: разбор data/norms.yaml (parseNorms в src/core/data.ts)
 * и счёт покрытия (src/core/norms.ts).
 *
 * Здесь, в отличие от data.test.ts, реальный файл данных читается с диска
 * намеренно: половина смысла задачи — состав самих норм (для каких ключей они
 * заданы, а для каких сознательно не заданы), и проверять это на синтетической
 * фикстуре бессмысленно. Битые случаи по-прежнему задаются YAML в коде теста.
 *
 * Сборка и запуск (тем же способом, что и остальные test:* в package.json):
 *   esbuild test/norms.test.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.cache/eda/norms.mjs && node node_modules/.cache/eda/norms.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import yaml from 'js-yaml'

import { parseNorms } from '../src/core/data'
import { normRatio, nutrientCoverage } from '../src/core/norms'
import { emptyNutrientTotals } from '../src/core/nutrition'
import { NUTRIENT_GROUP, NUTRIENT_KEYS, NUTRIENT_UNIT } from '../src/core/types'
import type { NutrientCoverage } from '../src/core/norms'
import type { NutrientKey, NutrientNorms, NutrientTotals } from '../src/core/types'

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

/** Корень репозитория ищем по маркерам, а не берём cwd как есть: тест могут
    запустить из подкаталога, и «файл не найден» тогда выглядел бы как красный
    тест по существу. Та же логика, что в scripts/check-menu.ts. */
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

function realNorms(): NutrientNorms {
  const file = path.join(findRepoRoot(process.cwd()), 'data', 'norms.yaml')
  return parseNorms(readFileSync(file, 'utf8'))
}

/** Сумма для теста: ключи, которых нет в аргументе, остаются без данных
    (known === 0) — ровно так же, как их отдаёт настоящий счёт. */
function totalsOf(entries: Partial<Record<NutrientKey, { value: number; known: number; total: number }>>): NutrientTotals {
  const totals = emptyNutrientTotals()
  for (const [key, total] of Object.entries(entries)) {
    totals[key as NutrientKey] = total!
  }
  return totals
}

function row(rows: NutrientCoverage[], key: NutrientKey): NutrientCoverage {
  const found = rows.find(r => r.key === key)
  assert(found !== undefined, `в результате нет строки «${key}»`)
  return found!
}

// ---- состав data/norms.yaml -------------------------------------------------

const WITHOUT_NORM: readonly NutrientKey[] = [
  'sugar', 'satFat', 'monoFat', 'polyFat', 'cholesterol',
  'epa', 'dha', 'retinol',
  'betaCarotene', 'alphaCarotene', 'betaCryptoxanthin', 'lycopene', 'luteinZeaxanthin'
]

function fileContentChecks(): void {
  const norms = realNorms()
  const keys = Object.keys(norms)

  assert(keys.length === 27, `в norms.yaml ожидалось 27 норм, получено ${keys.length}: ${keys.join(', ')}`)
  group('norms.yaml: нормы заданы ровно для 27 нутриентов')

  for (const key of WITHOUT_NORM) {
    assert(norms[key] === undefined, `у «${key}» нормы быть не должно, а она есть`)
  }
  assert(keys.length + WITHOUT_NORM.length === NUTRIENT_KEYS.length,
    `сумма «с нормой» и «без нормы» должна давать все ${NUTRIENT_KEYS.length} ключей`)
  group('norms.yaml: у сахаров, насыщенных/моно-/полиненасыщенных жиров, холестерина, ЭПК, ДГК, ретинола и каротиноидов нормы нет — и это не ноль')

  const allowed = new Set<string>(NUTRIENT_KEYS)
  for (const key of keys) {
    assert(allowed.has(key), `ключ «${key}» отсутствует в NUTRIENT_KEYS — единица нормы не определена`)
  }
  group('norms.yaml: каждый ключ норм входит в NUTRIENT_KEYS (единица берётся из NUTRIENT_UNIT)')

  // parseNorms уже сверяет unit с NUTRIENT_UNIT и падает при расхождении (см.
  // brokenYamlChecks), но проверяет по одной записи за раз изнутри парсера —
  // на выходе поле unit не хранится (оно контрольная сумма, а не данные).
  // Здесь читаем реальный файл напрямую и сверяем unit КАЖДОЙ записи, чтобы
  // тест ловил рассинхрон (в т.ч. промах в 1000 раз, как было с медью) сам,
  // а не полагался на то, что через parseNorms когда-нибудь пройдёт плохое
  // значение и он вспомнит проверить.
  const file = path.join(findRepoRoot(process.cwd()), 'data', 'norms.yaml')
  const rawFile = yaml.load(readFileSync(file, 'utf8')) as { norms: Record<string, { unit?: string }> }
  for (const key of keys) {
    const rawUnit = rawFile.norms[key]?.unit
    const expected = NUTRIENT_UNIT[key as NutrientKey]
    assert(rawUnit === expected,
      `«${key}»: unit в norms.yaml (${String(rawUnit)}) должен совпадать с NUTRIENT_UNIT (${expected}) — иначе повторится история с медью`)
  }
  group('norms.yaml: unit каждой записи в файле совпадает с NUTRIENT_UNIT (контрольная сумма против промаха в 1000 раз)')

  const sodium = norms.sodium
  assert(sodium !== undefined, 'у натрия должна быть норма')
  assert(sodium!.amount === 1500 && sodium!.basis === 'ai', `натрий: ожидалось 1500 ai, получено ${sodium!.amount} ${sodium!.basis}`)
  assert(sodium!.cdrr === 2300, `натрий: cdrr должен быть 2300, получено ${String(sodium!.cdrr)}`)
  assert(sodium!.ul === undefined, 'натрий: верхнего предела ul в DRI нет, он не должен появляться из воздуха')
  assert(typeof sodium!.note === 'string' && sodium!.note!.length > 0, 'натрий: должна быть оговорка про CDRR')
  group('norms.yaml: у натрия прочитан cdrr 2300, а ul отсутствует')

  /* Предел записывается ТОЛЬКО если источник относит его к суммарному
     потреблению. Пределы, заданные на добавки, обогащённые продукты или на
     отдельную форму нутриента, к съеденной еде неприменимы: сравнение с ними
     покрасило бы полосу без основания. Правило проверяется списком, а не одним
     магнием, — иначе следующий «дозаполненный для полноты» предел снова
     пройдёт молча. */
  const UL_NOT_APPLICABLE: { key: NutrientKey; why: string }[] = [
    { key: 'magnesium', why: 'предел 350 мг относится к магнию из препаратов, а не из еды' },
    { key: 'vitA', why: 'предел 3000 мкг относится только к готовому ретинолу, а не к сумме RAE' },
    { key: 'vitE', why: 'предел 1000 мг относится к синтетическому альфа-токоферолу из добавок' },
    { key: 'niacin', why: 'предел 35 мг относится к ниацину из добавок и обогащённых продуктов' },
    { key: 'folate', why: 'предел 1000 мкг относится к синтетической фолиевой кислоте, а не к фолату еды' }
  ]
  for (const { key, why } of UL_NOT_APPLICABLE) {
    const norm = norms[key]
    assert(norm !== undefined, `${key}: норма должна быть в файле`)
    assert(norm!.ul === undefined, `${key}: ${why} — в данные он попадать не должен`)
    assert(typeof norm!.note === 'string' && norm!.note!.length > 0,
      `${key}: раз предел не записан, причина обязана быть названа в note — иначе его вернут «для полноты»`)
  }
  assert(norms.vitA!.amount === 900 && norms.vitA!.basis === 'rda',
    'витамин A: норма 900 мкг RAE (rda) должна остаться на месте')
  assert(norms.water !== undefined && norms.water!.comparable === false, 'вода: должна быть помечена как несравнимая')
  assert(norms.calcium !== undefined && norms.calcium!.comparable === true, 'кальций: comparable по умолчанию — true')
  group('norms.yaml: comparable по умолчанию true, у воды — false; неприменимые к еде верхние пределы не записаны')

  assert(NUTRIENT_GROUP.vitC === 'витамины' && NUTRIENT_GROUP.calcium === 'минералы' && NUTRIENT_GROUP.water === 'прочее',
    'NUTRIENT_GROUP: витамин C — витамины, кальций — минералы, вода — прочее')
  assert(NUTRIENT_KEYS.every(k => NUTRIENT_GROUP[k] !== undefined), `NUTRIENT_GROUP должен покрывать все ${NUTRIENT_KEYS.length} ключей`)
  group(`types: группа задана для всех ${NUTRIENT_KEYS.length} нутриентов`)
}

// ---- отсутствие данных не превращается в ноль -------------------------------

function noDataChecks(): void {
  const norms = realNorms()
  const rows = nutrientCoverage(emptyNutrientTotals(), norms)

  assert(rows.length === NUTRIENT_KEYS.length, `ожидалось ${NUTRIENT_KEYS.length} строк, получено ${rows.length}`)
  assert(rows.every((r, i) => r.key === NUTRIENT_KEYS[i]), 'порядок строк должен совпадать с NUTRIENT_KEYS')
  group(`nutrientCoverage: все ${NUTRIENT_KEYS.length} ключей всегда на месте и в порядке NUTRIENT_KEYS`)

  const calcium = row(rows, 'calcium')
  assert(calcium.value === null, `known === 0 должен давать value null, получено ${String(calcium.value)}`)
  assert(calcium.ratio === null, `known === 0 не должен давать ratio, получено ${String(calcium.ratio)}`)
  assert(calcium.ratio !== 0, 'ratio 0 при отсутствии данных — запрещённое чтение «неизвестно» как «ноль»')
  assert(calcium.state === 'no-data', `ожидалось state no-data, получено ${calcium.state}`)
  assert(calcium.norm !== null, 'норма кальция известна и должна отдаваться даже без данных')
  assert(calcium.overUl === false, 'без данных превышения предела быть не может')
  group('nutrientCoverage: known === 0 — это value null и state no-data, а не ratio 0')
}

// ---- честный ноль остаётся нулём --------------------------------------------

function honestZeroChecks(): void {
  const norms = realNorms()
  const rows = nutrientCoverage(totalsOf({ vitC: { value: 0, known: 3, total: 3 } }), norms)
  const vitC = row(rows, 'vitC')

  assert(vitC.value === 0, `измеренный ноль должен остаться нулём, получено ${String(vitC.value)}`)
  assert(vitC.state === 'ok', `измеренный ноль — это состояние ok, получено ${vitC.state}`)
  assert(vitC.ratio === 0, `ratio измеренного нуля — 0, получено ${String(vitC.ratio)}`)
  assert(vitC.partial === false, 'полная сумма не должна помечаться как частичная')
  group('nutrientCoverage: записанный в датасете ноль отличается от «нет данных» — value 0 и state ok')
}

// ---- частичная сумма ---------------------------------------------------------

function partialChecks(): void {
  const norms = realNorms()
  const rows = nutrientCoverage(totalsOf({ iron: { value: 4, known: 2, total: 5 } }), norms)
  const iron = row(rows, 'iron')

  assert(iron.partial === true, 'known 2 из 5 — это частичная сумма')
  assert(iron.value === 4, `значение частичной суммы сохраняется, получено ${String(iron.value)}`)
  assert(iron.state === 'ok', `частичность не меняет state, ожидалось ok, получено ${iron.state}`)
  assert(iron.ratio !== null, 'частичная сумма даёт оценку снизу — ratio должен считаться')
  assert(Math.abs(iron.ratio! - 0.5) < 1e-9, `ожидалось ratio 0.5 (4 из 8 мг), получено ${String(iron.ratio)}`)
  assert(iron.known === 2 && iron.total === 5, 'полнота должна доезжать до потребителя как есть')
  group('nutrientCoverage: частичная сумма — это partial true и при этом непустой ratio')
}

// ---- нормы нет и сравнивать нельзя -------------------------------------------

function noNormChecks(): void {
  const norms = realNorms()
  const rows = nutrientCoverage(totalsOf({
    sugar: { value: 71.5, known: 4, total: 4 },
    water: { value: 900, known: 4, total: 4 }
  }), norms)

  const sugar = row(rows, 'sugar')
  assert(sugar.state === 'no-norm', `у сахаров нормы нет, ожидалось no-norm, получено ${sugar.state}`)
  assert(sugar.norm === null, 'норма сахаров должна быть null')
  assert(sugar.ratio === null, 'без нормы процента быть не может')
  assert(sugar.value === 71.5, `значение при отсутствии нормы всё равно показывается, получено ${String(sugar.value)}`)
  group('nutrientCoverage: у сахаров state no-norm, но значение сохраняется')

  const water = row(rows, 'water')
  assert(water.state === 'not-comparable', `вода: ожидалось not-comparable, получено ${water.state}`)
  assert(water.ratio === null, 'воду сравнивать нельзя — ratio должен быть null')
  assert(water.norm !== null && water.norm.amount === 3700, 'норма воды при этом отдаётся: её видно как справку')
  assert(water.value === 900, 'значение воды показывается')
  assert(normRatio(water.norm!, 900) === null, 'normRatio на несравнимой норме тоже обязан вернуть null')
  group('nutrientCoverage: вода — state not-comparable и ratio null при живом значении')
}

// ---- превышение верхнего предела ---------------------------------------------

function overUlChecks(): void {
  const norms = realNorms()
  const rows = nutrientCoverage(totalsOf({
    selenium: { value: 460, known: 6, total: 6 },
    zinc: { value: 39, known: 6, total: 6 }
  }), norms)

  const selenium = row(rows, 'selenium')
  assert(selenium.overUl === true, 'селен 460 мкг выше предела 400 — overUl должен быть true')
  assert(selenium.ratio !== null, 'превышение не отменяет процент')
  assert(selenium.ratio! > 1, `ratio при превышении остаётся больше единицы, получено ${String(selenium.ratio)}`)
  assert(Math.abs(selenium.ratio! - 460 / 55) < 1e-9, `ratio не должен обрезаться сверху: ожидалось ${460 / 55}, получено ${String(selenium.ratio)}`)
  assert(selenium.state === 'ok', 'превышение предела — это не отдельное состояние, а признак overUl')
  group('nutrientCoverage: превышение ul даёт overUl true, ratio считается и остаётся больше единицы')

  const zinc = row(rows, 'zinc')
  assert(zinc.overUl === false, 'цинк 39 мг ниже предела 40 — превышения нет')
  assert(zinc.ratio! > 1, 'при этом норму 11 мг он перекрывает')
  group('nutrientCoverage: значение выше нормы, но ниже предела, превышением не считается')
}

// ---- битые данные не проглатываются -------------------------------------------

function brokenYamlChecks(): void {
  assertThrows(() => parseNorms('norms:\n  iron:\n    amount: 8\n    basis: неизвестно\n    unit: "мг"\n'),
    ['basis', 'rda'], 'parseNorms: basis вне списка — ошибка')

  assertThrows(() => parseNorms('norms:\n  iron:\n    amount: -8\n    basis: rda\n    unit: "мг"\n'),
    ['amount', 'положительным'], 'parseNorms: отрицательный amount — ошибка')

  assertThrows(() => parseNorms('norms:\n  iron:\n    amount: 8\n    basis: rda\n    unit: "мг"\n    ul: 5\n'),
    ['ul', 'меньше'], 'parseNorms: верхний предел ниже нормы — ошибка')

  assertThrows(() => parseNorms('norms:\n  iron:\n    amount: "восемь"\n    basis: rda\n    unit: "мг"\n'),
    ['amount', 'числом'], 'parseNorms: нечисловой amount — ошибка')

  assertThrows(() => parseNorms('norms:\n  vitaminX:\n    amount: 8\n    basis: rda\n    unit: "мг"\n'),
    ['неизвестный нутриент', 'vitaminX'], 'parseNorms: ключ вне NUTRIENT_KEYS — ошибка')

  assertThrows(() => parseNorms('norms:\n  iron:\n    amount: 8\n    basis: rda\n    unit: "мг"\n    comparible: false\n'),
    ['неизвестное поле', 'comparible'], 'parseNorms: опечатка в имени поля — ошибка, а не молчаливый пропуск')

  assertThrows(() => parseNorms('источник: DRI\n'),
    ['norms'], 'parseNorms: нет корневого ключа norms — ошибка')

  const empty = parseNorms('norms: {}\n')
  assert(Object.keys(empty).length === 0, 'пустой список норм — это пустая карта, а не ошибка')
  group('parseNorms: отсутствие нутриента в файле ошибкой не является')

  assertThrows(() => parseNorms('norms:\n  iron:\n    amount: 8\n    basis: rda\n    unit: "мкг"\n'),
    ['unit', 'мг', 'мкг', 'iron'], 'parseNorms: unit не совпадает с NUTRIENT_UNIT — ошибка')

  assertThrows(() => parseNorms('norms:\n  iron:\n    amount: 8\n    basis: rda\n'),
    ['unit', 'мг'], 'parseNorms: unit не задан — ошибка')
}

// ---- медь: регресс по единице измерения --------------------------------------

function copperChecks(): void {
  const norms = realNorms()
  const copper = norms.copper
  assert(copper !== undefined, 'у меди должна быть норма')
  assert(copper!.amount === 0.9, `медь: amount должен быть 0.9 мг (900 мкг DRI), получено ${copper!.amount}`)
  assert(copper!.ul === 10, `медь: ul должен быть 10 мг (10000 мкг DRI), получено ${String(copper!.ul)}`)
  group('norms.yaml: медь задана в мг (0.9 / 10), а не в мкг из источника')
}

function main(): void {
  console.log('norms — суточные нормы: данные, разбор, покрытие')
  fileContentChecks()
  copperChecks()
  noDataChecks()
  honestZeroChecks()
  partialChecks()
  noNormChecks()
  overUlChecks()
  brokenYamlChecks()
  console.log(`\nВсе проверки norms пройдены (${passed} групп).`)
}

try {
  main()
} catch (e) {
  console.error('\n✗ ТЕСТ NORMS УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}
