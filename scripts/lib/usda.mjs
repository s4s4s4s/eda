// Единственное место в проекте, где живёт знание о формате CSV выгрузки
// USDA FoodData Central (набор SR Legacy, релиз 2018-04): разбор строк,
// потоковое чтение больших файлов и id нутриентов. Используется трёмя
// скриптами (build-products.mjs, food-search.mjs, resolve-food.mjs) — раньше
// первый нёс это знание в одиночку, и любое расхождение между сборкой
// справочника и подбором «своей еды» было бы невидимым до первого разъезда
// чисел. per100Of — одно округление на всех, чтобы build-products и
// resolve-food для одного и того же fdcId всегда давали одинаковое число.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';

// Название источника данных — одна строка на весь проект: build-products.mjs
// пишет её в шапку data/products.yaml, resolveSpec — в поле source
// результата разбора «своей еды». Разъехавшиеся тексты в двух местах хуже,
// чем один и тот же литерал в обоих: правка релиза датасета была бы правкой
// в двух файлах, и один легко забыть.
export const SOURCE = 'USDA SR Legacy 2018-04';

// Нутриенты SR Legacy, проверены по nutrient.csv (id -> name):
// 1008 Energy (KCAL), 1003 Protein (G), 1004 Total lipid (fat) (G),
// 1005 Carbohydrate, by difference (G).
export const NUTRIENT_IDS = { kcal: '1008', protein: '1003', fat: '1004', carbs: '1005' };

// Дополнительные нутриенты (клетчатка, минералы, витамины) — идут в micro100g
// продукта и в per100.micro результата разбора «своей еды». Отсутствие строки
// в food_nutrient.csv для конкретного продукта — это НЕ ноль, поле просто не
// попадает в результат (см. per100Of). Порядок ключей здесь = порядок
// NUTRIENT_KEYS в src/core/types.ts — держится вручную и намеренно, см.
// комментарий там же.
export const MICRO_NUTRIENT_IDS = {
  fiber: '1079',
  sugar: '2000',
  satFat: '1258',
  monoFat: '1292',
  polyFat: '1293',
  cholesterol: '1253',
  // ПНЖК: 1269/1270 — суммарные 18:2 и 18:3 (все изомеры), приближение к
  // изомер-специфичным 1316/1404 — обоснование и сверка заполненности в
  // build-products.mjs (APPROXIMATION_CHECK_IDS), здесь не дублируются.
  linoleic: '1269',
  ala: '1270',
  epa: '1278',
  dha: '1272',
  calcium: '1087',
  iron: '1089',
  magnesium: '1090',
  phosphorus: '1091',
  potassium: '1092',
  sodium: '1093',
  zinc: '1095',
  copper: '1098',
  manganese: '1101',
  selenium: '1103',
  vitA: '1106',
  retinol: '1105',
  vitC: '1162',
  vitD: '1114',
  vitE: '1109',
  vitK: '1185',
  thiamin: '1165',
  riboflavin: '1166',
  niacin: '1167',
  vitB6: '1175',
  // Folate, DFE (не "Folate, total" 1177) — см. build-products.mjs.
  folate: '1190',
  vitB12: '1178',
  pantothenic: '1170',
  choline: '1180',
  betaCarotene: '1107',
  alphaCarotene: '1108',
  betaCryptoxanthin: '1120',
  lycopene: '1122',
  luteinZeaxanthin: '1123',
  water: '1051',
};

// Порядок ключей micro — совпадает с NUTRIENT_KEYS в src/core/types.ts.
// scripts/*.mjs — обычный JS без сборки, импортировать типизированный список
// оттуда напрямую нельзя, поэтому источник правды по составу и порядку —
// MICRO_NUTRIENT_IDS выше (комментарий в types.ts указывает на этот файл).
export const NUTRIENT_KEY_LIST = Object.keys(MICRO_NUTRIENT_IDS);

// Знаков после запятой при округлении: ккал — целое, макросы (белки/жиры/
// углеводы) — сотые, микронутриенты — тысячные. Одна константа на все три
// скрипта, чтобы округление нигде не разъехалось по количеству знаков.
export const ROUND_DIGITS = { kcal: 0, macro: 2, micro: 3 };

/** Путь к распакованному каталогу SR Legacy: явный аргумент (флаг командной
    строки или позиционный, решает вызывающий) важнее переменной окружения
    FDC_DIR. Ни того ни другого нет — явная ошибка, а не тихая работа с
    неопределённым путём. */
export function resolveFdcDir(argvPath) {
  const dir = argvPath ?? process.env.FDC_DIR;
  if (!dir) {
    throw new Error(
      'Укажи путь к распакованному каталогу SR Legacy аргументом (--fdc или первым позиционным) либо через переменную окружения FDC_DIR.',
    );
  }
  return dir;
}

// ---------------------------------------------------------------------------
// CSV: все файлы SR Legacy заключают каждое поле в двойные кавычки, запятые и
// кавычки внутри значений экранируются удвоением кавычки ("").
// ---------------------------------------------------------------------------
export function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

export async function readCsvHeader(filePath) {
  const rl = createInterface({ input: createReadStream(filePath, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    rl.close();
    return parseCsvLine(line);
  }
  throw new Error(`Пустой файл: ${filePath}`);
}

export async function streamCsv(filePath, onRow) {
  const header = await readCsvHeader(filePath);
  const rl = createInterface({ input: createReadStream(filePath, 'utf8'), crlfDelay: Infinity });
  let isHeader = true;
  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    if (line.length === 0) continue;
    const fields = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = fields[i];
    onRow(row);
  }
}

export function round(n, digits) {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

/** Все строки food.csv: fdc_id -> { description, categoryId }. Файл проекта —
    7 794 строки, целиком в памяти дешевле, чем стримить его на каждый запрос
    поиска. */
export async function loadFoods(dir) {
  const foods = new Map();
  await streamCsv(path.join(dir, 'food.csv'), (row) => {
    foods.set(row.fdc_id, { description: row.description, categoryId: row.food_category_id });
  });
  return foods;
}

/** food_category.csv: id -> человекочитаемое название категории. */
export async function loadCategories(dir) {
  const categories = new Map();
  await streamCsv(path.join(dir, 'food_category.csv'), (row) => {
    categories.set(row.id, row.description);
  });
  return categories;
}

/** measure_unit.csv: id -> название единицы измерения (у SR Legacy почти
    всегда id 9999 — "undetermined": реальная мера лежит в modifier строки
    food_portion.csv, а не в этой таблице). */
export async function loadMeasureUnits(dir) {
  const units = new Map();
  await streamCsv(path.join(dir, 'measure_unit.csv'), (row) => {
    units.set(row.id, row.name);
  });
  return units;
}

/** Меры порций для набора fdc_id — только нужные, файл проекта (14 450
    строк) не читается целиком ради горстки продуктов. Результат:
    fdc_id -> [{ amount, unit, modifier, grams }], отсортировано как в
    источнике (seq_num). idSet — Set строк fdc_id. */
export async function loadPortions(dir, idSet) {
  const units = await loadMeasureUnits(dir);
  const bySeq = new Map(); // fdc_id -> [{ seq, portion }]
  await streamCsv(path.join(dir, 'food_portion.csv'), (row) => {
    if (!idSet.has(row.fdc_id)) return;
    const list = bySeq.get(row.fdc_id) ?? [];
    list.push({
      seq: Number(row.seq_num),
      portion: {
        amount: Number(row.amount),
        unit: units.get(row.measure_unit_id) ?? row.measure_unit_id,
        modifier: row.modifier || row.portion_description || null,
        grams: Number(row.gram_weight),
      },
    });
    bySeq.set(row.fdc_id, list);
  });
  const portions = new Map();
  for (const [fdcId, list] of bySeq) {
    list.sort((a, b) => a.seq - b.seq);
    portions.set(fdcId, list.map((x) => x.portion));
  }
  return portions;
}

/** Строки food_nutrient.csv для набора fdc_id — файл 36 МБ, читается
    потоково, лишнее не задерживается в памяти. Результат:
    fdc_id -> { nutrient_id -> amount }. idSet — Set строк fdc_id. */
export async function loadNutrientsFor(dir, idSet) {
  const byFood = new Map();
  await streamCsv(path.join(dir, 'food_nutrient.csv'), (row) => {
    if (!idSet.has(row.fdc_id)) return;
    const bucket = byFood.get(row.fdc_id) ?? {};
    bucket[row.nutrient_id] = Number(row.amount);
    byFood.set(row.fdc_id, bucket);
  });
  return byFood;
}

/** Числа на 100 г из строки food_nutrient.csv одного продукта (USDA хранит
    amount уже как «на 100 г»). Бросает, если нет хотя бы одного из четырёх
    базовых макросов — без них КБЖУ не посчитать, а тихая подстановка нуля
    выдала бы за измерение то, чего измерение не знает.
    Одна функция на build-products.mjs и resolve-food.mjs: одинаковое
    округление гарантирует, что справочник продуктов и разбор «своей еды»
    по тому же fdcId дают одно и то же число. */
export function per100Of(nutrientRow) {
  const missingMacro = Object.entries(NUTRIENT_IDS)
    .filter(([, id]) => nutrientRow?.[id] === undefined)
    .map(([field]) => field);
  if (missingMacro.length > 0) {
    throw new Error(`нет нутриентов [${missingMacro.join(', ')}]`);
  }

  const kbju = {
    kcal: round(nutrientRow[NUTRIENT_IDS.kcal], ROUND_DIGITS.kcal),
    p: round(nutrientRow[NUTRIENT_IDS.protein], ROUND_DIGITS.macro),
    f: round(nutrientRow[NUTRIENT_IDS.fat], ROUND_DIGITS.macro),
    c: round(nutrientRow[NUTRIENT_IDS.carbs], ROUND_DIGITS.macro),
  };

  // Поле пишем ТОЛЬКО если в food_nutrient.csv реально есть строка для этого
  // нутриента у этого fdc_id — отсутствие строки не ноль, а неизвестность.
  const micro = {};
  for (const [field, id] of Object.entries(MICRO_NUTRIENT_IDS)) {
    const amount = nutrientRow[id];
    if (amount !== undefined) micro[field] = round(amount, ROUND_DIGITS.micro);
  }

  return { kbju, micro };
}

/** Спецификация своей еды (ответ модели): { title, components: [{ fdcId, grams, note? }] }. */

/** Отказ по спецификации: структура запроса не годится (не тот тип поля,
    значение вне допустимых пределов) — ошибка в том, ЧТО прислали, а не в
    том, что нашлось в датасете. */
export class FoodSpecError extends Error {}

/** Отказ по данным: спецификация синтаксически годная, но конкретный fdcId
    не нашёлся в датасете или у него нет нужных чисел. */
export class FoodDataError extends Error {}

function emptyNutrientTotals() {
  const totals = {};
  for (const key of NUTRIENT_KEY_LIST) totals[key] = { value: 0, known: 0, total: 0 };
  return totals;
}

function checkFiniteInRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value > min && value <= max;
}

/** Чистая функция: спецификация + предзагруженные таблицы -> FoodResult (без
    полей source/request — их дописывает вызывающий, у которого есть исходный
    текст запроса; см. комментарий в resolve-food.mjs). Повторяет арифметику
    src/core/nutrition.ts (itemKbju/itemNutrients), но независимо: scripts/*.mjs
    не подключают TypeScript-ядро напрямую. Один компонент — одна «позиция» в
    смысле known/total, как продукт меню. */
export function resolveSpec(spec, { foods, categories, nutrientsById }) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new FoodSpecError('спецификация должна быть объектом');
  }
  if (typeof spec.title !== 'string' || spec.title.trim().length === 0) {
    throw new FoodSpecError('не задан title');
  }
  if (!Array.isArray(spec.components) || spec.components.length === 0) {
    throw new FoodSpecError('components должен быть непустым списком');
  }

  const components = [];
  const nutrients = emptyNutrientTotals();
  let kbju = { kcal: 0, p: 0, f: 0, c: 0 };

  for (const raw of spec.components) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new FoodSpecError('компонент должен быть объектом');
    }
    const fdcId = raw.fdcId;
    if (!Number.isInteger(fdcId) || fdcId <= 0) {
      throw new FoodSpecError(`компонент: fdcId должен быть целым положительным числом, получено ${JSON.stringify(raw.fdcId)}`);
    }
    if (!checkFiniteInRange(raw.grams, 0, 5000)) {
      throw new FoodSpecError(`компонент fdcId ${fdcId}: grams должен быть конечным числом в (0, 5000], получено ${JSON.stringify(raw.grams)}`);
    }
    const grams = raw.grams;
    let note;
    if (raw.note !== undefined) {
      if (typeof raw.note !== 'string') {
        throw new FoodSpecError(`компонент fdcId ${fdcId}: note должен быть строкой`);
      }
      note = raw.note;
    }

    const id = String(fdcId);
    const food = foods.get(id);
    if (!food) {
      throw new FoodDataError(`fdcId ${fdcId} не найден в food.csv`);
    }

    let per100;
    try {
      per100 = per100Of(nutrientsById.get(id) ?? {});
    } catch (err) {
      throw new FoodDataError(`fdcId ${fdcId} (${food.description}): ${err.message}`);
    }

    const category = categories.get(food.categoryId) ?? food.categoryId;
    const component = { fdcId, description: food.description, category, grams, per100 };
    if (note !== undefined) component.note = note;
    components.push(component);

    const factor = grams / 100;
    kbju = {
      kcal: kbju.kcal + per100.kbju.kcal * factor,
      p: kbju.p + per100.kbju.p * factor,
      f: kbju.f + per100.kbju.f * factor,
      c: kbju.c + per100.kbju.c * factor,
    };
    for (const key of NUTRIENT_KEY_LIST) {
      nutrients[key].total += 1;
      const amount = per100.micro[key];
      if (amount !== undefined) {
        nutrients[key].value += amount * factor;
        nutrients[key].known += 1;
      }
    }
  }

  return {
    ok: true,
    spec: 1,
    source: SOURCE,
    title: spec.title,
    components,
    kbju,
    nutrients,
  };
}
