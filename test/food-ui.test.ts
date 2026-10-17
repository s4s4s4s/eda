/**
 * Тесты логики экранов «Своя еда» без DOM (src/ui/foodLogic.ts и
 * requestStatusText из RequestStatus.tsx): поиск Open Food Facts только по
 * явному вызову, отбрасывание устаревшего ответа, честный счёт invalid,
 * границы граммов, пресеты, подпись «Записано», тексты статуса заказа по
 * товару. Разметка (Enter и «Найти» в форме) здесь не проверяется: это
 * снимочный сценарий scripts/shots.mjs. Гоняется node-ом после сборки
 * esbuild: `npm run test:food-ui`.
 */
import { newProductRequest } from '../src/core/food'
import type { OffProductResult, OffSearchResult } from '../src/core/foodClient'
import type { FoodRequest, OffProduct } from '../src/core/types'
import {
  createFlash, createOffSearch, formatPrinted, gramsPresetsFor, offInvalidText, offSkippedText, offViewFromResult, OFF_SEARCH_LIMIT,
  parseProductGrams, PRODUCT_MAX_GRAMS
} from '../src/ui/foodLogic'
import type { OffSearchDeps, OffSearchState } from '../src/ui/foodLogic'
import { requestStatusText } from '../src/ui/RequestStatus'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}
function group(name: string): void { console.log(`  ok ${name}`); passed++ }

function product(extra: Partial<OffProduct> = {}): OffProduct {
  return {
    code: '5000159461122', url: 'https://world.openfoodfacts.org/product/5000159461122', name: 'Snickers', brand: 'Mars',
    quantityText: '50 G', per100: { kcal: 481, p: 8.6, f: 22.5, c: 60.5 }, printedMicro: {}, servingG: 50, packageG: 50,
    ingredientsText: '', warnings: [], plausible: true, fetchedAt: '2026-10-17T12:00:00.000Z', ...extra
  }
}

/** Управляемый промис: ответ воркера приходит, когда тест скажет. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

function okSearch(items: OffProduct[], extra: { skipped?: number; invalid?: number } = {}): OffSearchResult {
  return { ok: true, items, skipped: extra.skipped ?? 0, invalid: extra.invalid ?? 0, total: items.length }
}

interface Harness {
  deps: OffSearchDeps
  searches: { q: string; n: number }[]
  fetches: string[]
  opened: OffProduct[]
  states: OffSearchState[]
  controller: ReturnType<typeof createOffSearch>
}

function harness(searchOff: OffSearchDeps['searchOff'], fetchProduct?: OffSearchDeps['fetchProduct']): Harness {
  const searches: { q: string; n: number }[] = []
  const fetches: string[] = []
  const opened: OffProduct[] = []
  const states: OffSearchState[] = []
  const deps: OffSearchDeps = {
    searchOff: (q, n) => { searches.push({ q, n }); return searchOff(q, n) },
    fetchProduct: code => { fetches.push(code); return (fetchProduct ?? (async () => ({ ok: true, product: product({ code }) } as OffProductResult)))(code) },
    openProduct: p => { opened.push(p) }
  }
  const controller = createOffSearch(() => deps, s => { states.push(s) })
  return { deps, searches, fetches, opened, states, controller }
}

async function searchChecks(): Promise<void> {
  const h = harness(async () => okSearch([product()]))
  assert(h.searches.length === 0 && h.states.length === 0, 'создание контроллера не должно ничего запрашивать: запрос уходит только из search()')
  await h.controller.search('   ')
  assert(h.searches.length === 0, 'пустой запрос обязан игнорироваться')
  await h.controller.search('  сникерс ')
  assert(h.searches.length === 1 && h.searches[0].q === 'сникерс' && h.searches[0].n === OFF_SEARCH_LIMIT, `поиск обязан уйти один раз с обрезанным запросом и лимитом, получено ${JSON.stringify(h.searches)}`)
  assert(h.states[0].view.phase === 'loading' && h.controller.state().view.phase === 'list', 'сначала loading, затем list')
  group('FoodSearch: запрос уходит только из search(), пробелы обрезаются, пустой игнорируется')

  const barcode = harness(async () => okSearch([]))
  await barcode.controller.search('5000159461122')
  assert(barcode.searches.length === 0 && barcode.fetches.join() === '5000159461122' && barcode.opened.length === 1, 'штрихкод обязан идти за карточкой, минуя список')
  assert(barcode.controller.state().card.phase === 'idle', 'после открытия карточки загрузка снимается')
  group('FoodSearch: штрихкод в поле просит карточку, а не список')

  const slow = deferred<OffSearchResult>()
  const busy = harness(() => slow.promise)
  const first = busy.controller.search('milk')
  await busy.controller.search('bread')
  assert(busy.searches.length === 1, 'пока идёт загрузка, второй поиск не стартует')
  slow.resolve(okSearch([product()]))
  await first
  assert(busy.controller.state().view.phase === 'list', 'после ответа список показан')
  group('FoodSearch: пока идёт загрузка, повторный поиск не уходит (лимит OFF по IP)')

  const staleSearch = deferred<OffSearchResult>()
  const slowCard = deferred<OffProductResult>()
  const stale = harness(() => staleSearch.promise, () => slowCard.promise)
  const pendingSearch = stale.controller.search('milk')
  // карточку открыли по строке до ответа списка: busy search() не пускает, но fetchCard доступен напрямую
  const pendingCard = stale.controller.fetchCard('5000159461122')
  slowCard.resolve({ ok: true, product: product() })
  await pendingCard
  staleSearch.resolve(okSearch([product({ name: 'Старый' })]))
  await pendingSearch
  assert(stale.controller.state().view.phase === 'loading', 'ответ поиска, обогнанный новым запросом, обязан отбрасываться и не затирать состояние')
  assert(stale.opened.length === 1, 'свежий ответ (карточка) обязан дойти до родителя')
  group('FoodSearch: устаревший ответ отбрасывается (seq)')

  const failing = harness(async () => okSearch([]), async () => ({ ok: false, reason: 'not-found', error: 'x' }))
  await failing.controller.fetchCard('5000159461122')
  const failed = failing.controller.state().card
  assert(failed.phase === 'error' && failed.text.includes('не найден'), `отказ карточки обязан давать русский текст, получено ${JSON.stringify(failed)}`)
  assert(failing.opened.length === 0, 'при отказе карточка не открывается')
  group('FoodSearch: отказ карточки not-found даёт текст и не открывает карточку')
}

function viewChecks(): void {
  const list = offViewFromResult(okSearch([product()], { skipped: 2, invalid: 3 }))
  assert(list.phase === 'list' && list.skipped === 2 && list.invalid === 3, `список обязан нести и skipped, и invalid, получено ${JSON.stringify(list)}`)
  const empty = offViewFromResult(okSearch([], { invalid: 4 }))
  assert(empty.phase === 'empty' && empty.invalid === 4, 'пустой список с invalid обязан сохранять число')
  const err = offViewFromResult({ ok: false, reason: 'unauthorized', error: 'Токен не принят' })
  assert(err.phase === 'error' && err.text === 'Токен не принят', 'отказ воркера идёт текстом как есть')
  assert(offInvalidText(0) === null && offSkippedText(0) === null, 'нулевые счётчики не дают подписи')
  assert(offInvalidText(3) !== null && offInvalidText(3)!.includes('3') && offSkippedText(2)!.includes('2'), 'ненулевые счётчики попадают в подпись')
  group('offViewFromResult: invalid не теряется ни в списке, ни в пустом ответе')
}

function printedChecks(): void {
  assert(formatPrinted(4.3) === '4.3' && formatPrinted(7.9) === '7.9', 'напечатанное идёт до десятых без хвоста нулей')
  assert(formatPrinted(251.5) === '251.5' && formatPrinted(6.7) === '6.7', 'миллиграммы тоже до десятых')
  assert(formatPrinted(0.04) === '< 0.1' && formatPrinted(0.05) === '0.1', 'малое напечатанное не округляется в ноль')
  group('formatPrinted: до десятых, малое значение не становится нулём')
}

function gramsChecks(): void {
  assert(PRODUCT_MAX_GRAMS === 5000, 'верхняя граница 5000')
  const cases: [string, number | null][] = [
    ['0', null], ['-1', null], ['', null], ['   ', null], ['abc', null], ['0.1', 0.1], ['5', 5], ['100', 100],
    ['5000', 5000], ['5000.1', null], ['1e9', null]
  ]
  for (const [text, want] of cases) {
    assert(parseProductGrams(text) === want, `parseProductGrams(${JSON.stringify(text)}) обязан дать ${want}, получено ${parseProductGrams(text)}`)
  }
  group('parseProductGrams: 0 и пусто отвергаются, 5000 проходит, 5000.1 отвергается')

  const labels = (p: OffProduct): string[] => gramsPresetsFor(p).map(x => `${x.key}:${x.grams}`)
  assert(labels(product({ servingG: 30, packageG: 250 })).join() === 'serving:30,package:250,hundred:100', 'порция, упаковка и 100 г')
  assert(labels(product({ servingG: 50, packageG: 50 })).join() === 'serving:50,hundred:100', 'упаковка, равная порции, не дублируется')
  assert(labels(product({ servingG: null, packageG: null })).join() === 'hundred:100', 'без порции и упаковки остаётся 100 г')
  assert(labels(product({ servingG: null, packageG: 400 })).join() === 'package:400,hundred:100', 'одна упаковка')
  group('gramsPresetsFor: порция, упаковка без дубля, 100 г всегда')
}

function flashChecks(): void {
  const scheduled: { fn: () => void; ms: number; id: number }[] = []
  const cancelled: number[] = []
  const log: boolean[] = []
  const flash = createFlash(
    2000,
    on => { log.push(on) },
    (fn, ms) => { const id = scheduled.length + 1; scheduled.push({ fn, ms, id }); return id },
    h => { cancelled.push(h as number) }
  )
  assert(flash.trigger() === true && log.join() === 'true' && scheduled[0].ms === 2000, 'первое нажатие включает подпись на 2000 мс')
  assert(flash.trigger() === false && scheduled.length === 1, 'повторное нажатие в окне не включает подпись и не плодит таймеры')
  scheduled[0].fn()
  assert(log.join() === 'true,false', 'по таймеру подпись гаснет')
  assert(flash.trigger() === true && scheduled.length === 2, 'после погасания можно нажать снова')
  flash.dispose()
  assert(cancelled.join() === '2', 'dispose снимает живой таймер')
  flash.dispose()
  assert(cancelled.length === 1, 'повторный dispose ничего не снимает')
  group('createFlash: подпись «Записано» гаснет по таймеру, повтор в окне игнорируется, dispose снимает таймер')
}

function requestStatusChecks(): void {
  const base: FoodRequest = newProductRequest('r1', product(), 50, '', { date: '2026-10-17', slot: 'breakfast' }, 1, '2026-10-17T12:00:00.000Z')
  const withStatus = (extra: Partial<FoodRequest>): FoodRequest => ({ ...base, ...extra })

  assert(base.kind === 'product' && base.status === 'pending', 'новый заказ по товару ждёт в очереди')
  assert(requestStatusText(withStatus({ pcAgo: null }))!.includes('ещё ни разу не выходил'), 'pending без связи с компьютером')
  assert(requestStatusText(withStatus({ pcAgo: 30 }))!.includes('на связи (30 с назад)'), 'pending, компьютер на связи')
  assert(requestStatusText(withStatus({ pcAgo: 120 }))!.includes('на связи'), 'граница 120 с ещё «на связи»')
  const offline = requestStatusText(withStatus({ pcAgo: 7200 }))!
  assert(offline.includes('не в сети уже 2 часа') && offline.includes('сутки'), `pending, компьютер выключен: ${offline}`)
  assert(requestStatusText(withStatus({ pcAgo: 121 }))!.includes('не в сети'), 'после 120 с компьютер считается не в сети')
  assert(requestStatusText(withStatus({ status: 'failed', error: 'Воркер отказал' })) === 'Воркер отказал', 'failed показывает текст ошибки')
  assert(requestStatusText(withStatus({ status: 'failed' })) === 'Разбор не удался', 'failed без текста: запасная подпись')
  assert(requestStatusText(withStatus({ status: 'expired' })) === 'Компьютер не взял запрос за сутки.', 'expired')
  assert(requestStatusText(withStatus({ status: 'done' })) === null, 'done статус не рисует')
  group('requestStatusText: заказ по товару в pending (3 ветки), failed (2), expired и done')
}

async function main(): Promise<void> {
  await searchChecks()
  viewChecks()
  printedChecks()
  gramsChecks()
  flashChecks()
  requestStatusChecks()
  console.log(`\nВсе проверки food-ui пройдены (${passed} групп).`)
}

main().catch((e) => {
  console.error('\n✗ ТЕСТ FOOD-UI УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
})
