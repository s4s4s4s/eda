#!/usr/bin/env node
// Ищет строки USDA SR Legacy по описанию — инструмент модели, которая
// подбирает fdcId для «своей еды» (см. pc/prompts/food.md в репозитории
// «Штурман»). Единственный вывод в stdout — JSON-массив находок: скрипт
// зовёт headless-модель как единственный разрешённый Bash-инструмент, и
// любая лишняя строка в stdout сломала бы разбор ответа на другой стороне.
// Прогресс и диагностика — только в stderr.
//
// Запуск:
//   node scripts/food-search.mjs "<запрос>" [--limit N] [--fdc <путь>]
//   путь к выгрузке SR Legacy — флаг --fdc, иначе переменная FDC_DIR.

import { resolveFdcDir, loadFoods, loadCategories, loadPortions } from './lib/usda.mjs';

const DEFAULT_LIMIT = 25;
const PORTIONS_PER_FOOD = 4;

function parseArgs(argv) {
  let limit = DEFAULT_LIMIT;
  let fdc;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') {
      limit = Number(argv[++i]);
      continue;
    }
    if (argv[i] === '--fdc') {
      fdc = argv[++i];
      continue;
    }
    positional.push(argv[i]);
  }
  return { query: positional[0], limit, fdc };
}

/** Токены запроса: латиница и цифры в нижнем регистре, разделители любые
    остальные символы. Кириллица тут не нужна — датасет англоязычный, и
    подсказка модели (pc/prompts/food.md) требует переводить запрос на
    английский до вызова поиска. */
function tokenize(text) {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** true — токен совпал как отдельное слово (по границе \b), а не как кусок
    внутри другого слова. Используется только для ранжирования — само
    попадание в выдачу решает более мягкое условие includes(). */
function matchesWholeWord(token, textLower) {
  return new RegExp(`\\b${escapeRegExp(token)}\\b`).test(textLower);
}

async function main() {
  const { query, limit, fdc } = parseArgs(process.argv.slice(2));
  if (!query) {
    console.error('Укажи поисковый запрос первым аргументом: node scripts/food-search.mjs "<запрос>"');
    process.exit(1);
  }
  const fdcDir = resolveFdcDir(fdc);

  const tokens = tokenize(query);
  if (tokens.length === 0) {
    console.error('Запрос не дал ни одного токена (латиница/цифры) для поиска.');
    process.exit(1);
  }

  const foods = await loadFoods(fdcDir);
  const categories = await loadCategories(fdcDir);

  // Строка идёт в выдачу, только если ВСЕ токены запроса нашлись в описании
  // хотя бы подстрокой — иначе результат «нашлось что-то» вместо «нашлось
  // искомое». Ранг внутри выдачи выше у тех, где токены совпали целым словом
  // (а не серединой другого слова), при равенстве — короче описание: короткое
  // "Salmon, Atlantic, raw" читается моделью быстрее длинного варианта с
  // тем же составом слов.
  const matches = [];
  for (const [fdcId, food] of foods) {
    const descLower = food.description.toLowerCase();
    if (!tokens.every((t) => descLower.includes(t))) continue;
    const wholeWordScore = tokens.filter((t) => matchesWholeWord(t, descLower)).length;
    matches.push({ fdcId, food, wholeWordScore });
  }
  matches.sort((a, b) => {
    if (b.wholeWordScore !== a.wholeWordScore) return b.wholeWordScore - a.wholeWordScore;
    return a.food.description.length - b.food.description.length;
  });

  const top = matches.slice(0, limit > 0 ? limit : DEFAULT_LIMIT);
  const idSet = new Set(top.map((m) => m.fdcId));
  const portionsByFood = await loadPortions(fdcDir, idSet);

  const result = top.map((m) => ({
    fdcId: Number(m.fdcId),
    description: m.food.description,
    category: categories.get(m.food.categoryId) ?? m.food.categoryId,
    portions: (portionsByFood.get(m.fdcId) ?? []).slice(0, PORTIONS_PER_FOOD),
  }));

  process.stdout.write(JSON.stringify(result) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
