/**
 * Тесты плюсов и минусов приёма (src/core/verdict.ts), правила из DESIGN.md,
 * раздел «Плюсы и минусы приёма».
 *
 * Сборка и запуск:
 *   esbuild test/verdict.test.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.cache/eda/verdict.mjs && node node_modules/.cache/eda/verdict.mjs
 */
import { emptyNutrientTotals } from '../src/core/nutrition'
import { emptyPreferences, setStance } from '../src/core/preferences'
import { MAX_PLUS_NUTRIENTS, MIN_COVERAGE, PLUS_RATIO, mealVerdict } from '../src/core/verdict'
import { NUTRIENT_KEYS } from '../src/core/types'
import type { MealMinus, MealPlus } from '../src/core/verdict'
import type { Meal, NutrientKey, NutrientNorm, NutrientNorms, NutrientTotals } from '../src/core/types'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}
function group(name: string): void { console.log(`  ok ${name}`); passed++ }

function meal(items: { product: string }[]): Meal {
  return {
    slot: 'breakfast',
    id: 'test-meal',
    title: 'Тест',
    steps: [],
    items: items.map(i => ({ product: i.product, g: 100, where: 'container' as const }))
  }
}

/** Сумма для теста: ключи, которых нет в аргументе, остаются без данных
    (known === 0), как и в настоящем счёте. */
function totalsOf(entries: Partial<Record<NutrientKey, { value: number; known: number; total: number }>>): NutrientTotals {
  const totals = emptyNutrientTotals()
  for (const [key, total] of Object.entries(entries)) {
    totals[key as NutrientKey] = total!
  }
  return totals
}

function norm(amount: number, extra: Partial<NutrientNorm> = {}): NutrientNorm {
  return { amount, basis: 'rda', comparable: true, ...extra }
}

function findPlus(pros: MealPlus[], kind: MealPlus['kind']): MealPlus | undefined {
  return pros.find(p => p.kind === kind)
}
function findMinus(cons: MealMinus[], kind: MealMinus['kind']): MealMinus | undefined {
  return cons.find(c => c.kind === kind)
}

// ---- пустой вердикт — нормальное состояние ---------------------------------

function emptyVerdictChecks(): void {
  const v = mealVerdict(meal([]), emptyNutrientTotals(), {}, emptyPreferences())
  assert(v.pros.length === 0, 'без данных, норм и отметок плюсов быть не должно')
  assert(v.cons.length === 0, 'без данных, норм и отметок минусов быть не должно')
  group('mealVerdict: пустой приём без норм и отметок — оба списка пустые, это норма, не ошибка')
}

// ---- плюс по нутриенту: порог 30% ------------------------------------------

function nutrientPlusThresholdChecks(): void {
  const norms: NutrientNorms = { calcium: norm(1000) }
  const prefs = emptyPreferences()

  const atThreshold = totalsOf({ calcium: { value: 300, known: 1, total: 1 } })
  const v1 = mealVerdict(meal([]), atThreshold, norms, prefs)
  const plus1 = findPlus(v1.pros, 'nutrient')
  assert(plus1 !== undefined, `ratio ровно ${PLUS_RATIO} должен давать плюс`)
  assert(plus1!.kind === 'nutrient' && Math.abs(plus1!.ratio - 0.30) < 1e-9, 'ratio плюса должен быть 0.30')
  group('mealVerdict: ratio ровно 0.30 — плюс есть')

  const belowThreshold = totalsOf({ calcium: { value: 290, known: 1, total: 1 } })
  const v2 = mealVerdict(meal([]), belowThreshold, norms, prefs)
  assert(findPlus(v2.pros, 'nutrient') === undefined, 'ratio 0.29 плюса давать не должен')
  group('mealVerdict: ratio 0.29 — плюса нет')
}

function noDataNoNoiseChecks(): void {
  const norms: NutrientNorms = { calcium: norm(1000, { ul: 2500 }) }
  const prefs = emptyPreferences()
  const noData = totalsOf({ calcium: { value: 0, known: 0, total: 3 } })
  const v = mealVerdict(meal([]), noData, norms, prefs)
  assert(findPlus(v.pros, 'nutrient') === undefined, 'нутриент без данных не должен давать плюс')
  assert(findMinus(v.cons, 'over-ul') === undefined, 'нутриент без данных не должен давать минус')
  group('mealVerdict: known === 0 — ни плюса, ни минуса, даже если бы порог перекрывался')
}

function notComparableChecks(): void {
  const norms: NutrientNorms = { water: norm(3700, { comparable: false }) }
  const water = totalsOf({ water: { value: 3000, known: 1, total: 1 } })
  const v = mealVerdict(meal([]), water, norms, emptyPreferences())
  assert(findPlus(v.pros, 'nutrient') === undefined, 'несравнимый нутриент (вода) не должен давать плюс, даже если формально «перекрывает» норму')
  group('mealVerdict: comparable false — нутриент в плюсы не идёт')
}

function maxFiveChecks(): void {
  const entries: Partial<Record<NutrientKey, { value: number; known: number; total: number }>> = {}
  const norms: NutrientNorms = {}
  const rich: NutrientKey[] = ['calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'zinc', 'copper']
  rich.forEach((key, i) => {
    norms[key] = norm(100)
    // разные ratio, чтобы сортировка была проверяемой: последний в списке — самый большой
    entries[key] = { value: 40 + i * 5, known: 1, total: 1 }
  })
  const totals = totalsOf(entries)
  const v = mealVerdict(meal([]), totals, norms, emptyPreferences())
  const nutrientPros = v.pros.filter(p => p.kind === 'nutrient') as { kind: 'nutrient'; key: NutrientKey; ratio: number }[]
  assert(nutrientPros.length === MAX_PLUS_NUTRIENTS, `плюсов-нутриентов должно быть не больше ${MAX_PLUS_NUTRIENTS}, получено ${nutrientPros.length}`)
  for (let i = 0; i < nutrientPros.length - 1; i++) {
    assert(nutrientPros[i].ratio >= nutrientPros[i + 1].ratio, 'плюсы должны идти по убыванию ratio')
  }
  assert(nutrientPros[0].key === 'copper', 'первым должен идти нутриент с наибольшим ratio (copper, value 70)')
  group(`mealVerdict: нутриентных плюсов не больше ${MAX_PLUS_NUTRIENTS}, отсортированы по убыванию ratio`)
}

// ---- отметки ингредиентов ---------------------------------------------------

function ingredientStancesChecks(): void {
  let prefs = emptyPreferences()
  prefs = setStance(prefs, 'oats', 'love')
  prefs = setStance(prefs, 'liver', 'avoid')
  const m = meal([{ product: 'oats' }, { product: 'liver' }, { product: 'salt' }])

  const v = mealVerdict(m, emptyNutrientTotals(), {}, prefs)
  const loved = findPlus(v.pros, 'loved')
  const avoided = findMinus(v.cons, 'avoided')
  assert(loved !== undefined && loved!.kind === 'loved' && JSON.stringify(loved!.products) === JSON.stringify(['oats']), 'loved-плюс должен перечислить любимые продукты приёма')
  assert(avoided !== undefined && avoided!.kind === 'avoided' && JSON.stringify(avoided!.products) === JSON.stringify(['liver']), 'avoided-минус должен перечислить нелюбимые продукты приёма')
  group('mealVerdict: «люблю» даёт плюс, «не ем» даёт минус, каждый одной записью')

  const neutral = meal([{ product: 'salt' }])
  const vn = mealVerdict(neutral, emptyNutrientTotals(), {}, prefs)
  assert(findPlus(vn.pros, 'loved') === undefined, 'без отмеченных продуктов loved-записи быть не должно')
  assert(findMinus(vn.cons, 'avoided') === undefined, 'без отмеченных продуктов avoided-записи быть не должно')
  group('mealVerdict: нет отмеченных продуктов — нет ни loved, ни avoided записи')
}

// ---- превышение верхнего предела --------------------------------------------

function overUlChecks(): void {
  const norms: NutrientNorms = { selenium: norm(55, { ul: 400 }) }
  const over = totalsOf({ selenium: { value: 460, known: 1, total: 1 } })
  const v = mealVerdict(meal([]), over, norms, emptyPreferences())
  const m = findMinus(v.cons, 'over-ul')
  assert(m !== undefined && m!.kind === 'over-ul' && m!.key === 'selenium' && m!.value === 460 && m!.ul === 400, 'over-ul должен нести ключ, значение и предел')
  group('mealVerdict: превышение верхнего предела за приём — минус over-ul')

  const under = totalsOf({ selenium: { value: 300, known: 1, total: 1 } })
  const vu = mealVerdict(meal([]), under, norms, emptyPreferences())
  assert(findMinus(vu.cons, 'over-ul') === undefined, 'значение ниже предела не должно давать over-ul')
  group('mealVerdict: значение ниже предела — минуса нет')
}

// ---- натрий: отдельный минус, не over-ul -------------------------------------

function sodiumChecks(): void {
  const norms: NutrientNorms = { sodium: norm(1500, { basis: 'ai', cdrr: 2300, note: 'CDRR, не UL' }) }
  const high = totalsOf({ sodium: { value: 2500, known: 1, total: 1 } })
  const v = mealVerdict(meal([]), high, norms, emptyPreferences())
  const sodiumMinus = findMinus(v.cons, 'sodium-cdrr')
  assert(sodiumMinus !== undefined && sodiumMinus!.kind === 'sodium-cdrr' && sodiumMinus!.value === 2500 && sodiumMinus!.cdrr === 2300, 'sodium-cdrr должен нести значение и порог')
  assert(findMinus(v.cons, 'over-ul') === undefined, 'у натрия нет ul в DRI — over-ul появляться не должен')
  group('mealVerdict: натрий выше CDRR — минус sodium-cdrr, а не over-ul (у натрия нет верхнего предела безопасности)')

  const low = totalsOf({ sodium: { value: 2000, known: 1, total: 1 } })
  const vl = mealVerdict(meal([]), low, norms, emptyPreferences())
  assert(findMinus(vl.cons, 'sodium-cdrr') === undefined, 'значение ниже cdrr не должно давать минус')
  group('mealVerdict: натрий ниже CDRR — минуса нет')
}

// ---- полнота состава ---------------------------------------------------------

function coverageChecks(): void {
  const entries: Partial<Record<NutrientKey, { value: number; known: number; total: number }>> = {}
  // 29 ключей: known=49, total=100 -> 49% < 50%
  let remaining = 49
  for (const key of NUTRIENT_KEYS) {
    const known = Math.min(remaining, 4)
    remaining -= known
    entries[key] = { value: 1, known, total: 4 }
  }
  // known сумма: подгоним точный total, используя один ключ на добор до 100
  const totals = totalsOf(entries)
  let sumKnown = 0
  let sumTotal = 0
  for (const key of NUTRIENT_KEYS) {
    sumKnown += totals[key].known
    sumTotal += totals[key].total
  }
  assert(sumKnown === 49, `подготовка теста: сумма known должна быть 49, получено ${sumKnown}`)
  assert(sumTotal === 4 * NUTRIENT_KEYS.length, `подготовка теста: сумма total должна быть ${4 * NUTRIENT_KEYS.length}`)

  const ratio = sumKnown / sumTotal
  assert(ratio < MIN_COVERAGE, `подготовка теста: доля должна быть ниже ${MIN_COVERAGE}, получено ${ratio}`)

  const v = mealVerdict(meal([]), totals, {}, emptyPreferences())
  const lowCov = findMinus(v.cons, 'low-coverage')
  assert(lowCov !== undefined && lowCov!.kind === 'low-coverage' && lowCov!.known === sumKnown && lowCov!.total === sumTotal,
    'доля известных данных ниже порога должна давать минус low-coverage с точными known/total')
  group('mealVerdict: полнота состава ниже 50% — минус low-coverage')
}

function coverage51PercentChecks(): void {
  // known=51 total=100 -> 51% >= 50%, минуса быть не должно
  const entries: Partial<Record<NutrientKey, { value: number; known: number; total: number }>> = {}
  let remaining = 51
  const perKey = Math.ceil(51 / NUTRIENT_KEYS.length)
  for (const key of NUTRIENT_KEYS) {
    const known = Math.min(remaining, perKey)
    remaining -= known
    entries[key] = { value: 1, known, total: perKey }
  }
  const totals = totalsOf(entries)
  let sumKnown = 0
  let sumTotal = 0
  for (const key of NUTRIENT_KEYS) {
    sumKnown += totals[key].known
    sumTotal += totals[key].total
  }
  const ratio = sumKnown / sumTotal
  assert(ratio >= MIN_COVERAGE, `подготовка теста: доля должна быть не ниже ${MIN_COVERAGE}, получено ${ratio}`)

  const v = mealVerdict(meal([]), totals, {}, emptyPreferences())
  assert(findMinus(v.cons, 'low-coverage') === undefined, `доля ${ratio} >= ${MIN_COVERAGE} не должна давать минус`)
  group('mealVerdict: полнота состава на уровне 51% и выше — минуса low-coverage нет')
}

// ---- «мало кальция» не является минусом --------------------------------------

function noDailyNormAsMealMinusChecks(): void {
  const norms: NutrientNorms = { calcium: norm(1000) }
  const low = totalsOf({ calcium: { value: 50, known: 1, total: 1 } })
  const v = mealVerdict(meal([]), low, norms, emptyPreferences())
  assert(v.cons.length === 0, 'недобор суточной нормы в одном приёме не должен порождать никакого минуса')
  group('mealVerdict: недобор суточной нормы в приёме — не минус (норма суточная, а не на приём)')
}

function main(): void {
  console.log('verdict — плюсы и минусы приёма')
  emptyVerdictChecks()
  nutrientPlusThresholdChecks()
  noDataNoNoiseChecks()
  notComparableChecks()
  maxFiveChecks()
  ingredientStancesChecks()
  overUlChecks()
  sodiumChecks()
  coverageChecks()
  coverage51PercentChecks()
  noDailyNormAsMealMinusChecks()
  console.log(`\nВсе проверки verdict пройдены (${passed} групп).`)
}

try {
  main()
} catch (e) {
  console.error('\n✗ ТЕСТ VERDICT УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}
