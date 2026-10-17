/* Доли «съел часть» — общий словарь для панели действий экрана приёма,
   подписи «съедено (½)» и шторки переноса блюда из другого дня
   (AddFromMenuSheet), которая добавляет к этому же словарю долю 1
   («целиком»): доля не должна значить разное в двух местах экрана. */

export const FRACTIONS: { value: number; label: string }[] = [
  { value: 0.75, label: '3/4' },
  { value: 0.5, label: '1/2' },
  { value: 0.25, label: '1/4' }
]

/** Быстрые значения шкалы процентов (FractionPicker). */
export const PERCENT_PRESETS: readonly number[] = [25, 50, 75, 100]

/** Доля из процента, введённого рукой: только целое 1..100, иначе null.
    Дробные («50.5»), ноль, отрицательные и больше 100 отклоняются, а не
    округляются молча: человек увидит, что ввод не принят. */
export function fractionFromPercent(pct: number): number | null {
  if (!Number.isInteger(pct) || pct < 1 || pct > 100) return null
  return pct / 100
}

/** Процент целым числом для поля ввода и подписи. */
export function percentFromFraction(fraction: number): number {
  return Math.round(fraction * 100)
}

/** Доля приёма человеческими словами. Доля 1 читается как «целиком»: у
    приёма меню это состояние 'eaten' и через эту функцию не проходит, а у
    добавленной еды (ExtraLogEntry) доля 1 — обычное значение, и оно обязано
    что-то печатать, а не «1». Остальное, не входящее в FRACTIONS, печатается
    процентом: «80%». */
export function fractionLabel(fraction: number): string {
  if (fraction === 1) return 'целиком'
  return FRACTIONS.find(f => f.value === fraction)?.label ?? `${percentFromFraction(fraction)}%`
}
