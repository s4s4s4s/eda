// Детерминированная подгонка граммов состава под КБЖУ с наклейки.
//
// Наклейка печатает итоговые числа на порцию, а граммов ингредиентов не
// даёт; модель предлагает только стартовые граммы (доли по порядку состава).
// Здесь граммы подгоняются так, чтобы КБЖУ по записям USDA как можно ближе
// сошлось с напечатанным, а масса состава - с весом порции. Чистый ESM без
// зависимостей от TS-ядра и без случайности: два вызова с одним входом дают
// байт в байт один результат (порядок обхода и число итераций фиксированы).
//
// Целевая функция (x - граммы, g0 - стартовые граммы):
//   Σ_k w_k·((a_k·x − L_k)/L_k)² + λ·Σ_i ((x_i − g0_i)/g0_i)²
// k пробегает kcal, p, f, c (a_k = per100_k/100, w = 1, строка пропускается
// при L_k <= 0) и строку массы (a = 1, L = massG, w = 2, если massG задан).
// Границы x_i ∈ [max(1, 0.2·g0_i), min(4·g0_i, GRAMS_MAX)]: верхний предел
// 5000 г общий с resolveSpec, иначе подогнанное значение не прошло бы
// повторный расчёт. Метод: проекционный градиентный спуск.

export const LAMBDA = 0.05;
export const MASS_WEIGHT = 2;
export const MAX_ITER = 2000;
export const EPS = 1e-4;
export const POOR_DEVIATION_PCT = 30;
export const GRAMS_MAX = 5000;
const MACROS = ['kcal', 'p', 'f', 'c'];

function round1(n) {
  return Math.round(n * 10) / 10;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function totalsAt(components, grams) {
  const total = { kcal: 0, p: 0, f: 0, c: 0 };
  components.forEach((comp, i) => {
    for (const key of MACROS) total[key] += (comp.per100.kbju[key] * grams[i]) / 100;
  });
  return total;
}

function deviation(actual, wanted) {
  return wanted > 0 ? round1(((actual - wanted) / wanted) * 100) : null;
}

/** Подгонка граммов.
    components: [{ grams, per100: { kbju: {kcal,p,f,c} } }] (как после resolveSpec);
    target: { kcal, p, f, c } на порцию; massG: вес порции или null.
    Возвращает { grams: number[], fit } или null при пустом составе.
    fit = { usdaKbju, deviationPct:{kcal,p,f,c}, massDeviationPct, poor }. */
export function fitGrams(components, target, massG) {
  if (!Array.isArray(components) || components.length === 0) return null;
  const n = components.length;
  const g0 = components.map((c) => c.grams);

  // Строки невязок: коэффициенты a, цель L, вес w.
  const rows = [];
  for (const key of MACROS) {
    const L = target[key];
    if (!(L > 0)) continue;
    rows.push({ a: components.map((c) => c.per100.kbju[key] / 100), L, w: 1 });
  }
  const hasMass = typeof massG === 'number' && massG > 0;
  if (hasMass) rows.push({ a: g0.map(() => 1), L: massG, w: MASS_WEIGHT });

  const lo = g0.map((g) => Math.max(1, 0.2 * g));
  const hi = g0.map((g) => Math.min(4 * g, GRAMS_MAX));

  // Шаг 1/trace при градиенте половинной целевой функции (то есть половина
  // шага на полный градиент): так спуск устойчив и при одной строке ранга 1.
  let trace = 0;
  for (const row of rows) {
    for (let i = 0; i < n; i++) trace += row.w * (row.a[i] / row.L) ** 2;
  }
  for (let i = 0; i < n; i++) trace += LAMBDA / (g0[i] * g0[i]);
  const step = 1 / trace;

  let x = g0.map((g, i) => clamp(g, lo[i], hi[i]));
  for (let iter = 0; iter < MAX_ITER; iter++) {
    const grad = new Array(n).fill(0);
    for (const row of rows) {
      let dot = 0;
      for (let i = 0; i < n; i++) dot += row.a[i] * x[i];
      const r = (dot - row.L) / row.L;
      for (let i = 0; i < n; i++) grad[i] += (row.w * r * row.a[i]) / row.L;
    }
    let maxDelta = 0;
    const next = x.map((xi, i) => {
      grad[i] += (LAMBDA * (xi - g0[i])) / (g0[i] * g0[i]);
      const v = clamp(xi - step * grad[i], lo[i], hi[i]);
      maxDelta = Math.max(maxDelta, Math.abs(v - xi));
      return v;
    });
    x = next;
    if (maxDelta < EPS) break;
  }

  const grams = x.map(round1);
  const usda = totalsAt(components, grams);
  const deviationPct = {};
  for (const key of MACROS) deviationPct[key] = deviation(usda[key], target[key]);
  const massSum = grams.reduce((s, g) => s + g, 0);
  const massDeviationPct = hasMass ? deviation(massSum, massG) : null;
  const devs = [...Object.values(deviationPct), massDeviationPct];
  const poor = devs.some((d) => d !== null && Math.abs(d) > POOR_DEVIATION_PCT);
  const usdaKbju = {};
  for (const key of MACROS) usdaKbju[key] = round1(usda[key]);

  return { grams, fit: { usdaKbju, deviationPct, massDeviationPct, poor } };
}
