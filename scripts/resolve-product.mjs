#!/usr/bin/env node
// Принимает очищенную спецификацию товара Open Food Facts на stdin (факты
// товара от воркера плюс ответ модели после validateProductSpec в раннере
// Штурмана) и печатает на stdout FoodResult spec 3: КБЖУ пересчитаны с 100 г
// на выбранные граммы, граммы состава подогнаны под них
// (scripts/lib/label-fit.mjs), микронутриенты посчитаны по USDA той же
// арифметикой, что у resolve-food.mjs (scripts/lib/usda.mjs), а напечатанные
// на упаковке клетчатка, сахара, насыщенные жиры, холестерин и натрий
// перекрывают одноимённые значения USDA.
//
// Вход:
//   { title, grams,
//     product: { code, per100: { kcal, p, f, c }, printedMicro?: { fiber?, sugar?,
//                satFat?, cholesterol?, sodium? }, ...остальные поля OffProduct },
//     components?: [{ fdcId, grams, note? }], remark?: string }
// printedMicro на 100 г в единицах NUTRIENT_UNIT, только значения > 0.
//
// Код возврата, как у resolve-label.mjs:
//   0: успех, FoodResult { ok: true, ... } в stdout;
//   2: спецификация или данные не годятся, { ok: false, error } в stdout;
//   1: сбой скрипта (нет выгрузки, каталог не читается), причина в stderr.
//
// Запуск:
//   node scripts/resolve-product.mjs [--fdc <путь>] < спецификация.json
//   путь к выгрузке SR Legacy: флаг --fdc, иначе переменная FDC_DIR.

import { fileURLToPath } from 'node:url';

import {
  resolveFdcDir, loadFoods, loadCategories, loadNutrientsFor, resolveSpec, round,
  FoodSpecError, FoodDataError, NUTRIENT_KEY_LIST, SOURCE,
} from './lib/usda.mjs';
import { fitGrams, GRAMS_MAX } from './lib/label-fit.mjs';

const OFF_SOURCE = 'Open Food Facts';
const PRODUCT_SOURCE = `${OFF_SOURCE} + ${SOURCE}`;
const MACROS = ['kcal', 'p', 'f', 'c'];
// Ключи, которые воркер берёт с упаковки (PRINTED_MICRO_KEYS в src/core/types.ts).
const PRINTED_MICRO_KEYS = ['fiber', 'sugar', 'satFat', 'cholesterol', 'sodium'];
const CODE_RE = /^\d{8,14}$/;

function parseArgs(argv) {
  let fdc;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fdc') fdc = argv[++i];
  }
  return { fdc };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function collectWantedIds(spec) {
  if (!Array.isArray(spec?.components)) return new Set();
  return new Set(
    spec.components
      .map((c) => (c && typeof c === 'object' ? c.fdcId : undefined))
      .filter((id) => Number.isInteger(id) && id > 0)
      .map(String),
  );
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Проверка входа; возвращает нормализованные значения. */
function readProduct(spec) {
  if (!isObject(spec)) {
    throw new FoodSpecError('спецификация должна быть объектом');
  }
  if (typeof spec.title !== 'string' || spec.title.trim().length === 0) {
    throw new FoodSpecError('не задан title');
  }
  const grams = spec.grams;
  if (typeof grams !== 'number' || !Number.isFinite(grams) || grams <= 0 || grams > GRAMS_MAX) {
    throw new FoodSpecError(`grams должен быть конечным числом в (0, ${GRAMS_MAX}], получено ${JSON.stringify(grams)}`);
  }
  const product = spec.product;
  if (!isObject(product)) {
    throw new FoodSpecError('не задан product');
  }
  if (typeof product.code !== 'string' || !CODE_RE.test(product.code)) {
    throw new FoodSpecError(`product.code должен быть штрихкодом из 8-14 цифр, получено ${JSON.stringify(product.code)}`);
  }
  if (!isObject(product.per100)) {
    throw new FoodSpecError('не задан product.per100');
  }
  const per100 = {};
  for (const key of MACROS) {
    const v = product.per100[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new FoodSpecError(`product.per100.${key} должен быть неотрицательным конечным числом, получено ${JSON.stringify(v)}`);
    }
    per100[key] = v;
  }
  const printedMicro = product.printedMicro ?? {};
  if (!isObject(printedMicro)) {
    throw new FoodSpecError('product.printedMicro должен быть объектом');
  }
  for (const [key, v] of Object.entries(printedMicro)) {
    if (!PRINTED_MICRO_KEYS.includes(key)) {
      throw new FoodSpecError(`product.printedMicro: неизвестный ключ ${JSON.stringify(key)}`);
    }
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new FoodSpecError(`product.printedMicro.${key} должен быть положительным конечным числом, получено ${JSON.stringify(v)}`);
    }
  }
  if (spec.components !== undefined && !Array.isArray(spec.components)) {
    throw new FoodSpecError('components должен быть списком');
  }
  if (spec.remark !== undefined && typeof spec.remark !== 'string') {
    throw new FoodSpecError('remark должен быть строкой');
  }
  return { grams, product, per100, printedMicro };
}

/* Товар без состава: нутриенты неизвестны. Одна неизвестная позиция (total 1),
   не ноль позиций: сумма дня складывает total, и при нуле день с таким блюдом
   выглядел бы собранным по всем позициям (как в resolve-label.mjs). */
function emptyNutrients() {
  const totals = {};
  for (const key of NUTRIENT_KEY_LIST) totals[key] = { value: 0, known: 0, total: 1 };
  return totals;
}

function roundKbju(k) {
  return Object.fromEntries(MACROS.map((key) => [key, round(k[key], 2)]));
}

/** Чистая функция: спецификация + таблицы USDA -> FoodResult spec 3
    (без поля request: его дописывает раннер). */
export function resolveProduct(spec, tables) {
  const { grams, product, per100, printedMicro } = readProduct(spec);
  const components = spec.components ?? [];
  const perPortion = roundKbju(Object.fromEntries(MACROS.map((key) => [key, (per100[key] * grams) / 100])));

  let source = OFF_SOURCE;
  let outComponents = [];
  let nutrients = emptyNutrients();
  let fit;

  if (components.length > 0) {
    const first = resolveSpec({ title: spec.title, components }, tables);
    const fitted = fitGrams(first.components, perPortion, grams);
    const final = resolveSpec(
      { title: spec.title, components: first.components.map((c, i) => ({ fdcId: c.fdcId, grams: fitted.grams[i], note: c.note })) },
      tables,
    );
    source = PRODUCT_SOURCE;
    outComponents = final.components;
    nutrients = final.nutrients;
    fit = fitted.fit;
  }

  // Напечатанное точнее аналога USDA: перекрывает его, одна известная позиция.
  for (const [key, printed] of Object.entries(printedMicro)) {
    nutrients[key] = { value: round((printed * grams) / 100, 3), known: 1, total: 1 };
  }

  const productOut = { ...product, grams, perPortion };
  if (typeof spec.remark === 'string' && spec.remark.length > 0) productOut.remark = spec.remark;

  const out = { ok: true, spec: 3, source, title: spec.title, product: productOut, components: outComponents, kbju: perPortion };
  if (fit) out.fit = fit;
  out.nutrients = nutrients;
  return out;
}

async function main() {
  const { fdc } = parseArgs(process.argv.slice(2));
  const fdcDir = resolveFdcDir(fdc);

  const raw = await readStdin();
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (err) {
    // Битый JSON от раннера: честный отказ по спецификации, а не сбой скрипта.
    throw new FoodSpecError(`stdin не разобрался как JSON: ${err.message}`);
  }

  const foods = await loadFoods(fdcDir);
  const categories = await loadCategories(fdcDir);
  const nutrientsById = await loadNutrientsFor(fdcDir, collectWantedIds(spec));

  const result = resolveProduct(spec, { foods, categories, nutrientsById });
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    if (err instanceof FoodSpecError || err instanceof FoodDataError) {
      process.stdout.write(JSON.stringify({ ok: false, error: err.message }) + '\n');
      process.exit(2);
    }
    console.error(err);
    process.exit(1);
  });
}
