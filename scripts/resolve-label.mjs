#!/usr/bin/env node
// Принимает очищенную спецификацию наклейки на stdin (ответ модели после
// validateLabelSpec в раннере Штурмана) и печатает на stdout FoodResult
// spec 2: напечатанные КБЖУ пересчитаны на порцию, граммы состава подогнаны
// под них (scripts/lib/label-fit.mjs), микронутриенты посчитаны по USDA той
// же арифметикой, что у resolve-food.mjs (scripts/lib/usda.mjs).
//
// Вход:
//   { title, titleHy?, portionG?, grams?, dishNo?,
//     label: { basis: "portion" | "100g", kcal, p, f, c },
//     ingredients?: string[], remark?: string,
//     components?: [{ fdcId, grams, note? }] }
// portionG: вес порции с наклейки; grams: запасной вес из заказа.
//
// Код возврата, как у resolve-food.mjs:
//   0: успех, FoodResult { ok: true, ... } в stdout;
//   2: спецификация или данные не годятся, { ok: false, error } в stdout;
//   1: сбой скрипта (нет выгрузки, каталог не читается), причина в stderr.
//
// Запуск:
//   node scripts/resolve-label.mjs [--fdc <путь>] < спецификация.json
//   путь к выгрузке SR Legacy: флаг --fdc, иначе переменная FDC_DIR.

import { fileURLToPath } from 'node:url';

import {
  resolveFdcDir, loadFoods, loadCategories, loadNutrientsFor, resolveSpec, round,
  FoodSpecError, FoodDataError, NUTRIENT_KEY_LIST, SOURCE,
} from './lib/usda.mjs';
import { fitGrams } from './lib/label-fit.mjs';

const LABEL_SOURCE = `Наклейка + ${SOURCE}`;
const MACROS = ['kcal', 'p', 'f', 'c'];
const DISH_NO_MAX = 12;

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

function isPositiveFinite(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** Проверка полей наклейки; возвращает нормализованные значения. */
function readLabel(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new FoodSpecError('спецификация должна быть объектом');
  }
  if (typeof spec.title !== 'string' || spec.title.trim().length === 0) {
    throw new FoodSpecError('не задан title');
  }
  const label = spec.label;
  if (!label || typeof label !== 'object' || Array.isArray(label)) {
    throw new FoodSpecError('не задан label');
  }
  if (label.basis !== 'portion' && label.basis !== '100g') {
    throw new FoodSpecError(`label.basis должен быть "portion" или "100g", получено ${JSON.stringify(label.basis)}`);
  }
  const printed = {};
  for (const key of MACROS) {
    const v = label[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new FoodSpecError(`label.${key} должен быть неотрицательным конечным числом, получено ${JSON.stringify(v)}`);
    }
    printed[key] = v;
  }
  for (const key of ['portionG', 'grams']) {
    const v = spec[key];
    if (v !== undefined && v !== null && !isPositiveFinite(v)) {
      throw new FoodSpecError(`${key} должен быть положительным числом или null, получено ${JSON.stringify(v)}`);
    }
  }
  if (spec.components !== undefined && !Array.isArray(spec.components)) {
    throw new FoodSpecError('components должен быть списком');
  }
  if (spec.ingredients !== undefined
    && !(Array.isArray(spec.ingredients) && spec.ingredients.every((s) => typeof s === 'string'))) {
    throw new FoodSpecError('ingredients должен быть списком строк');
  }
  // Номер блюда не критичен для расчёта: битое значение превращается в null,
  // а наклейка не отклоняется.
  const dishNo = Number.isInteger(spec.dishNo) && spec.dishNo >= 1 && spec.dishNo <= DISH_NO_MAX ? spec.dishNo : null;
  return { printed, dishNo };
}

/* Наклейка без состава: еда съедена, а нутриенты неизвестны. Одна неизвестная
   позиция (total 1), не ноль позиций: сумма дня складывает total, и при нуле день
   с таким блюдом выглядел бы собранным по всем позициям (как UNKNOWN_POSITION
   в src/state/storage.ts). */
function emptyNutrients() {
  const totals = {};
  for (const key of NUTRIENT_KEY_LIST) totals[key] = { value: 0, known: 0, total: 1 };
  return totals;
}

function roundKbju(k) {
  return Object.fromEntries(MACROS.map((key) => [key, round(k[key], 2)]));
}

/** Чистая функция: спецификация + таблицы USDA -> FoodResult spec 2
    (без поля request: его дописывает раннер). */
export function resolveLabel(spec, tables) {
  const { printed, dishNo } = readLabel(spec);
  const components = spec.components ?? [];
  const portionG = spec.portionG ?? null;
  const base = { ok: true, spec: 2, source: LABEL_SOURCE, title: spec.title };

  const startCount = components.length;
  const first = startCount > 0 ? resolveSpec({ title: spec.title, components }, tables) : null;

  // Масса порции: вес с наклейки, затем вес из заказа, затем сумма граммов состава.
  const sumGrams = first ? first.components.reduce((s, c) => s + c.grams, 0) : null;
  const portionMass = portionG ?? spec.grams ?? sumGrams;

  let perPortion;
  if (spec.label.basis === 'portion') {
    perPortion = printed;
  } else {
    if (portionMass === null) {
      throw new FoodSpecError('На наклейке КБЖУ на 100 г, а вес порции неизвестен: укажи граммы при заказе');
    }
    perPortion = Object.fromEntries(MACROS.map((key) => [key, (printed[key] * portionMass) / 100]));
  }
  perPortion = roundKbju(perPortion);

  const labelOut = {
    titleHy: typeof spec.titleHy === 'string' ? spec.titleHy : '',
    basis: spec.label.basis,
    portionG,
    printed,
    perPortion,
    dishNo,
    ingredients: spec.ingredients ?? [],
  };
  if (typeof spec.remark === 'string' && spec.remark.length > 0) labelOut.remark = spec.remark;

  if (!first) {
    return { ...base, label: labelOut, components: [], kbju: perPortion, nutrients: emptyNutrients() };
  }

  const fitted = fitGrams(first.components, perPortion, portionMass);
  const final = resolveSpec(
    { title: spec.title, components: first.components.map((c, i) => ({ fdcId: c.fdcId, grams: fitted.grams[i], note: c.note })) },
    tables,
  );
  return {
    ...base,
    label: labelOut,
    components: final.components,
    kbju: perPortion,
    fit: fitted.fit,
    nutrients: final.nutrients,
  };
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

  const result = resolveLabel(spec, { foods, categories, nutrientsById });
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
