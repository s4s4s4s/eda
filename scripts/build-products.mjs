#!/usr/bin/env node
// Собирает data/products.yaml из USDA FoodData Central, набор SR Legacy (релиз 2018-04).
//
// Список продуктов ниже фиксирует fdc_id вручную (по итогам разового поиска в
// food.csv). Скрипт НЕ ищет продукты по названию в момент запуска — он только
// достаёт по уже выбранным id числа из food_nutrient.csv и проверяет, что они
// на месте. Если id пропал из датасета или у него нет одного из четырёх
// нутриентов — скрипт падает с ненулевым кодом, а не тихо пропускает запись.
//
// Ключи продуктов (kebab-case) заданы жёстко снаружи — под них уже пишется
// меню, переименовывать или добавлять свои нельзя.
//
// Запуск:
//   node scripts/build-products.mjs <путь к распакованному каталогу SR Legacy>
//   (или переменная окружения FDC_DIR, если аргумент не передан)

import { createReadStream } from 'node:fs';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

/** Текст с LF вместо CRLF — для сравнения содержимого независимо от того,
    с какими переводами строк файл лежит на диске. */
function toLf(text) {
  return text.replace(/\r\n/g, '\n');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const fdcDir = process.argv[2] ?? process.env.FDC_DIR;
if (!fdcDir) {
  console.error('Укажи путь к распакованному каталогу SR Legacy первым аргументом или через FDC_DIR.');
  process.exit(1);
}

// Нутриенты SR Legacy, проверены по nutrient.csv (id -> name):
// 1008 Energy (KCAL), 1003 Protein (G), 1004 Total lipid (fat) (G),
// 1005 Carbohydrate, by difference (G).
const NUTRIENT_IDS = { kcal: '1008', protein: '1003', fat: '1004', carbs: '1005' };

// Дополнительные нутриенты (клетчатка, минералы, витамины) — идут в micro100g.
// Отсутствие строки в food_nutrient.csv для конкретного продукта — это НЕ ноль,
// поле в таком случае просто не попадает в micro100g (см. сборку entry.micro100g).
// id и unit_name проверены по nutrient.csv, таблица сверки — в отчёте прогона.
// Порядок ключей здесь = порядок NUTRIENT_KEYS в src/core/types.ts и порядок
// строк micro100g в data/products.yaml. Держится вручную и намеренно: файл
// справочника читают глазами, сверяя число с источником, и группы (жиры рядом
// с жирами, витамины с витаминами) читаются, а хвост из дописанных ключей — нет.
const MICRO_NUTRIENT_IDS = {
  fiber: '1079',
  sugar: '2000',
  satFat: '1258',
  monoFat: '1292',
  polyFat: '1293',
  cholesterol: '1253',
  // ПНЖК: 1269/1270 — суммарные 18:2 и 18:3 (все изомеры), а не изомер-
  // специфичные 1316 (18:2 n-6 c,c, линолевая) и 1404 (18:3 n-3, ALA).
  // Изомер-специфичные id заполнены у малой доли продуктов проекта, суммарные —
  // почти у всех; точные числа печатает каждый прогон в разделе отчёта «Сверка
  // приближения по ПНЖК» (см. APPROXIMATION_CHECK_IDS ниже), проверять надо там,
  // а не верить этой строке. Практически весь пищевой 18:2 — линолевая кислота,
  // а 18:3 — ALA, так что подстановка суммы вместо изомера — честное
  // приближение, а не ноль.
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
  // Folate, DFE (не "Folate, total" 1177): норма DRI по фолатам задана в DFE
  // (dietary folate equivalents), и складывать с ней "Folate, total" было бы
  // сравнением разного. Смена источника числа осознанная.
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

// Эти id в данные НЕ идут: они собираются только ради отчёта прогона, чтобы
// приближение выше («суммарные 18:2 и 18:3 вместо изомер-специфичных») не
// оставалось словом автора. Каждый прогон печатает заполненность обоих
// вариантов по продуктам проекта — цифру, на которой держится решение, можно
// перепроверить в любой момент, а не поверить комментарию.
const APPROXIMATION_CHECK_IDS = {
  linoleic: { used: '1269', usedName: 'PUFA 18:2', exact: '1316', exactName: 'PUFA 18:2 n-6 c,c' },
  ala: { used: '1270', usedName: 'PUFA 18:3', exact: '1404', exactName: 'PUFA 18:3 n-3 c,c,c (ALA)' },
};

// ---------------------------------------------------------------------------
// Закрытый список тегов и то, каким продуктам они присвоены.
// ---------------------------------------------------------------------------
const TAGS_BY_KEY = {
  salmon: ['fish'],
  trout: ['fish'],
  mackerel: ['fish'],
  'turkey-thigh': ['turkey'],
  'chicken-breast': ['chicken'],
  'chicken-hearts': ['chicken'],
  beef: ['beef'],
  egg: ['egg'],
  milk: ['dairy'],
  tvorog: ['dairy', 'tvorog'],
  'greek-yogurt': ['dairy', 'greek-yogurt'],
  oats: ['grain'],
  quinoa: ['grain'],
  bulgur: ['grain'],
  buckwheat: ['grain'],
  'pearl-barley': ['grain'],
  lentils: ['legumes'],
  chickpeas: ['legumes'],
  'white-beans': ['legumes'],
  'red-beans': ['legumes'],
  cashew: ['nuts'],
  hazelnut: ['nuts'],
  almond: ['nuts'],
  'brazil-nut': ['nuts', 'brazil'],
  flaxseed: ['flax'],
  chia: ['chia'],
  'olive-oil': ['oil'],
  broccoli: ['vegetable'],
  'bell-pepper': ['vegetable'],
  zucchini: ['vegetable'],
  carrot: ['vegetable'],
  spinach: ['vegetable'],
  cabbage: ['vegetable'],
  kale: ['vegetable'],
  chard: ['vegetable'],
  'sweet-potato': ['vegetable'],
  pumpkin: ['vegetable'],
  eggplant: ['vegetable'],
  onion: ['vegetable'],
  garlic: ['vegetable'],
  tomato: ['vegetable'],
  shiitake: ['vegetable'],
  'oyster-mushroom': ['vegetable'],
  peach: ['fruit'],
  apple: ['fruit'],
  banana: ['fruit'],
  pear: ['fruit'],
  raisins: ['fruit'],
  dates: ['fruit'],
  pomegranate: ['fruit'],
  blueberry: ['berries'],
  lemon: ['fruit'],
  cocoa: [],
  cinnamon: [],
  'wheat-flour': [],
  butter: [],
  cream: [],
  'dark-chocolate': [],
  greens: [],
};

// ---------------------------------------------------------------------------
// Таблица продуктов: ключ -> { fdcId, name (рус.), substitute? }
// ---------------------------------------------------------------------------
const PRODUCTS = [
  // Мясо, рыба, яйцо
  { key: 'salmon', fdcId: 175167, name: 'лосось атлантический' },
  { key: 'trout', fdcId: 173717, name: 'форель радужная' },
  { key: 'mackerel', fdcId: 175119, name: 'скумбрия атлантическая' },
  { key: 'turkey-thigh', fdcId: 171531, name: 'филе бедра индейки (без кожи)' },
  { key: 'chicken-breast', fdcId: 171077, name: 'куриная грудка (без кожи)' },
  { key: 'chicken-hearts', fdcId: 171458, name: 'куриные сердечки' },
  {
    key: 'beef',
    fdcId: 174051,
    name: 'говядина для тушения (постная часть, сырая)',
  },
  { key: 'egg', fdcId: 171287, name: 'яйцо куриное целое' },

  // Молочное
  { key: 'milk', fdcId: 171267, name: 'молоко коровье питьевое, 2% жирности' },
  { key: 'cream', fdcId: 170857, name: 'сливки питьевые (~19% жирности)' },
  { key: 'butter', fdcId: 173430, name: 'масло сливочное несолёное' },
  {
    key: 'tvorog',
    fdcId: 172179,
    name: 'творог',
    substitute:
      'русского творога в SR Legacy нет; заменён американским cottage cheese, creamed (~4.3% жирности) — ближайший аналог по жирности к творогу 5%, но текстура иная (влажный зернёный творог, а не сухой)',
  },
  { key: 'greek-yogurt', fdcId: 170903, name: 'греческий йогурт натуральный' },

  // Крупы (сухие)
  { key: 'wheat-flour', fdcId: 169761, name: 'мука пшеничная высшего сорта' },
  { key: 'oats', fdcId: 173904, name: 'овсяные хлопья' },
  { key: 'quinoa', fdcId: 168874, name: 'киноа' },
  { key: 'bulgur', fdcId: 170688, name: 'булгур' },
  { key: 'buckwheat', fdcId: 170685, name: 'гречневая крупа' },
  { key: 'pearl-barley', fdcId: 170284, name: 'перловая крупа' },

  // Бобовые (сухие)
  { key: 'lentils', fdcId: 172420, name: 'чечевица' },
  { key: 'chickpeas', fdcId: 173756, name: 'нут' },
  { key: 'white-beans', fdcId: 175202, name: 'фасоль белая' },
  { key: 'red-beans', fdcId: 175193, name: 'фасоль красная' },

  // Орехи и семена
  { key: 'cashew', fdcId: 170571, name: 'кешью обжаренный' },
  { key: 'hazelnut', fdcId: 170583, name: 'фундук обжаренный' },
  { key: 'almond', fdcId: 170158, name: 'миндаль обжаренный' },
  { key: 'brazil-nut', fdcId: 170569, name: 'бразильский орех' },
  { key: 'flaxseed', fdcId: 169414, name: 'семена льна' },
  { key: 'chia', fdcId: 170554, name: 'семена чиа' },

  // Масло
  { key: 'olive-oil', fdcId: 171413, name: 'оливковое масло' },

  // Овощи и грибы
  { key: 'broccoli', fdcId: 170379, name: 'брокколи' },
  { key: 'bell-pepper', fdcId: 170108, name: 'перец сладкий' },
  { key: 'zucchini', fdcId: 169291, name: 'цукини (кабачок)' },
  { key: 'carrot', fdcId: 170393, name: 'морковь' },
  { key: 'spinach', fdcId: 168462, name: 'шпинат' },
  { key: 'cabbage', fdcId: 169975, name: 'капуста белокочанная' },
  { key: 'kale', fdcId: 168421, name: 'кале' },
  { key: 'chard', fdcId: 169991, name: 'мангольд' },
  { key: 'sweet-potato', fdcId: 168482, name: 'батат' },
  { key: 'pumpkin', fdcId: 168448, name: 'тыква' },
  { key: 'eggplant', fdcId: 169228, name: 'баклажан' },
  { key: 'onion', fdcId: 170000, name: 'лук репчатый' },
  { key: 'garlic', fdcId: 169230, name: 'чеснок' },
  { key: 'tomato', fdcId: 170457, name: 'томаты' },
  { key: 'shiitake', fdcId: 169242, name: 'шиитаке' },
  { key: 'oyster-mushroom', fdcId: 168580, name: 'вешенки' },
  { key: 'greens', fdcId: 170416, name: 'зелень (петрушка)' },

  // Фрукты и ягоды
  { key: 'peach', fdcId: 169928, name: 'персик' },
  { key: 'apple', fdcId: 171688, name: 'яблоко' },
  { key: 'banana', fdcId: 173944, name: 'банан' },
  { key: 'pear', fdcId: 169118, name: 'груша' },
  { key: 'raisins', fdcId: 168165, name: 'изюм' },
  { key: 'dates', fdcId: 171726, name: 'финики' },
  { key: 'pomegranate', fdcId: 169134, name: 'гранат (зёрна)' },
  { key: 'blueberry', fdcId: 171711, name: 'голубика' },
  { key: 'lemon', fdcId: 167746, name: 'лимон' },

  // Прочее
  { key: 'cocoa', fdcId: 169593, name: 'какао-порошок несладкий' },
  { key: 'dark-chocolate', fdcId: 170273, name: 'шоколад тёмный, 70-85% какао' },
  { key: 'cinnamon', fdcId: 171320, name: 'корица молотая' },
];

// ---------------------------------------------------------------------------
// Меры объёма, зашитые прямо в продукт: pieceG/pieceSource, tbspG/tbspSource.
// source: 'fdc' — взято из food_portion.csv датасета (fdcPortionId проверяется);
// source: 'common' — общепринятая мера, в датасете такой позиции нет.
// ---------------------------------------------------------------------------
const MEASURES_BY_KEY = {
  flaxseed: { tbsp: { source: 'fdc', fdcPortionId: 84818 } }, // "tbsp, ground" — молотый лён
  chia: { tbsp: { source: 'common', grams: 12 } },
  'olive-oil': { tbsp: { source: 'fdc', fdcPortionId: 88667 } }, // "tablespoon"
  'brazil-nut': { piece: { source: 'fdc', fdcPortionId: 86873 } }, // "kernel"
  egg: { piece: { source: 'fdc', fdcPortionId: 88374 } }, // "large"
};

// ---------------------------------------------------------------------------
// CSV: все файлы SR Legacy заключают каждое поле в двойные кавычки, запятые и
// кавычки внутри значений экранируются удвоением кавычки ("").
// ---------------------------------------------------------------------------
function parseCsvLine(line) {
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

async function readCsvHeader(filePath) {
  const rl = createInterface({ input: createReadStream(filePath, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    rl.close();
    return parseCsvLine(line);
  }
  throw new Error(`Пустой файл: ${filePath}`);
}

async function streamCsv(filePath, onRow) {
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

function round(n, digits) {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

async function main() {
  // Ключи должны совпадать 1:1 с закрытым списком тегов — ни своих, ни забытых.
  const productKeys = PRODUCTS.map((p) => p.key);
  const tagKeys = Object.keys(TAGS_BY_KEY);
  const missingTags = productKeys.filter((k) => !(k in TAGS_BY_KEY));
  const extraTags = tagKeys.filter((k) => !productKeys.includes(k));
  if (missingTags.length > 0 || extraTags.length > 0) {
    console.error('Расхождение между PRODUCTS и TAGS_BY_KEY:');
    if (missingTags.length > 0) console.error(`  нет тегов для: ${missingTags.join(', ')}`);
    if (extraTags.length > 0) console.error(`  теги без продукта: ${extraTags.join(', ')}`);
    process.exit(1);
  }

  const foodCsv = path.join(fdcDir, 'food.csv');
  const foodNutrientCsv = path.join(fdcDir, 'food_nutrient.csv');
  const nutrientCsv = path.join(fdcDir, 'nutrient.csv');
  const foodPortionCsv = path.join(fdcDir, 'food_portion.csv');

  // 1. Проверяем id нутриентов по nutrient.csv, а не верим захардкоженным числам молча.
  const nutrientNames = {};
  const nutrientUnits = {};
  await streamCsv(nutrientCsv, (row) => {
    nutrientNames[row.id] = row.name;
    nutrientUnits[row.id] = row.unit_name;
  });
  const expectedNames = {
    [NUTRIENT_IDS.kcal]: 'Energy',
    [NUTRIENT_IDS.protein]: 'Protein',
    [NUTRIENT_IDS.fat]: 'Total lipid (fat)',
    [NUTRIENT_IDS.carbs]: 'Carbohydrate, by difference',
  };
  for (const [id, expectedName] of Object.entries(expectedNames)) {
    const actualName = nutrientNames[id];
    if (actualName !== expectedName) {
      console.error(
        `Id нутриента ${id} в nutrient.csv называется "${actualName ?? '<нет такого id>'}", а не "${expectedName}". Обнови NUTRIENT_IDS в скрипте.`,
      );
      process.exit(1);
    }
  }
  // Микронутриенты обязаны существовать в nutrient.csv (иначе id устарел/неверен и
  // это надо чинить в коде, а не подставлять что попало), но их название сверяет
  // человек по таблице в отчёте прогона — не падаем на несовпадении текста названия.
  const microReport = [];
  for (const [field, id] of Object.entries(MICRO_NUTRIENT_IDS)) {
    const actualName = nutrientNames[id];
    if (!actualName) {
      console.error(`Микронутриент ${field}: id ${id} отсутствует в nutrient.csv.`);
      process.exit(1);
    }
    microReport.push({ field, id, name: actualName, unit: nutrientUnits[id] });
  }
  console.log('Сверка id микронутриентов по nutrient.csv:');
  for (const r of microReport) {
    console.log(`  ${r.id}\t${r.field}\t${r.name}\t${r.unit}`);
  }

  // 2. Описания продуктов из food.csv, только для нужных нам fdc_id.
  // Меры в MEASURES_BY_KEY всегда относятся к fdc_id того же продукта (по ключу),
  // отдельного набора id для них не требуется — он уже входит в neededFoodIds.
  const neededFoodIds = new Set(PRODUCTS.map((p) => String(p.fdcId)));
  const descriptions = {};
  await streamCsv(foodCsv, (row) => {
    if (neededFoodIds.has(row.fdc_id)) descriptions[row.fdc_id] = row.description;
  });
  for (const p of PRODUCTS) {
    if (!descriptions[String(p.fdcId)]) {
      console.error(`fdc_id ${p.fdcId} (${p.key}) не найден в food.csv.`);
      process.exit(1);
    }
  }

  // 3. Нутриенты из food_nutrient.csv — потоково, файл большой (36 МБ).
  const wantedNutrientIds = new Set([
    ...Object.values(NUTRIENT_IDS),
    ...Object.values(MICRO_NUTRIENT_IDS),
    ...Object.values(APPROXIMATION_CHECK_IDS).map((c) => c.exact),
  ]);
  const nutrients = {}; // fdc_id -> { nutrient_id -> amount }
  await streamCsv(foodNutrientCsv, (row) => {
    if (!neededFoodIds.has(row.fdc_id)) return;
    if (!wantedNutrientIds.has(row.nutrient_id)) return;
    (nutrients[row.fdc_id] ??= {})[row.nutrient_id] = Number(row.amount);
  });

  // 4. Порции из food_portion.csv — только нужные id, с проверкой соответствия fdc_id.
  const neededPortionIds = new Set();
  for (const measures of Object.values(MEASURES_BY_KEY)) {
    for (const m of Object.values(measures)) {
      if (m.source === 'fdc') neededPortionIds.add(String(m.fdcPortionId));
    }
  }
  const portions = {}; // portion_id -> row
  await streamCsv(foodPortionCsv, (row) => {
    if (neededPortionIds.has(row.id)) portions[row.id] = row;
  });

  // 5. Собираем products.
  const productsOut = {};
  const missing = [];
  for (const p of PRODUCTS) {
    const id = String(p.fdcId);
    const n = nutrients[id];
    const missingNutrients = Object.entries(NUTRIENT_IDS)
      .filter(([, nid]) => n?.[nid] === undefined)
      .map(([label]) => label);
    if (!n || missingNutrients.length > 0) {
      missing.push(`${p.key} (fdc_id ${p.fdcId}): нет нутриентов [${missingNutrients.join(', ')}]`);
      continue;
    }
    const entry = {
      name: p.name,
      fdcId: p.fdcId,
      fdcDescription: descriptions[id],
      per100g: {
        kcal: round(n[NUTRIENT_IDS.kcal], 0),
        protein: round(n[NUTRIENT_IDS.protein], 2),
        fat: round(n[NUTRIENT_IDS.fat], 2),
        carbs: round(n[NUTRIENT_IDS.carbs], 2),
      },
      tags: TAGS_BY_KEY[p.key],
    };
    if (p.substitute) entry.substitute = p.substitute;

    // micro100g: поле пишем ТОЛЬКО если в food_nutrient.csv реально есть строка
    // для этого нутриента у этого fdc_id. Отсутствие строки — это дыра в
    // датасете, а не ноль, поэтому поле просто не появляется в объекте.
    const micro100g = {};
    for (const [field, nid] of Object.entries(MICRO_NUTRIENT_IDS)) {
      const amount = n[nid];
      if (amount !== undefined) micro100g[field] = round(amount, 3);
    }
    entry.micro100g = micro100g;

    const measures = MEASURES_BY_KEY[p.key];
    if (measures?.tbsp) {
      const m = measures.tbsp;
      if (m.source === 'fdc') {
        const portion = portions[String(m.fdcPortionId)];
        if (!portion || portion.fdc_id !== id) {
          missing.push(`${p.key}: не найдена порция tbsp (fdcPortionId ${m.fdcPortionId})`);
          continue;
        }
        entry.tbspG = round(Number(portion.gram_weight), 2);
        entry.tbspSource = 'fdc';
      } else {
        entry.tbspG = m.grams;
        entry.tbspSource = 'common';
      }
    }
    if (measures?.piece) {
      const m = measures.piece;
      if (m.source === 'fdc') {
        const portion = portions[String(m.fdcPortionId)];
        if (!portion || portion.fdc_id !== id) {
          missing.push(`${p.key}: не найдена порция piece (fdcPortionId ${m.fdcPortionId})`);
          continue;
        }
        entry.pieceG = round(Number(portion.gram_weight), 2);
        entry.pieceSource = 'fdc';
      } else {
        entry.pieceG = m.grams;
        entry.pieceSource = 'common';
      }
    }

    productsOut[p.key] = entry;
  }

  if (missing.length > 0) {
    console.error('Проблемы при сборке следующих продуктов:');
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }

  // 6. Покрытие микронутриентов — печатаем в отчёт прогона, ничего не скрываем.
  const productCount = Object.keys(productsOut).length;
  console.log('\nПокрытие micro100g (сколько из %d продуктов имеют значение):', productCount);
  const sparseProducts = [];
  for (const [key, entry] of Object.entries(productsOut)) {
    const have = Object.keys(entry.micro100g).length;
    const total = Object.keys(MICRO_NUTRIENT_IDS).length;
    if (have < total / 2) sparseProducts.push(`${key}: ${have}/${total}`);
  }
  for (const field of Object.keys(MICRO_NUTRIENT_IDS)) {
    let have = 0;
    for (const entry of Object.values(productsOut)) {
      if (entry.micro100g[field] !== undefined) have++;
    }
    console.log(`  ${field}: ${have}/${productCount} (нет у ${productCount - have})`);
  }
  console.log('\nПродукты, у которых нет больше половины набора микронутриентов:');
  if (sparseProducts.length === 0) console.log('  нет таких');
  else for (const s of sparseProducts) console.log(`  - ${s}`);

  // Сверка приближения по ПНЖК: заполненность взятого id против изомер-
  // специфичного. Печатается всегда — решение «берём суммарный» держится
  // на этих числах, и они должны быть видны, а не жить в комментарии.
  console.log('\nСверка приближения по ПНЖК (заполненность по продуктам проекта):');
  for (const [field, c] of Object.entries(APPROXIMATION_CHECK_IDS)) {
    let haveUsed = 0;
    let haveExact = 0;
    for (const p of PRODUCTS) {
      const n = nutrients[String(p.fdcId)];
      if (n?.[c.used] !== undefined) haveUsed++;
      if (n?.[c.exact] !== undefined) haveExact++;
    }
    const pct = (n) => Math.round((n / productCount) * 100);
    console.log(
      `  ${field}: взят id ${c.used} "${c.usedName}" — ${haveUsed}/${productCount} (${pct(haveUsed)}%); ` +
      `изомер-специфичный id ${c.exact} "${c.exactName}" — ${haveExact}/${productCount} (${pct(haveExact)}%)`
    );
  }

  const microUnitsLines = Object.entries(MICRO_NUTRIENT_IDS).map(
    ([field, id]) => `#   ${field}: ${nutrientUnits[id]} (id ${id}, "${nutrientNames[id]}")`,
  );
  const header = [
    '# Источник всех чисел: USDA FoodData Central, набор SR Legacy, релиз 2018-04.',
    '# Числа на 100 г съедобной части в сыром виде, если в описании не сказано иное.',
    '# Файл собирается скриптом scripts/build-products.mjs, руками не правится.',
    '#',
    '# revision — дата последней правки СОДЕРЖИМОГО справочника (ГГГГ-ММ-ДД), поле',
    '# данных, а не комментарий (см. parseProductsRevision в src/core/data.ts). На неё',
    '# опирается снапшот записи дневника (MealLogEntry.productsRevision в types.ts):',
    '# справочник иногда правится задним числом (смена fdcId, новые нутриенты), и без',
    '# метки нельзя понять, по каким числам посчитан день. Скрипт ставит её сам —',
    '# сравнивает новое тело файла со старым (без строки revision) и меняет дату,',
    '# только если тело изменилось; иначе пересборка без реальных правок молча не',
    '# сдвигала бы дату «задним числом наоборот».',
    '#',
    '# pieceG/pieceSource и tbspG/tbspSource — граммы одной штуки/столовой ложки.',
    '# source: fdc — взято из food_portion.csv датасета (см. fdcId и описание продукта),',
    '# source: common — общепринятая мера, не из датасета.',
    '#',
    '# per100g: kcal — ккал, protein/fat/carbs — граммы.',
    '# micro100g: те же 100 г сырого веса, тот же fdcId. Единицы измерения ниже.',
    '# ВАЖНО: отсутствие поля в micro100g означает "в датасете нет строки для этого',
    '# нутриента у этого продукта" — это НЕ ноль. Ноль пишется только если в',
    '# food_nutrient.csv реально записан 0. Складывать отсутствующее поле как 0 нельзя.',
    '# Проверка «kcal = 4·белок + 9·жир + 4·углеводы» здесь не инвариант: USDA считает',
    '# энергию коэффициентами Атуотера по категориям, а клетчатка даёт меньше 4 ккал/г,',
    '# поэтому у овощей, фруктов, какао и специй расхождение доходит до 10–47 %. Это',
    '# свойство источника, а не ошибка сборки. По той же причине у молока и сливок',
    '# sugar бывает чуть больше carbs: carbs — «by difference», сахар измерен прямо.',
    '# Единицы измерения (взяты из nutrient.csv, unit_name):',
    ...microUnitsLines,
    '',
  ].join('\n');

  // Тело файла БЕЗ revision — то, что реально сравнивается между прогонами.
  // revision намеренно не входит сюда: дата не часть содержимого, которое
  // сверяется, а вывод из того, изменилось ли оно.
  const bodyYaml = yaml.dump({ products: productsOut }, { lineWidth: -1, noRefs: true });
  const newBodyWithoutRevision = header + bodyYaml;

  const outPath = path.join(REPO_ROOT, 'data', 'products.yaml');

  function todayLocal() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  // Дата меняется, только если содержимое реально изменилось: без этого
  // каждая пересборка (даже без единой правки числа) двигала бы revision на
  // сегодня, и метка перестала бы отвечать на вопрос «по каким числам
  // посчитан день» — она отвечала бы «когда последний раз запускали скрипт».
  let revision = todayLocal();
  try {
    const existing = await readFile(outPath, 'utf8');
    // Переводы строк с обеих сторон приводим к LF: после чекаута с
    // core.autocrlf=true файл на диске лежит с CRLF, а свежесобранный текст —
    // с LF, и посимвольное сравнение считало бы каждую пересборку правкой,
    // то есть двигало бы дату без единого изменённого числа.
    const existingWithoutRevision = toLf(existing).replace(/^revision: .*\n/m, '');
    if (existingWithoutRevision === toLf(newBodyWithoutRevision)) {
      const match = existing.match(/^revision: ['"]?(\d{4}-\d{2}-\d{2})['"]?/m);
      if (match) revision = match[1];
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const productsYaml = yaml.dump({ revision, products: productsOut }, { lineWidth: -1, noRefs: true });

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, header + productsYaml, 'utf8');

  console.log(`\nЗаписано ${productCount} продуктов в ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
