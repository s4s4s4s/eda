/* Карточка товара Open Food Facts внутри шторки «Своя еда»: что напечатано
   на упаковке, сколько граммов съедено, какой приём и доля. Две кнопки:
   «Записать и запросить витамины» (заказ уходит на домашний компьютер,
   onAskProduct) и «Записать без витаминов» (заказ собирается здесь, сеть не
   нужна, onLogProductNow). Числа сомнительного товара (warnings) показываются,
   но заказ не блокируют: человек видит упаковку и решает сам.

   Карточка не помнит, какой товар ей дали: родитель ставит key={product.code},
   тогда граммы и приём сбрасываются вместе с товаром. */

import { useState } from 'react'
import { newProductRequest, offWarningText } from '../core/food.ts'
import { formatNutrientAmount } from '../core/export/format.ts'
import type { FoodClientFailureReason, OffClientFailureReason } from '../core/foodClient.ts'
import type { FoodRequest, OffProduct, PrintedMicroKey, Slot } from '../core/types.ts'
import { NUTRIENT_TITLE, NUTRIENT_UNIT, OFF_SOURCE, PRINTED_MICRO_KEYS, SLOT_TITLE, SLOTS } from '../core/types.ts'
import { FractionPicker } from './FractionPicker.tsx'
import { formatPer100, offFailureText } from './FoodSearch.tsx'

/** Верхняя граница граммов: как у воркера и у шторки съёмки. */
export const PRODUCT_MAX_GRAMS = 5000

export type ProductAskResult =
  | { ok: true }
  | { ok: false; reason?: OffClientFailureReason | FoodClientFailureReason; error: string }

export interface ProductCardProps {
  product: OffProduct
  /** День записи: цель заказа всегда он. */
  date: string
  /** Приём, выбранный по умолчанию (текущий). */
  defaultSlot: Slot
  onBack: () => void
  /** «Записать и запросить витамины»: заказ на разбор, нужна сеть. */
  onAskProduct: (product: OffProduct, grams: number, slot: Slot, fraction: number) => Promise<ProductAskResult>
  /** «Записать без витаминов»: заказ собран локально (в очереди его может не быть). */
  onLogProductNow: (request: FoodRequest) => void
  /** Новый id заказа (эффект стороны, не ядро). */
  newRequestId: () => string
  /** Момент заказа, ISO. */
  now: () => string
}

interface Preset {
  key: string
  label: string
  grams: number
}

function presetsFor(product: OffProduct): Preset[] {
  const presets: Preset[] = []
  if (product.servingG !== null) presets.push({ key: 'serving', label: `Порция ${product.servingG} г`, grams: product.servingG })
  if (product.packageG !== null && product.packageG !== product.servingG) {
    presets.push({ key: 'package', label: `Упаковка ${product.packageG} г`, grams: product.packageG })
  }
  presets.push({ key: 'hundred', label: '100 г', grams: 100 })
  return presets
}

function printedText(product: OffProduct): string {
  const parts: string[] = []
  for (const key of PRINTED_MICRO_KEYS) {
    const value = product.printedMicro[key as PrintedMicroKey]
    if (value === undefined) continue
    parts.push(`${NUTRIENT_TITLE[key].toLowerCase()} ${formatNutrientAmount(value)} ${NUTRIENT_UNIT[key]}`)
  }
  return parts.join(', ')
}

export function ProductCard({
  product, date, defaultSlot, onBack, onAskProduct, onLogProductNow, newRequestId, now
}: ProductCardProps) {
  const [gramsStr, setGramsStr] = useState(String(product.servingG ?? product.packageG ?? 100))
  const [slot, setSlot] = useState<Slot>(defaultSlot)
  const [fraction, setFraction] = useState(1)
  const [fractionValid, setFractionValid] = useState(true)
  const [asking, setAsking] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const grams = Number(gramsStr.trim() === '' ? NaN : gramsStr)
  const gramsValid = Number.isFinite(grams) && grams > 0 && grams <= PRODUCT_MAX_GRAMS
  const canSubmit = gramsValid && fractionValid && !asking
  const printed = printedText(product)
  const { per100 } = product

  function buildRequest(): FoodRequest {
    return newProductRequest(newRequestId(), product, grams, '', { date, slot }, fraction, now())
  }

  async function handleAsk(): Promise<void> {
    if (!canSubmit) return
    setAsking(true)
    setFailure(null)
    const result = await onAskProduct(product, grams, slot, fraction)
    setAsking(false)
    if (!result.ok) {
      setFailure(result.reason === undefined ? result.error : offFailureText(result.reason, result.error))
    }
  }

  return (
    <section className="card product-card" aria-label="Карточка товара">
      <button type="button" className="btn btn--ghost product-card__back" onClick={onBack}>
        Назад к поиску
      </button>

      <header className="product-card__head">
        {product.brand !== '' && <p className="product-card__brand">{product.brand}</p>}
        <h3 className="product-card__name">{product.name}</h3>
        {product.quantityText !== '' && <p className="product-card__quantity">{product.quantityText}</p>}
      </header>

      <div className="product-card__facts">
        <p className="product-card__line">
          На 100 г: {formatPer100(per100.kcal)} ккал · Б {formatPer100(per100.p)} · Ж {formatPer100(per100.f)} · У {formatPer100(per100.c)}
        </p>
        <p className="product-card__printed">
          {printed !== '' ? `Напечатано также: ${printed}` : 'Сверх КБЖУ на упаковке ничего не напечатано'}
        </p>
      </div>

      {product.warnings.length > 0 && (
        <div className="product-card__warning" role="note">
          Числа с упаковки сомнительные: {product.warnings.map(offWarningText).join('; ')}
        </div>
      )}

      <div className="product-card__grams">
        <div className="product-card__presets" role="group" aria-label="Готовые граммы">
          {presetsFor(product).map(preset => (
            <button
              key={preset.key}
              type="button"
              className={'chip chip--tap product-card__preset' + (gramsValid && grams === preset.grams ? ' chip--selected' : '')}
              aria-pressed={gramsValid && grams === preset.grams}
              disabled={asking}
              onClick={() => setGramsStr(String(preset.grams))}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field__label">Граммы</span>
          <input
            type="number"
            inputMode="decimal"
            className="field__input product-card__grams-input"
            value={gramsStr}
            min={0}
            max={PRODUCT_MAX_GRAMS}
            aria-invalid={!gramsValid}
            onChange={e => setGramsStr(e.target.value)}
          />
          {!gramsValid && (
            <span className="field__hint custom-food__error">Граммы: число больше 0 и не больше {PRODUCT_MAX_GRAMS}.</span>
          )}
        </label>
      </div>

      <div className="product-card__slot" role="group" aria-label="Приём">
        {SLOTS.map(s => (
          <button
            key={s}
            type="button"
            className={s === slot ? 'chip chip--tap chip--selected' : 'chip chip--tap'}
            aria-pressed={s === slot}
            disabled={asking}
            onClick={() => setSlot(s)}
          >
            {SLOT_TITLE[s]}
          </button>
        ))}
      </div>

      <div className="product-card__fraction">
        <span className="field__label">Сколько съел</span>
        <FractionPicker value={fraction} onChange={setFraction} onValidityChange={setFractionValid} idPrefix="product-card" />
      </div>

      <p className="product-card__attribution">
        Данные: {OFF_SOURCE} (ODbL)
        {' · '}
        <a href={product.url} target="_blank" rel="noopener">карточка товара</a>
      </p>

      {failure !== null && <p className="custom-food__error" role="alert">{failure}</p>}

      <div className="product-card__actions">
        <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={() => void handleAsk()}>
          {asking ? 'Отправляю…' : 'Записать и запросить витамины'}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={!canSubmit}
          onClick={() => onLogProductNow(buildRequest())}
        >
          Записать без витаминов
        </button>
      </div>
    </section>
  )
}

export default ProductCard
