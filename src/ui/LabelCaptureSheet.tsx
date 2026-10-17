/* Шторка «Сфоткать наклейку»: камера, сжатие, выбор приёма и доли, отправка
   на разбор. Каркас общий, Sheet.tsx; сетевой вызов делает App.tsx через
   onSubmit, здесь только съёмка и форма.

   Снимок (base64) живёт ТОЛЬКО в useRef этой шторки: в useState, в состояние
   приложения и в localStorage он не попадает (решение D6). В state лежит лишь
   object URL превью и маленькие служебные значения. Ref нужен, чтобы повтор
   после ошибки отправки не заставлял снимать заново. Закрытие шторки
   размонтирует тело, ref пропадает вместе с ним, URL превью освобождается. */

import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { SLOT_TITLE, SLOTS } from '../core/types.ts'
import type { Slot } from '../core/types.ts'
import { FractionPicker } from './FractionPicker.tsx'
import { compressLabelPhoto, LABEL_UNREADABLE_ERROR } from './labelImage.ts'
import Sheet from './Sheet.tsx'

export interface LabelAsk {
  /** Base64 JPEG без префикса data:. */
  image: string
  mime: 'image/jpeg'
  note: string
  grams: number | null
  target: { date: string; slot: Slot }
  /** Доля порции 0..1. */
  fraction: number
}

type SubmitResult = { ok: true } | { ok: false; error: string }

export interface LabelCaptureSheetProps {
  open: boolean
  date: string
  defaultSlot: Slot
  /** Пустая строка: разбор не настроен (Settings.shturmanToken). */
  hasToken: boolean
  onClose: () => void
  onSubmit: (ask: LabelAsk) => Promise<SubmitResult>
  /** Начальные значения формы при пересъёмке: заказ переносится целиком.
      Без пропа: 100 %, пустая заметка, граммы не заданы. */
  initial?: LabelInitial
}

export interface LabelInitial {
  fraction: number
  note: string
  grams: number | null
}

const MAX_GRAMS = 5000
/** Совпадает с FOOD_TEXT_MAX воркера для заметки. */
const NOTE_MAX = 600

type Phase = 'pick' | 'compressing' | 'ready' | 'sending'

interface Shot {
  image: string
  mime: 'image/jpeg'
}

function CaptureBody({
  date, defaultSlot, hasToken, onClose, onSubmit, initial
}: Omit<LabelCaptureSheetProps, 'open'>) {
  const [phase, setPhase] = useState<Phase>('pick')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [slot, setSlot] = useState<Slot>(defaultSlot)
  const [fraction, setFraction] = useState(initial?.fraction ?? 1)
  const [fractionValid, setFractionValid] = useState(true)
  const [note, setNote] = useState(initial?.note ?? '')
  const [gramsStr, setGramsStr] = useState(initial?.grams != null ? String(initial.grams) : '')
  const [error, setError] = useState<string | null>(null)

  const shotRef = useRef<Shot | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  // превью живёт, пока жива шторка или пока не выбран другой снимок
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }
  }, [previewUrl])

  const trimmedGrams = gramsStr.trim()
  let gramsValue: number | null = null
  let gramsError: string | null = null
  if (trimmedGrams !== '') {
    const parsed = Number(trimmedGrams)
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_GRAMS) {
      gramsError = `Граммы: число больше 0 и не больше ${MAX_GRAMS}.`
    } else {
      gramsValue = parsed
    }
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    // сброс: тот же файл можно выбрать повторно
    e.target.value = ''
    if (!file) return
    setError(null)
    setPhase('compressing')
    try {
      const photo = await compressLabelPhoto(file)
      if (!aliveRef.current) return
      shotRef.current = { image: photo.base64, mime: photo.mime }
      // превью строим из исходного файла: он уже на диске, лишней копии в памяти не делаем
      setPreviewUrl(URL.createObjectURL(file))
      setPhase('ready')
    } catch (err) {
      if (!aliveRef.current) return
      // прежний снимок (если был) остаётся: неудачная пересъёмка его не стирает
      setError(err instanceof Error ? err.message : LABEL_UNREADABLE_ERROR)
      setPhase(shotRef.current ? 'ready' : 'pick')
    }
  }

  async function handleSubmit(): Promise<void> {
    const shot = shotRef.current
    if (!shot || phase !== 'ready' || gramsError !== null || !fractionValid) return
    setPhase('sending')
    setError(null)
    const result = await onSubmit({
      image: shot.image,
      mime: shot.mime,
      note: note.trim(),
      grams: gramsValue,
      target: { date, slot },
      fraction
    })
    if (!aliveRef.current) return
    if (result.ok) {
      onClose()
    } else {
      setError(result.error)
      setPhase('ready')
    }
  }

  const busy = phase === 'compressing' || phase === 'sending'

  return (
    <Sheet title="Сфоткать наклейку" onClose={onClose}>
      <div className="label-capture">
        {!hasToken
          ? (
            <div className="card custom-food-no-token">
              <p className="custom-food-no-token__text">
                Наклейка разбирается на домашнем компьютере через Штурмана. Чтобы заказать разбор,
                впиши токен приложения в Настройках.
              </p>
            </div>
          )
          : (
            <>
              <input
                ref={inputRef}
                className="label-capture__file"
                type="file"
                accept="image/*"
                capture="environment"
                tabIndex={-1}
                aria-hidden="true"
                onChange={handleFile}
              />

              {previewUrl && (
                <img className="label-capture__preview" src={previewUrl} alt="Снимок наклейки" />
              )}

              {phase === 'compressing' && (
                <p className="label-capture__status" role="status">Сжимаю снимок…</p>
              )}

              <button
                type="button"
                className={previewUrl ? 'btn btn--secondary' : 'btn btn--primary'}
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                {previewUrl ? 'Переснять' : 'Сфоткать наклейку'}
              </button>

              {previewUrl && (
                <section className="card label-capture__form" aria-label="Параметры записи">
                  <div className="label-capture__group" role="group" aria-label="Приём">
                    {SLOTS.map(s => (
                      <button
                        key={s}
                        type="button"
                        className={s === slot ? 'chip chip--tap chip--selected' : 'chip chip--tap'}
                        aria-pressed={s === slot}
                        disabled={busy}
                        onClick={() => setSlot(s)}
                      >
                        {SLOT_TITLE[s]}
                      </button>
                    ))}
                  </div>

                  <div className="label-capture__fraction">
                    <span className="field__label">Сколько съел</span>
                    <FractionPicker value={fraction} onChange={setFraction} onValidityChange={setFractionValid} idPrefix="label-capture" />
                  </div>

                  <label className="field">
                    <span className="field__label">Заметка (необязательно)</span>
                    <input
                      type="text"
                      className="field__input"
                      value={note}
                      maxLength={NOTE_MAX}
                      placeholder="например, без соуса"
                      onChange={e => setNote(e.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span className="field__label">Вес порции, г (необязательно)</span>
                    <input
                      type="number"
                      className="field__input"
                      value={gramsStr}
                      min={0}
                      max={MAX_GRAMS}
                      placeholder="370"
                      onChange={e => setGramsStr(e.target.value)}
                    />
                    {gramsError && <span className="field__hint custom-food__error">{gramsError}</span>}
                  </label>

                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy || gramsError !== null || !fractionValid}
                    onClick={handleSubmit}
                  >
                    {phase === 'sending' ? 'Отправляю…' : 'Отправить на разбор'}
                  </button>
                </section>
              )}

              {error && <p className="custom-food__error" role="alert">{error}</p>}
            </>
          )}
      </div>
    </Sheet>
  )
}

export function LabelCaptureSheet({ open, ...rest }: LabelCaptureSheetProps) {
  // тело монтируется при открытии: состояние, снимок и превью сбрасываются само
  return open ? <CaptureBody {...rest} /> : null
}

export default LabelCaptureSheet
