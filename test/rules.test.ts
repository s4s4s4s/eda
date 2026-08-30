/**
 * Тесты проверки меню на нормы порций и калорийность (src/core/rules.ts).
 * Один тест на валидную фикстуру (обязана дать пустой список нарушений — это
 * ловит правила, которые срабатывают всегда) и по тесту на каждое сломанное
 * правило. Гоняются node-ом после сборки esbuild: `npm run test:rules`.
 */
import { checkDay, LIMITS } from '../src/core/rules'
import type { Item, Kbju, Meal, MenuDay, Product, ProductIndex, Slot, Where } from '../src/core/types'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}
function group(name: string): void { console.log(`  ok ${name}`); passed++ }

function hasRule(violations: { rule: string }[], rule: string): boolean {
  return violations.some(v => v.rule === rule)
}

// ---- фабрики -----------------------------------------------------------------

function product(id: string, per100: Kbju, tags: string[] = [], extra: Partial<Product> = {}): Product {
  return { id, name: id, fdcId: 1, fdcDescription: id, tags, per100, micro100: {}, ...extra }
}

function idx(...list: Product[]): ProductIndex {
  const map = new Map<string, Product>()
  for (const p of list) map.set(p.id, p)
  return map
}

function item(productId: string, qty: { g?: number; pieces?: number; tbsp?: number }, where: Where = 'container'): Item {
  return { product: productId, where, ...qty }
}

function meal(slot: Slot, items: Item[]): Meal {
  return { slot, title: slot, steps: [], items }
}

function day(dayNum: number, meals: Meal[]): MenuDay {
  return { day: dayNum, meals }
}

// ---- общий каталог продуктов, используемых в фикстурах -----------------------

const P = idx(
  product('fish', { kcal: 200, p: 20, f: 10, c: 0 }, ['fish']),
  product('beef', { kcal: 250, p: 26, f: 15, c: 0 }, ['beef']),
  product('grain', { kcal: 350, p: 10, f: 2, c: 70 }, ['grain']),
  product('legumes', { kcal: 340, p: 24, f: 1, c: 60 }, ['legumes']),
  product('tvorog', { kcal: 110, p: 18, f: 2, c: 3 }, ['tvorog']),
  product('yogurt', { kcal: 59, p: 10, f: 0.4, c: 3.6 }, ['greek-yogurt']),
  product('nuts', { kcal: 600, p: 20, f: 50, c: 20 }, ['nuts']),
  product('brazil', { kcal: 659, p: 14, f: 67, c: 12 }, ['nuts', 'brazil'], { pieceG: 5 }),
  product('flax', { kcal: 534, p: 18, f: 42, c: 29 }, ['flax'], { tbspG: 10 }),
  product('chia', { kcal: 486, p: 17, f: 31, c: 42 }, ['chia'], { tbspG: 12 }),
  product('oil', { kcal: 884, p: 0, f: 100, c: 0 }, ['oil'], { tbspG: 14 }),
  product('berries', { kcal: 57, p: 0.7, f: 0.3, c: 14 }, ['berries']),
  product('filler', { kcal: 200, p: 5, f: 5, c: 25 }, [])
)

// ---- валидный день: все правила должны молчать --------------------------------

/*
 * Фиксированные (не-филлерные) вклады по приёмам:
 *   завтрак: творог 150г (165) + бразильский орех 2шт (65.9) + лён 1 ст.л. (53.4) = 284.3
 *   обед:    рыба 170г (340) + масло 1 ст.л. (123.76) = 463.76
 *   ужин:    говядина 190г (475) + бобовые 110г (374) + ягоды 125г (71.25) + масло 1 ст.л. (123.76) = 1044.01
 *   перекус: йогурт 200г (118) + орехи 40г (240) + чиа 2 ст.л. (116.64) + масло 1 ст.л. (123.76) = 598.4
 * Филлер (без тегов, kcal=200/100г) добивает основные приёмы до >=800 ккал:
 *   завтрак +260г (520) = 804.3;  обед +170г (340) = 803.76
 * Итог дня: 804.3 + 803.76 + 1044.01 + 598.4 = 3250.47 — внутри коридора 3050-3350.
 * Масло за день: 1+1+1 = 3 ст.л. Ягоды — только в ужине (один приём), 125г.
 */
function validDay(): MenuDay {
  return day(1, [
    meal('breakfast', [
      item('tvorog', { g: 150 }),
      item('brazil', { pieces: 2 }, 'packet'),
      item('flax', { tbsp: 1 }, 'packet'),
      item('filler', { g: 260 })
    ]),
    meal('lunch', [
      item('fish', { g: 170 }),
      item('oil', { tbsp: 1 }, 'packet'),
      item('filler', { g: 170 })
    ]),
    meal('dinner', [
      item('beef', { g: 190 }),
      item('legumes', { g: 110 }),
      item('berries', { g: 125 }),
      item('oil', { tbsp: 1 }, 'packet')
    ]),
    meal('snack', [
      item('yogurt', { g: 200 }),
      item('nuts', { g: 40 }),
      item('chia', { tbsp: 2 }, 'packet'),
      item('oil', { tbsp: 1 }, 'packet')
    ])
  ])
}

function validDayChecks(): void {
  const violations = checkDay(validDay(), P)
  assert(violations.length === 0, `валидный день должен давать 0 нарушений, получено: ${JSON.stringify(violations)}`)
  group('checkDay: валидная фикстура даёт пустой список нарушений')
}

// ---- сломанные правила: по одному на случай -----------------------------------

/** Клонирует валидный день и заменяет ОДНУ позицию (по продукту и приёму) на новую. */
function withReplacedItem(slot: Slot, productId: string, replacement: Item): MenuDay {
  const base = validDay()
  const meals = base.meals.map(m => {
    if (m.slot !== slot) return m
    return { ...m, items: m.items.map(it => (it.product === productId ? replacement : it)) }
  })
  return { ...base, meals }
}

function brokenPortionChecks(): void {
  const fishBroken = withReplacedItem('lunch', 'fish', item('fish', { g: 150 }))
  assert(hasRule(checkDay(fishBroken, P), 'portion.fish'), 'рыба 150г вместо 170г должна дать portion.fish')

  const beefBroken = withReplacedItem('dinner', 'beef', item('beef', { g: 200 }))
  assert(hasRule(checkDay(beefBroken, P), 'portion.beef'), 'говядина 200г вместо 190г должна дать portion.beef')

  const tvorogBroken = withReplacedItem('breakfast', 'tvorog', item('tvorog', { g: 120 }))
  assert(hasRule(checkDay(tvorogBroken, P), 'portion.tvorog'), 'творог 120г вместо 150г должен дать portion.tvorog')

  const yogurtBroken = withReplacedItem('snack', 'yogurt', item('yogurt', { g: 150 }))
  assert(hasRule(checkDay(yogurtBroken, P), 'portion.greek-yogurt'), 'йогурт 150г вместо 200г должен дать portion.greek-yogurt')

  const nutsBroken = withReplacedItem('snack', 'nuts', item('nuts', { g: 55 }))
  assert(hasRule(checkDay(nutsBroken, P), 'portion.nuts'), 'орехи 55г вместо 40г должны дать portion.nuts')

  const legumesLow = withReplacedItem('dinner', 'legumes', item('legumes', { g: 90 }))
  assert(hasRule(checkDay(legumesLow, P), 'portion.legumes'), 'бобовые 90г (ниже 100) должны дать portion.legumes')

  const legumesHigh = withReplacedItem('dinner', 'legumes', item('legumes', { g: 130 }))
  assert(hasRule(checkDay(legumesHigh, P), 'portion.legumes'), 'бобовые 130г (выше 120) должны дать portion.legumes')

  const brazilLow = withReplacedItem('breakfast', 'brazil', item('brazil', { pieces: 1 }, 'packet'))
  assert(hasRule(checkDay(brazilLow, P), 'portion.brazil'), 'бразильский орех 1 шт вместо 2 должен дать portion.brazil')

  const brazilHigh = withReplacedItem('breakfast', 'brazil', item('brazil', { pieces: 3 }, 'packet'))
  assert(hasRule(checkDay(brazilHigh, P), 'portion.brazil'), 'бразильский орех 3 шт вместо 2 должен дать portion.brazil')

  const chiaBroken = withReplacedItem('snack', 'chia', item('chia', { tbsp: 1 }, 'packet'))
  assert(hasRule(checkDay(chiaBroken, P), 'portion.chia'), 'чиа 1 ст.л. вместо 2 должна дать portion.chia')

  group('portion.*: рыба/говядина/творог/йогурт/орехи/бобовые(x2)/бразильский(x2)/чиа — каждое ловится')
}

function brokenGrainInLunchChecks(): void {
  const base = validDay()
  const meals = base.meals.map(m => {
    if (m.slot !== 'lunch') return m
    return { ...m, items: [...m.items, item('grain', { g: 150 })] }
  })
  const broken = { ...base, meals }
  assert(hasRule(checkDay(broken, P), 'portion.grain'), 'крупа 150г в обеде (норма 130) должна дать portion.grain')

  // на завтраке правило grain не применяется вовсе, даже если норма нарушена сильно
  const breakfastWithGrain = validDay()
  const withGrainOnBreakfast = {
    ...breakfastWithGrain,
    meals: breakfastWithGrain.meals.map(m => (m.slot === 'breakfast' ? { ...m, items: [...m.items, item('grain', { g: 999 })] } : m))
  }
  assert(!hasRule(checkDay(withGrainOnBreakfast, P), 'portion.grain'), 'на завтраке правило grain должно молчать')

  group('portion.grain: срабатывает в обеде/ужине, молчит на завтраке')
}

function brokenFlaxMissingChecks(): void {
  const base = validDay()
  const meals = base.meals.map(m => {
    if (m.slot !== 'breakfast') return m
    return { ...m, items: m.items.filter(it => it.product !== 'flax') }
  })
  const broken = { ...base, meals }
  assert(hasRule(checkDay(broken, P), 'day.flax.missing'), 'отсутствие льна за весь день должно дать day.flax.missing')
  group('day.flax.missing: срабатывает, если льна нет ни в одном приёме за день')
}

function brokenOilChecks(): void {
  const base = validDay()
  const meals = base.meals.map(m => {
    if (m.slot !== 'dinner') return m
    return { ...m, items: m.items.filter(it => it.product !== 'oil') }
  })
  const broken = { ...base, meals } // масла осталось 2 ст.л. вместо 3
  assert(hasRule(checkDay(broken, P), 'day.oil'), 'масло 2 ст.л. за день вместо 3 должно дать day.oil')
  group('day.oil: срабатывает при отклонении от 3 ст.л. в сумме за день')
}

function brokenBerriesAmountChecks(): void {
  const broken = withReplacedItem('dinner', 'berries', item('berries', { g: 100 }))
  assert(hasRule(checkDay(broken, P), 'day.berries.amount'), 'ягоды 100г за день вместо 125 должны дать day.berries.amount')
  group('day.berries.amount: срабатывает при отклонении суммы ягод за день от 125г')
}

function brokenBerriesSpreadChecks(): void {
  const base = validDay()
  const meals = base.meals.map(m => {
    if (m.slot !== 'snack') return m
    return { ...m, items: [...m.items, item('berries', { g: 50 })] }
  })
  const broken = { ...base, meals } // ягоды теперь в ужине И в перекусе
  assert(hasRule(checkDay(broken, P), 'day.berries.spread'), 'ягоды в двух приёмах должны дать day.berries.spread')
  group('day.berries.spread: срабатывает, если ягоды не ровно в одном приёме')
}

function brokenDayKcalChecks(): void {
  // день ~3000 ккал: сильно урезаем филлер завтрака (убираем его целиком, -520 ккал)
  const base = validDay()
  const lowMeals = base.meals.map(m => (m.slot === 'breakfast' ? { ...m, items: m.items.filter(it => it.product !== 'filler') } : m))
  const lowDay = { ...base, meals: lowMeals } // 3250.47 - 520 = 2730.47 (ниже коридора)
  assert(hasRule(checkDay(lowDay, P), 'day.kcal.low'), 'день ~2730 ккал (ниже 3050) должен дать day.kcal.low')

  // день ~3400+ ккал: сильно увеличиваем филлер обеда (было 170г/340ккал)
  const high = withReplacedItem('lunch', 'filler', item('filler', { g: 400 })) // +230г = +460ккал: 3250.47+460=3710.47
  assert(hasRule(checkDay(high, P), 'day.kcal.high'), 'день ~3710 ккал (выше 3350) должен дать day.kcal.high')

  group('day.kcal.low/high: коридор 3050-3350')
}

function brokenMealKcalChecks(): void {
  // обед ~750 ккал: заменяем филлер обеда так, чтобы сумма упала ниже 800 (но выше 0)
  const lunchLow = withReplacedItem('lunch', 'filler', item('filler', { g: 143 })) // 463.76 + 286 = 749.76
  const v1 = checkDay(lunchLow, P)
  assert(v1.some(v => v.rule === 'meal.kcal.low' && v.scope.kind === 'meal' && v.scope.slot === 'lunch'),
    `обед ~750 ккал должен дать meal.kcal.low на обеде, получено: ${JSON.stringify(v1)}`)

  // перекус ~300 ккал: строим минимальный день только с лёгким перекусом
  const snackDay: MenuDay = day(1, [
    meal('snack', [item('filler', { g: 150 })]) // 150 * 2 = 300 ккал
  ])
  const v2 = checkDay(snackDay, P)
  assert(v2.some(v => v.rule === 'meal.kcal.low' && v.scope.kind === 'meal' && v.scope.slot === 'snack'),
    `перекус ~300 ккал должен дать meal.kcal.low на перекусе, получено: ${JSON.stringify(v2)}`)

  group('meal.kcal.low: обед не легче 800, перекус не легче 350')
}

function limitsAreCentralChecks(): void {
  assert(LIMITS.portionG.fish === 170 && LIMITS.portionG.beef === 190, 'LIMITS.portionG должен содержать нормы рыбы/говядины')
  assert(LIMITS.legumesG.min === 100 && LIMITS.legumesG.max === 120, 'LIMITS.legumesG должен задавать коридор 100-120')
  assert(LIMITS.dayKcal.min === 3050 && LIMITS.dayKcal.max === 3350, 'LIMITS.dayKcal должен задавать коридор 3050-3350')
  group('LIMITS: все пороги собраны в одном экспортируемом объекте')
}

function main(): void {
  console.log('rules — проверка меню на нормы порций и калорийность')
  validDayChecks()
  brokenPortionChecks()
  brokenGrainInLunchChecks()
  brokenFlaxMissingChecks()
  brokenOilChecks()
  brokenBerriesAmountChecks()
  brokenBerriesSpreadChecks()
  brokenDayKcalChecks()
  brokenMealKcalChecks()
  limitsAreCentralChecks()
  console.log(`\nВсе проверки rules пройдены (${passed} групп).`)
}

try {
  main()
} catch (e) {
  console.error('\n✗ ТЕСТ RULES УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}
