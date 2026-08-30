/**
 * Тесты чистой арифметики КБЖУ и микронутриентов (src/core/nutrition.ts).
 * Гоняются node-ом после сборки esbuild: `npm run test:nutrition`.
 */
import {
  addKbju, addNutrientTotals, dayKbju, dayNutrients, emptyNutrientTotals, incompleteNutrients,
  itemGrams, itemKbju, itemNutrients, mealKbju, mealNutrients, scaleKbju, scaleNutrientTotals
} from '../src/core/nutrition'
import { NUTRIENT_KEYS } from '../src/core/types'
import type { Kbju, Meal, MenuDay, Nutrients, Product, ProductIndex } from '../src/core/types'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}
function group(name: string): void { console.log(`  ok ${name}`); passed++ }

function approx(a: number, b: number, eps = 0.0001): boolean {
  return Math.abs(a - b) < eps
}

function product(id: string, per100: Kbju, extra: Partial<Product> = {}): Product {
  return { id, name: id, fdcId: 1, fdcDescription: id, tags: [], per100, micro100: {}, ...extra }
}

function products(...list: Product[]): ProductIndex {
  const map = new Map<string, Product>()
  for (const p of list) map.set(p.id, p)
  return map
}

// ---- itemGrams -------------------------------------------------------------

function itemGramsChecks(): void {
  const idx = products(
    product('oats', { kcal: 380, p: 13, f: 7, c: 67 }),
    product('brazil', { kcal: 659, p: 14, f: 67, c: 12 }, { pieceG: 5 }),
    product('flax', { kcal: 534, p: 18, f: 42, c: 29 }, { tbspG: 10 })
  )
  assert(itemGrams({ product: 'oats', g: 90, where: 'container' }, idx) === 90, 'граммы из g должны браться как есть')
  assert(itemGrams({ product: 'brazil', pieces: 2, where: 'packet' }, idx) === 10, '2 шт × 5 г = 10 г')
  assert(itemGrams({ product: 'flax', tbsp: 1, where: 'packet' }, idx) === 10, '1 ст. л. × 10 г = 10 г')
  group('itemGrams: из g, из pieces*pieceG, из tbsp*tbspG')
}

// ---- itemKbju (без округления) ---------------------------------------------

function itemKbjuChecks(): void {
  const idx = products(product('salmon', { kcal: 208, p: 20.42, f: 13.42, c: 0 }))
  const kbju = itemKbju({ product: 'salmon', g: 137, where: 'container' }, idx)
  // 208 * 1.37 = 284.96; 20.42 * 1.37 = 27.9754; ни одно из этих чисел не круглое —
  // это специально, чтобы поймать случайное округление внутри функции.
  assert(approx(kbju.kcal, 284.96), `kcal ожидалось 284.96, получено ${kbju.kcal}`)
  assert(approx(kbju.p, 27.9754), `p ожидалось 27.9754, получено ${kbju.p}`)
  assert(approx(kbju.f, 18.3854), `f ожидалось 18.3854, получено ${kbju.f}`)
  assert(kbju.c === 0, `c ожидалось 0, получено ${kbju.c}`)
  group('itemKbju: per100 * граммы / 100, без округления')
}

// ---- mealKbju ---------------------------------------------------------------

function mealKbjuChecks(): void {
  const idx = products(
    product('a', { kcal: 100, p: 10, f: 5, c: 20 }),
    product('b', { kcal: 50, p: 2, f: 1, c: 5 })
  )
  const meal: Meal = {
    slot: 'lunch',
    title: 't',
    steps: [],
    items: [
      { product: 'a', g: 200, where: 'container' },
      { product: 'b', g: 100, where: 'container' }
    ]
  }
  const kbju = mealKbju(meal, idx)
  assert(kbju.kcal === 250 && kbju.p === 22 && kbju.f === 11 && kbju.c === 45,
    `сумма приёма ожидалась {250,22,11,45}, получено ${JSON.stringify(kbju)}`)
  group('mealKbju: сумма позиций приёма')
}

// ---- dayKbju: контрольный расчёт на круглых числах -------------------------

/*
 * Выкладка вручную (все числа подобраны так, чтобы деление на 100 давало целые):
 *
 * Приём 1 (lunch):
 *   A: per100 {kcal:100,p:10,f:5,c:20}, 200 г → factor 2   → {200,20,10,40}
 *   B: per100 {kcal:50, p:2, f:1,c:5},  100 г → factor 1   → {50,2,1,5}
 *   итог lunch: {250,22,11,45}
 *
 * Приём 2 (dinner):
 *   C: per100 {kcal:200,p:0,f:20,c:0}, pieceG=10, 3 шт → 30 г → factor 0.3 → {60,0,6,0}
 *   D: per100 {kcal:300,p:0,f:0,c:80}, tbspG=15, 2 ст.л. → 30 г → factor 0.3 → {90,0,0,24}
 *   итог dinner: {150,0,6,24}
 *
 * Итог дня: {400,22,17,69}
 */
function dayKbjuControlChecks(): void {
  const idx = products(
    product('a', { kcal: 100, p: 10, f: 5, c: 20 }),
    product('b', { kcal: 50, p: 2, f: 1, c: 5 }),
    product('c', { kcal: 200, p: 0, f: 20, c: 0 }, { pieceG: 10 }),
    product('d', { kcal: 300, p: 0, f: 0, c: 80 }, { tbspG: 15 })
  )
  const day: MenuDay = {
    day: 1,
    meals: [
      {
        slot: 'lunch', title: 't', steps: [],
        items: [
          { product: 'a', g: 200, where: 'container' },
          { product: 'b', g: 100, where: 'container' }
        ]
      },
      {
        slot: 'dinner', title: 't', steps: [],
        items: [
          { product: 'c', pieces: 3, where: 'packet' },
          { product: 'd', tbsp: 2, where: 'packet' }
        ]
      }
    ]
  }
  const total = dayKbju(day, idx)
  assert(Math.abs(total.kcal - 400) < 0.01, `kcal ожидалось 400, получено ${total.kcal}`)
  assert(Math.abs(total.p - 22) < 0.01, `p ожидалось 22, получено ${total.p}`)
  assert(Math.abs(total.f - 17) < 0.01, `f ожидалось 17, получено ${total.f}`)
  assert(Math.abs(total.c - 69) < 0.01, `c ожидалось 69, получено ${total.c}`)
  group('dayKbju: контрольный расчёт дня по ручной выкладке (точность 0.01)')
}

// ---- scaleKbju / addKbju -----------------------------------------------------

function scaleAddChecks(): void {
  const kbju: Kbju = { kcal: 400, p: 22, f: 17, c: 69 }
  const half = scaleKbju(kbju, 0.5)
  assert(half.kcal === 200 && half.p === 11 && half.f === 8.5 && half.c === 34.5,
    `scaleKbju(0.5) ожидалось {200,11,8.5,34.5}, получено ${JSON.stringify(half)}`)

  const sum = addKbju(half, half)
  assert(sum.kcal === 400 && sum.p === 22 && approx(sum.f, 17) && approx(sum.c, 69),
    `addKbju: две половины должны сложиться обратно в целое, получено ${JSON.stringify(sum)}`)
  group('scaleKbju(0.5) даёт ровно половину каждого макроса; addKbju складывает')
}

// ---- микронутриенты: отсутствие числа не равно нулю -------------------------

/* Главное правило всего слоя: у части продуктов USDA SR Legacy просто нет
   строки по нутриенту (классический пример — витамин K у чиа). Прибавить такую
   позицию как ноль значит занизить сумму молча, поэтому сумма несёт полноту:
   value + known + total. */

function itemNutrientsChecks(): void {
  const idx = products(
    product('chia', { kcal: 486, p: 16.5, f: 30.7, c: 42.1 }, {
      // vitK намеренно отсутствует: в датасете строки нет
      micro100: { fiber: 34.4, calcium: 631, sodium: 0 }
    })
  )
  const n: Nutrients = itemNutrients({ product: 'chia', g: 50, where: 'packet' }, idx)
  assert(approx(n.fiber!, 17.2), `клетчатка 50 г чиа ожидалась 17.2, получено ${n.fiber}`)
  assert(approx(n.calcium!, 315.5), `кальций ожидался 315.5, получено ${n.calcium}`)
  assert(n.sodium === 0, `честный ноль должен остаться нулём, получено ${n.sodium}`)
  assert(!('vitK' in n), 'отсутствующий у продукта нутриент не должен появляться у позиции даже нулём')
  group('itemNutrients: масштаб по граммам, честный ноль сохраняется, отсутствующий ключ не появляется')
}

function missingNutrientKeepsSumHonestChecks(): void {
  const idx = products(
    // у «a» витамин K есть, у «b» — нет: это и есть разбираемый случай
    product('a', { kcal: 100, p: 0, f: 0, c: 0 }, { micro100: { fiber: 10, vitK: 40 } }),
    product('b', { kcal: 100, p: 0, f: 0, c: 0 }, { micro100: { fiber: 20 } })
  )
  const meal: Meal = {
    slot: 'lunch', title: 't', steps: [],
    items: [
      { product: 'a', g: 100, where: 'container' },
      { product: 'b', g: 100, where: 'container' }
    ]
  }
  const totals = mealNutrients(meal, idx)

  assert(totals.fiber.known === 2 && totals.fiber.total === 2, `клетчатка известна у обеих позиций, получено ${JSON.stringify(totals.fiber)}`)
  assert(approx(totals.fiber.value, 30), `клетчатка ожидалась 30, получено ${totals.fiber.value}`)

  // витамин K: значение — ровно вклад «a», ни на грамм больше; «b» не прибавился нулём
  assert(approx(totals.vitK.value, 40), `витамин K ожидался 40 (вклад только «a»), получено ${totals.vitK.value}`)
  assert(totals.vitK.known === 1, `витамин K известен по одной позиции, получено known=${totals.vitK.known}`)
  assert(totals.vitK.total === 2, `в сумму витамина K вошли обе позиции, получено total=${totals.vitK.total}`)
  assert(totals.vitK.known < totals.vitK.total, 'неполнота обязана быть видна: known меньше total')
  assert(incompleteNutrients(totals).includes('vitK'), 'витамин K должен попасть в список неполных')

  group('mealNutrients: у продукта нет нутриента — сумма помечена неполной, значение не выросло на ноль')
}

function unknownEverywhereChecks(): void {
  const idx = products(
    product('a', { kcal: 100, p: 0, f: 0, c: 0 }, { micro100: { fiber: 10 } }),
    product('b', { kcal: 100, p: 0, f: 0, c: 0 }, { micro100: { fiber: 20 } })
  )
  const meal: Meal = {
    slot: 'lunch', title: 't', steps: [],
    items: [
      { product: 'a', g: 100, where: 'container' },
      { product: 'b', g: 100, where: 'container' }
    ]
  }
  const totals = mealNutrients(meal, idx)
  assert(totals.vitB12.known === 0, `нутриент, которого нет ни у одной позиции, обязан иметь known=0, получено ${totals.vitB12.known}`)
  assert(totals.vitB12.total === 2, `total считает все позиции, получено ${totals.vitB12.total}`)
  assert(totals.vitB12.value === 0, 'value при known=0 — заглушка, а не результат')
  group('mealNutrients: нутриент, неизвестный всем позициям, даёт известность 0')
}

function honestZeroIsKnownChecks(): void {
  const idx = products(
    // в датасете реально записан 0 — это знание, а не пропуск
    product('a', { kcal: 100, p: 0, f: 0, c: 0 }, { micro100: { sodium: 0 } }),
    product('b', { kcal: 100, p: 0, f: 0, c: 0 }, { micro100: { sodium: 0 } })
  )
  const meal: Meal = {
    slot: 'lunch', title: 't', steps: [],
    items: [
      { product: 'a', g: 100, where: 'container' },
      { product: 'b', g: 100, where: 'container' }
    ]
  }
  const totals = mealNutrients(meal, idx)
  assert(totals.sodium.value === 0 && totals.sodium.known === 2 && totals.sodium.total === 2,
    `честный ноль обязан считаться известным, получено ${JSON.stringify(totals.sodium)}`)
  assert(!incompleteNutrients(totals).includes('sodium'), 'сумма из честных нулей полна')
  // и он обязан отличаться от «нет данных» при одинаковом value
  assert(totals.vitC.value === 0 && totals.vitC.known === 0 && totals.sodium.known === 2,
    'ноль-как-значение и «нет данных» обязаны различаться полем known при одинаковом value')
  group('честный ноль в справочнике считается известным и отличается от «нет данных»')
}

function totalsArithmeticChecks(): void {
  const empty = emptyNutrientTotals()
  assert(NUTRIENT_KEYS.every(k => empty[k].value === 0 && empty[k].known === 0 && empty[k].total === 0),
    'emptyNutrientTotals: все ключи на месте и пусты')
  assert(Object.keys(empty).length === 29, `ожидалось 29 ключей, получено ${Object.keys(empty).length}`)

  const idx = products(
    product('a', { kcal: 100, p: 0, f: 0, c: 0 }, { micro100: { fiber: 10, vitK: 40 } }),
    product('b', { kcal: 100, p: 0, f: 0, c: 0 }, { micro100: { fiber: 20 } })
  )
  const meal: Meal = {
    slot: 'lunch', title: 't', steps: [],
    items: [
      { product: 'a', g: 100, where: 'container' },
      { product: 'b', g: 100, where: 'container' }
    ]
  }
  const totals = mealNutrients(meal, idx)

  const half = scaleNutrientTotals(totals, 0.5)
  assert(approx(half.fiber.value, 15), `половина клетчатки ожидалась 15, получено ${half.fiber.value}`)
  assert(half.vitK.known === totals.vitK.known && half.vitK.total === totals.vitK.total,
    'доля съеденного не меняет полноту: съеденная половина известна ровно настолько же')

  const sum = addNutrientTotals(half, half)
  assert(approx(sum.fiber.value, 30), 'две половины складываются обратно в целое')
  assert(sum.fiber.known === 4 && sum.fiber.total === 4, 'сложение сумм складывает и полноту')
  group('emptyNutrientTotals/scaleNutrientTotals/addNutrientTotals: доля не трогает полноту, сложение складывает её')
}

function dayNutrientsChecks(): void {
  const idx = products(
    product('a', { kcal: 100, p: 0, f: 0, c: 0 }, { micro100: { fiber: 10, vitK: 40 } }),
    product('b', { kcal: 100, p: 0, f: 0, c: 0 }, { micro100: { fiber: 20 } })
  )
  const day: MenuDay = {
    day: 1,
    meals: [
      { slot: 'lunch', title: 't', steps: [], items: [{ product: 'a', g: 100, where: 'container' }] },
      { slot: 'dinner', title: 't', steps: [], items: [{ product: 'b', g: 200, where: 'container' }] }
    ]
  }
  const totals = dayNutrients(day, idx)
  assert(approx(totals.fiber.value, 50) && totals.fiber.known === 2 && totals.fiber.total === 2,
    `клетчатка за день ожидалась 50 при полноте 2/2, получено ${JSON.stringify(totals.fiber)}`)
  assert(approx(totals.vitK.value, 40) && totals.vitK.known === 1 && totals.vitK.total === 2,
    `витамин K за день ожидался 40 при полноте 1/2, получено ${JSON.stringify(totals.vitK)}`)
  group('dayNutrients: суммирует приёмы вместе с полнотой')
}

function main(): void {
  console.log('nutrition — граммы/КБЖУ позиций, приёмов, дня, микронутриенты')
  itemGramsChecks()
  itemKbjuChecks()
  mealKbjuChecks()
  dayKbjuControlChecks()
  scaleAddChecks()
  itemNutrientsChecks()
  missingNutrientKeepsSumHonestChecks()
  unknownEverywhereChecks()
  honestZeroIsKnownChecks()
  totalsArithmeticChecks()
  dayNutrientsChecks()
  console.log(`\nВсе проверки nutrition пройдены (${passed} групп).`)
}

try {
  main()
} catch (e) {
  console.error('\n✗ ТЕСТ NUTRITION УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}
