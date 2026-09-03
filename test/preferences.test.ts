/**
 * Тесты книги предпочтений (src/core/preferences.ts).
 *
 * Сборка и запуск:
 *   esbuild test/preferences.test.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.cache/eda/preferences.mjs && node node_modules/.cache/eda/preferences.mjs
 */
import {
  clearRating,
  emptyPreferences,
  mealStances,
  rateDish,
  ratingOf,
  setStance,
  stanceOf
} from '../src/core/preferences'
import type { Meal, Preferences } from '../src/core/types'

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
  throw new Error(`${label}: ожидалась ошибка, но функция не упала`)
}

function meal(items: { product: string }[]): Meal {
  return {
    slot: 'breakfast',
    id: 'test-meal',
    title: 'Тест',
    steps: [],
    items: items.map(i => ({ product: i.product, g: 100, where: 'container' as const }))
  }
}

// ---- пустая книга -------------------------------------------------------

function emptyChecks(): void {
  const prefs = emptyPreferences()
  assert(Object.keys(prefs.ingredients).length === 0, 'пустая книга: ингредиентов быть не должно')
  assert(Object.keys(prefs.dishes).length === 0, 'пустая книга: блюд быть не должно')
  assert(stanceOf(prefs, 'oats') === undefined, 'нейтральный ингредиент — undefined')
  assert(ratingOf(prefs, 'test-meal') === undefined, 'неоценённое блюдо — undefined')
  group('emptyPreferences: пустая книга без единой записи')
}

// ---- отметки ингредиентов -----------------------------------------------

function stanceChecks(): void {
  let prefs = emptyPreferences()

  prefs = setStance(prefs, 'oats', 'love')
  assert(stanceOf(prefs, 'oats') === 'love', 'после setStance love должно читаться love')
  assert(Object.keys(prefs.ingredients).length === 1, 'ровно одна запись после одной отметки')
  group('setStance: love записывается')

  prefs = setStance(prefs, 'liver', 'avoid')
  assert(stanceOf(prefs, 'liver') === 'avoid', 'avoid читается отдельно от love')
  assert(stanceOf(prefs, 'oats') === 'love', 'прежняя отметка не затирается новой на другом продукте')
  group('setStance: несколько продуктов независимы')

  const before = { ...prefs.ingredients }
  const after = setStance(prefs, 'oats', null)
  assert(!('oats' in after.ingredients), 'null должен УДАЛИТЬ ключ, а не оставить его с undefined')
  assert(after.ingredients.oats === undefined, 'oats действительно отсутствует')
  assert(Object.keys(after.ingredients).length === 1, 'после снятия одной отметки должна остаться одна')
  assert(JSON.stringify(prefs.ingredients) === JSON.stringify(before), 'исходный объект preferences не должен мутировать')
  group('setStance: null снимает отметку и удаляет ключ, нейтральное состояние — отсутствие записи')

  const fresh = setStance(emptyPreferences(), 'ghost', null)
  assert(Object.keys(fresh.ingredients).length === 0, 'снятие отметки с продукта без записи не создаёт запись')
  group('setStance: снятие несуществующей отметки — no-op')
}

// ---- оценки блюд ----------------------------------------------------------

function ratingChecks(): void {
  let prefs = emptyPreferences()
  const now = '2026-08-30T12:00:00.000Z'

  prefs = rateDish(prefs, 'oats-classic', 7, 'солоновато', now)
  const r = ratingOf(prefs, 'oats-classic')
  assert(r !== undefined, 'после rateDish запись должна появиться')
  assert(r!.score === 7 && r!.comment === 'солоновато' && r!.ratedAt === now, 'поля оценки должны совпасть с переданными')
  group('rateDish: оценка записывается целиком (балл, комментарий, время)')

  const prefs2 = rateDish(prefs, 'oats-classic', 3, '', now)
  assert(ratingOf(prefs2, 'oats-classic')!.score === 3, 'повторная оценка того же блюда должна перезаписывать балл')
  assert(ratingOf(prefs, 'oats-classic')!.score === 7, 'исходный объект preferences не должен мутировать')
  group('rateDish: повторная оценка перезаписывает, не мутируя исходный объект')

  const cleared = clearRating(prefs, 'oats-classic')
  assert(ratingOf(cleared, 'oats-classic') === undefined, 'clearRating должен удалить ключ')
  assert(!('oats-classic' in cleared.dishes), 'ключ должен реально отсутствовать в объекте')
  group('clearRating: удаляет запись оценки')

  assertThrows(() => rateDish(emptyPreferences(), 'x', 0, '', now), ['1', '10'], 'rateDish: балл 0 — ошибка')
  assertThrows(() => rateDish(emptyPreferences(), 'x', 11, '', now), ['1', '10'], 'rateDish: балл 11 — ошибка')
  assertThrows(() => rateDish(emptyPreferences(), 'x', 5.5, '', now), ['цел'], 'rateDish: дробный балл — ошибка')
  assertThrows(() => rateDish(emptyPreferences(), '', 5, '', now), ['mealId'], 'rateDish: пустой mealId — ошибка')
  group('rateDish: невалидный балл и пустой mealId бросают ошибку с внятным текстом')
}

// ---- ratedAt не перетирается правкой комментария при том же балле ---------

function ratedAtChecks(): void {
  const firstAt = '2026-08-30T12:00:00.000Z'
  const laterAt = '2026-08-30T12:05:00.000Z'

  let prefs = emptyPreferences()
  prefs = rateDish(prefs, 'oats-classic', 7, 'солоно', firstAt)
  assert(ratingOf(prefs, 'oats-classic')!.ratedAt === firstAt, 'первая оценка ставит ratedAt = время записи')

  // правка одного комментария при том же балле, позже по времени — ratedAt не двигается.
  const sameScoreEdited = rateDish(prefs, 'oats-classic', 7, 'солоновато, но съедобно', laterAt)
  const afterEdit = ratingOf(sameScoreEdited, 'oats-classic')!
  assert(afterEdit.comment === 'солоновато, но съедобно', 'комментарий обновляется')
  assert(afterEdit.ratedAt === firstAt, `ratedAt должен остаться прежним при том же балле, получено ${afterEdit.ratedAt}`)
  group('rateDish: правка комментария при том же балле НЕ двигает ratedAt')

  // балл изменился — ratedAt обязан обновиться.
  const scoreChanged = rateDish(prefs, 'oats-classic', 9, 'солоновато, но съедобно', laterAt)
  const afterScoreChange = ratingOf(scoreChanged, 'oats-classic')!
  assert(afterScoreChange.score === 9, 'балл обновился')
  assert(afterScoreChange.ratedAt === laterAt, `ratedAt должен обновиться при смене балла, получено ${afterScoreChange.ratedAt}`)
  group('rateDish: смена балла двигает ratedAt')
}

// ---- отметки приёма --------------------------------------------------------

function mealStancesChecks(): void {
  let prefs = emptyPreferences()
  prefs = setStance(prefs, 'oats', 'love')
  prefs = setStance(prefs, 'liver', 'avoid')
  prefs = setStance(prefs, 'milk', 'love')

  const m = meal([{ product: 'oats' }, { product: 'milk' }, { product: 'liver' }, { product: 'salt' }])
  const { loved, avoided } = mealStances(m, prefs)
  assert(JSON.stringify(loved) === JSON.stringify(['oats', 'milk']), `порядок loved должен совпадать с meal.items, получено ${JSON.stringify(loved)}`)
  assert(JSON.stringify(avoided) === JSON.stringify(['liver']), `avoided должен содержать только liver, получено ${JSON.stringify(avoided)}`)
  group('mealStances: продукты приёма раскладываются по отметке в порядке items')

  const dup = meal([{ product: 'oats' }, { product: 'oats' }, { product: 'salt' }])
  const dupResult = mealStances(dup, prefs)
  assert(JSON.stringify(dupResult.loved) === JSON.stringify(['oats']), 'повтор одного продукта в items не должен дублироваться в loved')
  group('mealStances: повторяющаяся позиция не даёт дубликат в списке')

  const empty = meal([{ product: 'salt' }])
  const emptyResult = mealStances(empty, prefs)
  assert(emptyResult.loved.length === 0 && emptyResult.avoided.length === 0, 'приём без отмеченных продуктов — пустые списки, это нормальное состояние')
  group('mealStances: пустые списки — нормальный результат, не ошибка')
}

function main(): void {
  console.log('preferences — книга предпочтений: отметки ингредиентов и оценки блюд')
  emptyChecks()
  stanceChecks()
  ratingChecks()
  ratedAtChecks()
  mealStancesChecks()
  console.log(`\nВсе проверки preferences пройдены (${passed} групп).`)
}

try {
  main()
} catch (e) {
  console.error('\n✗ ТЕСТ PREFERENCES УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}
