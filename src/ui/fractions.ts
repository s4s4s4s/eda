/* Доли «съел часть» — общий словарь для панели действий экрана приёма,
   подписи «съедено (½)» и шторки переноса блюда из другого дня
   (AddFromMenuSheet), которая добавляет к этому же словарю долю 1
   («целиком»): доля не должна значить разное в двух местах экрана. */

export const FRACTIONS: { value: number; label: string }[] = [
  { value: 0.75, label: '3/4' },
  { value: 0.5, label: '1/2' },
  { value: 0.25, label: '1/4' }
]

/** Доля приёма человеческими словами. Доля 1 читается как «целиком»: у
    приёма меню это состояние 'eaten' и через эту функцию не проходит, а у
    добавленной еды (ExtraLogEntry) доля 1 — обычное значение, и оно обязано
    что-то печатать, а не «1». */
export function fractionLabel(fraction: number): string {
  if (fraction === 1) return 'целиком'
  return FRACTIONS.find(f => f.value === fraction)?.label ?? String(fraction)
}
