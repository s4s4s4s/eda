#!/usr/bin/env node
// Принимает FoodSpec на stdin ({ title, components: [{ fdcId, grams, note? }] })
// — ответ модели, подобравшей строки USDA под «свою еду» (см.
// pc/prompts/food.md в репозитории «Штурман») — и печатает на stdout
// FoodResult с числами КБЖУ и микронутриентов, посчитанными по
// scripts/lib/usda.mjs (та же арифметика и то же округление, что у
// scripts/build-products.mjs — правка меню и разбор своей еды не должны
// расходиться в цифрах для одного и того же fdcId).
//
// Поле request полного FoodResult (см. раздел 1.2 плана «своя еда») этот
// скрипт не пишет: у него нет исходного текста запроса (request.text/grams) —
// его знает только раннер, который сюда стучится (pc/food.mjs), и он же
// дополняет ответ этого скрипта перед записью в jobs.result. source и spec —
// наоборот, знание самого резолвера (какой датасет и по какой версии
// контракта считали числа), поэтому пишутся здесь, не раннером.
//
// Код возврата:
//   0 — успех, FoodResult { ok: true, ... } напечатан в stdout;
//   2 — спецификация или данные не годятся (неизвестный fdcId, нет чисел,
//       некорректная структура) — FoodResult { ok: false, error } напечатан
//       в stdout, это ЧЕСТНЫЙ отказ, а не сбой скрипта;
//   1 — сбой скрипта (не задан путь к выгрузке, каталог не читается и т.п.),
//       причина — в stderr, в stdout ничего не печатается.
//
// Запуск:
//   node scripts/resolve-food.mjs [--fdc <путь>] < спецификация.json
//   путь к выгрузке SR Legacy — флаг --fdc, иначе переменная FDC_DIR.

import { resolveFdcDir, loadFoods, loadCategories, loadNutrientsFor, resolveSpec, FoodSpecError, FoodDataError } from './lib/usda.mjs';

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
  if (!spec || !Array.isArray(spec.components)) return new Set();
  const ids = spec.components
    .map((c) => (c && typeof c === 'object' ? c.fdcId : undefined))
    .filter((id) => Number.isInteger(id) && id > 0)
    .map(String);
  return new Set(ids);
}

async function main() {
  const { fdc } = parseArgs(process.argv.slice(2));
  const fdcDir = resolveFdcDir(fdc);

  const raw = await readStdin();
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (err) {
    // Битый JSON от раннера — тоже честный отказ по спецификации, а не сбой
    // скрипта: сюда стучится не человек, и разговаривать с ним нужно в
    // формате {ok:false,error}, а не падением с трассировкой стека.
    throw new FoodSpecError(`stdin не разобрался как JSON: ${err.message}`);
  }

  const wantedIds = collectWantedIds(spec);
  const foods = await loadFoods(fdcDir);
  const categories = await loadCategories(fdcDir);
  const nutrientsById = await loadNutrientsFor(fdcDir, wantedIds);

  const result = resolveSpec(spec, { foods, categories, nutrientsById });
  process.stdout.write(JSON.stringify(result) + '\n');
}

main().catch((err) => {
  if (err instanceof FoodSpecError || err instanceof FoodDataError) {
    process.stdout.write(JSON.stringify({ ok: false, error: err.message }) + '\n');
    process.exit(2);
  }
  console.error(err);
  process.exit(1);
});
