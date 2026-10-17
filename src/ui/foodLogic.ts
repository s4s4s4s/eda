/* Логика экранов «Своя еда» без React: поиск Open Food Facts, граммы карточки
   товара, подпись «Записано» у книги. Вынесена из компонентов, чтобы тесты
   (test/food-ui.test.ts) гоняли её в node без DOM. Компоненты только рисуют
   состояние и зовут эти функции. */

import { isBarcode, normalizeBarcode } from '../core/food.ts'
import type { FoodClientFailureReason, OffClientFailureReason, OffProductResult, OffSearchResult } from '../core/foodClient.ts'
import type { OffProduct } from '../core/types.ts'

/** Сколько товаров просит поиск у воркера. */
export const OFF_SEARCH_LIMIT = 10

export const OFF_EMPTY_TEXT = 'В Open Food Facts ничего не нашлось. Попробуй по-английски или по штрихкоду.'
export const OFF_LOADING_TEXT = 'Ищу в Open Food Facts…'
export const OFF_INVALID_TEXT = 'Ответ воркера не разобран: обнови приложение.'
const OFF_NOT_FOUND_TEXT = 'Товар с таким штрихкодом в Open Food Facts не найден'
const OFF_NO_NUTRITION_TEXT = 'У товара в Open Food Facts нет полного КБЖУ на 100 г'

/** Текст отказа по причине. Для остальных причин текст уже русский: его дал клиент
    или воркер (reason 'off' у заказа приходит с текстом воркера). */
export function offFailureText(reason: OffClientFailureReason | FoodClientFailureReason, error: string): string {
  if (reason === 'not-found') return OFF_NOT_FOUND_TEXT
  if (reason === 'no-nutrition') return OFF_NO_NUTRITION_TEXT
  return error
}

/** Число на экран: до десятых, без хвоста нулей. */
export function formatPer100(value: number): string {
  return String(Number(value.toFixed(1)))
}

/** Значение, напечатанное на упаковке, в строку «Напечатано также»: так же до
    десятых, как КБЖУ на 100 г. В карточку попадает только напечатанное больше
    нуля, и округление не вправе превратить его в «0»: это читалось бы как
    измеренный ноль, поэтому совсем малое число пишется как «< 0.1». */
export function formatPrinted(value: number): string {
  return value > 0 && value < 0.05 ? '< 0.1' : formatPer100(value)
}

/** Подпись под списком: сколько товаров отсеял воркер (нет КБЖУ). Пусто, если ни одного. */
export function offSkippedText(skipped: number): string | null {
  return skipped > 0 ? `Ещё ${skipped} без КБЖУ не показаны.` : null
}

/** Подпись под списком: сколько товаров клиент не смог разобрать (формат ответа
    изменился). Отдельно от skipped: это не отсев воркера, а потеря на нашей стороне. */
export function offInvalidText(invalid: number): string | null {
  return invalid > 0 ? `Ещё ${invalid} не разобраны: формат ответа изменился, обнови приложение.` : null
}

export type CardView = { phase: 'idle' } | { phase: 'loading' } | { phase: 'error'; text: string }

export type OffView =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'empty'; invalid: number }
  | { phase: 'error'; text: string }
  | { phase: 'list'; items: OffProduct[]; skipped: number; invalid: number }

export interface OffSearchState {
  view: OffView
  card: CardView
}

export const OFF_IDLE_STATE: OffSearchState = { view: { phase: 'idle' }, card: { phase: 'idle' } }

/** Что показать по ответу поиска. */
export function offViewFromResult(result: OffSearchResult): OffView {
  if (!result.ok) return { phase: 'error', text: offFailureText(result.reason, result.error) }
  if (result.items.length === 0) return { phase: 'empty', invalid: result.invalid }
  return { phase: 'list', items: result.items, skipped: result.skipped, invalid: result.invalid }
}

export interface OffSearchDeps {
  searchOff: (q: string, n: number) => Promise<OffSearchResult>
  fetchProduct: (code: string) => Promise<OffProductResult>
  /** Карточка получена: родитель показывает ProductCard. */
  openProduct: (product: OffProduct) => void
}

export interface OffSearchController {
  state: () => OffSearchState
  /** Запрос уходит только отсюда (кнопка «Найти» или Enter), никогда не на ввод буквы. */
  search: (query: string) => Promise<void>
  fetchCard: (code: string) => Promise<void>
}

/** Состояние раздела Open Food Facts. Ответ, пришедший после нового запроса,
    отбрасывается: показывается всегда последний. Пока идёт загрузка, новый
    поиск не стартует (busy). deps берутся при каждом вызове: родитель отдаёт
    свежие колбэки на каждый рендер. */
export function createOffSearch(getDeps: () => OffSearchDeps, onState: (state: OffSearchState) => void): OffSearchController {
  let current = OFF_IDLE_STATE
  let seq = 0

  function set(next: OffSearchState): void {
    current = next
    onState(next)
  }

  async function fetchCard(code: string): Promise<void> {
    const mine = ++seq
    set({ ...current, card: { phase: 'loading' } })
    const result = await getDeps().fetchProduct(code)
    if (mine !== seq) return
    if (result.ok) {
      set({ ...current, card: { phase: 'idle' } })
      getDeps().openProduct(result.product)
    } else {
      set({ ...current, card: { phase: 'error', text: offFailureText(result.reason, result.error) } })
    }
  }

  async function search(query: string): Promise<void> {
    const trimmed = query.trim()
    if (trimmed === '' || current.view.phase === 'loading' || current.card.phase === 'loading') return
    if (isBarcode(trimmed)) {
      await fetchCard(normalizeBarcode(trimmed))
      return
    }
    const mine = ++seq
    set({ view: { phase: 'loading' }, card: { phase: 'idle' } })
    const result = await getDeps().searchOff(trimmed, OFF_SEARCH_LIMIT)
    if (mine !== seq) return
    set({ ...current, view: offViewFromResult(result) })
  }

  return { state: () => current, search, fetchCard }
}

/* ---- граммы карточки товара ---- */

/** Верхняя граница граммов: как у воркера и у шторки съёмки. */
export const PRODUCT_MAX_GRAMS = 5000

/** Граммы из поля: число строго больше 0 и не больше PRODUCT_MAX_GRAMS, иначе null. */
export function parseProductGrams(text: string): number | null {
  if (text.trim() === '') return null
  const grams = Number(text)
  return Number.isFinite(grams) && grams > 0 && grams <= PRODUCT_MAX_GRAMS ? grams : null
}

export interface GramsPreset {
  key: string
  label: string
  grams: number
}

export function gramsPresetsFor(product: OffProduct): GramsPreset[] {
  const presets: GramsPreset[] = []
  if (product.servingG !== null) presets.push({ key: 'serving', label: `Порция ${product.servingG} г`, grams: product.servingG })
  if (product.packageG !== null && product.packageG !== product.servingG) {
    presets.push({ key: 'package', label: `Упаковка ${product.packageG} г`, grams: product.packageG })
  }
  presets.push({ key: 'hundred', label: '100 г', grams: 100 })
  return presets
}

/* ---- подпись «Записано» у книги ---- */

export interface Flash {
  /** Включает подпись на ms; false, если она уже включена (повторное нажатие). */
  trigger: () => boolean
  /** Снимает таймер: строка размонтирована, setState в пустоту не придёт. */
  dispose: () => void
}

export function createFlash(
  ms: number,
  onChange: (on: boolean) => void,
  schedule: (fn: () => void, ms: number) => unknown = setTimeout,
  cancel: (handle: unknown) => void = h => clearTimeout(h as ReturnType<typeof setTimeout>)
): Flash {
  let handle: unknown = null
  return {
    trigger() {
      if (handle !== null) return false
      onChange(true)
      handle = schedule(() => {
        handle = null
        onChange(false)
      }, ms)
      return true
    },
    dispose() {
      if (handle !== null) cancel(handle)
      handle = null
    }
  }
}
