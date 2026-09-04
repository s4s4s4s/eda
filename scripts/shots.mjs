// Снимки экранов приложения настоящим Chrome в headless-режиме через DevTools-протокол.
//
// Зачем: текстовые проверки (tsc, тесты, чтение DOM) не доказывают, что полоса
// покрытия нарисована, а не имеет нулевую ширину. Полосы нутриентов жили пустыми
// с 30 августа по 3 сентября 2026 именно потому, что их никто не снимал.
//
// Запуск: dev-сервер уже поднят (`npm run dev`), затем
//   npm run shots -- [url] [каталог]
// По умолчанию url = http://localhost:5173/eda/, каталог = node_modules/.cache/eda/shots.
// Путь к Chrome берётся из переменной окружения CHROME, иначе стандартный путь
// установки на Windows. Библиотек не нужно: WebSocket и fetch встроены в Node ≥ 22.
//
// Сценарий (главный экран — сводка дня, приёмы — вкладки nav.slot-switch,
// DESIGN.md «Навигация: сводка первая»): первый запуск (баннер даты цикла) →
// дата цикла «позавчера» (день 3) → на экране приёма «Обед» половина, на
// экране приёма «Ужин» целиком → «Обед» с раскрытой панелью нутриентов →
// сводка дня (рост ккал, полосы прогресса, статус карточки) → «Съел: Завтрак»
// из карточки сводки, без открытия приёма → каждая шторка из шапки →
// «Добавить блюдо из другого дня»/«Своя еда» из сводки → широкий экран
// (боковая колонка вместо горизонтальной полосы). Итог — PNG-файлы,
// report.json и код возврата: 1, если хоть одна полоса с процентом получила
// нулевую ширину или высоту, либо какая-то из проверок сценария провалилась.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const URL_APP = process.argv[2] ?? 'http://localhost:5173/eda/';
/* Тема: по умолчанию тёмная (у приложения она без медиа-запроса); SCHEME=light
   эмулирует prefers-color-scheme: light и кладёт снимки в соседний каталог,
   чтобы светлая тема проверялась теми же сценами, а не «на глаз». */
const SCHEME = process.env.SCHEME === 'light' ? 'light' : 'dark';
const OUT = path.resolve(process.argv[3] ?? `node_modules/.cache/eda/shots${SCHEME === 'light' ? '-light' : ''}`);
const VIEW = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
/* Широкий облик: `@media (min-width: 48rem)` в layout.css переключает nav на
   боковую колонку — 960 шире порога с запасом, 900 высоты хватает без full. */
const WIDE = { width: 960, height: 900, deviceScaleFactor: 1, mobile: false };

if (!existsSync(CHROME)) {
  console.error(`Chrome не найден: ${CHROME}. Укажи путь через переменную окружения CHROME.`);
  process.exit(2);
}
// Снимки прошлого прогона убираем целиком: сменилась нумерация — старый файл
// иначе останется рядом с новыми и сойдёт за результат.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
/* Профиль браузера — одноразовый: в нём остаётся localStorage прошлого прогона
   (дневник с уже записанными приёмами), и сценарий «записать обед» упирается
   в отсутствующую кнопку. Каждый прогон начинается с чистого первого запуска. */
const PROFILE = path.join(OUT, 'profile');
rmSync(PROFILE, { recursive: true, force: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Дата в местном времени сдвигом на N дней от сегодня, ГГГГ-ММ-ДД. */
function localDateShifted(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  `--window-size=${VIEW.width},${VIEW.height}`, 'about:blank'
], { stdio: 'ignore' });

async function browserWsUrl() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      return (await r.json()).webSocketDebuggerUrl;
    } catch {
      await sleep(200);
    }
  }
  throw new Error('Chrome не поднял отладочный порт за 20 с');
}

const ws = new WebSocket(await browserWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const listeners = new Set();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id !== undefined) {
    pending.get(m.id)?.(m);
    pending.delete(m.id);
    return;
  }
  for (const l of listeners) l(m);
};
function send(method, params = {}, sessionId) {
  return new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, m => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
function waitEvent(name, sessionId, timeoutMs = 15000) {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { listeners.delete(l); rej(new Error(`нет события ${name} за ${timeoutMs} мс`)); }, timeoutMs);
    const l = m => {
      if (m.method === name && m.sessionId === sessionId) {
        clearTimeout(timer);
        listeners.delete(l);
        res(m.params);
      }
    };
    listeners.add(l);
  });
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId: S } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, S);
await send('Runtime.enable', {}, S);
await send('Emulation.setDeviceMetricsOverride', VIEW, S);
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-color-scheme', value: SCHEME }]
}, S);

async function goto(url) {
  const loaded = waitEvent('Page.loadEventFired', S);
  await send('Page.navigate', { url }, S);
  await loaded;
  await sleep(700);
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, S);
  if (r.exceptionDetails) {
    throw new Error('в странице: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  }
  return r.result.value;
}
const files = [];
async function shot(name, { full = false } = {}) {
  if (full) {
    const h = await evaluate('document.documentElement.scrollHeight');
    await send('Emulation.setDeviceMetricsOverride', { ...VIEW, height: Math.min(h, 6000) }, S);
    await sleep(300);
  }
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, S);
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  files.push(file);
  if (full) {
    await send('Emulation.setDeviceMetricsOverride', VIEW, S);
    await sleep(200);
  }
}
/** Снимок с произвольными метриками устройства (широкий облик) — в отличие
    от shot({full}), не привязан к узкой VIEW и не восстанавливает её сам:
    сцена, которая переключает метрики, отвечает за возврат к VIEW сама. */
async function shotAt(name, metrics) {
  await send('Emulation.setDeviceMetricsOverride', metrics, S);
  await sleep(300);
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, S);
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  files.push(file);
}

/* Помощники внутри страницы: кнопка по точному тексту, клик с паузой на
   перерисовку и переходы между сводкой и экраном приёма.

   Навигация после редизайна разная на узком и широком экране (DESIGN.md,
   «Навигация: сводка первая»):
   - на сводке узкого экрана переключателя приёмов нет вовсе, приём открывает
     кнопка карточки `.day-meal__open`;
   - на экране приёма сверху стоит сегментированный переключатель из четырёх
     приёмов (`nav.slot-switch`) и кнопка возврата `.meal-back`;
   - на широком экране колонка `nav.slot-switch` держит все пять пунктов,
     включая «Сводку».
   Поэтому openMeal сам выбирает путь по тому, где сейчас находится, а
   backToSummary всегда жмёт `.meal-back` (на широком экране кнопка скрыта
   CSS, но остаётся в DOM и кликается).

   clickNav по-прежнему ищет вкладку ТОЛЬКО по первому текстовому узлу кнопки:
   у каждого приёма в DOM лежат ещё глиф и вторая строка статуса
   (`.slot-switch__sub`, скрыта CSS на узком экране, но остаётся в
   textContent), поэтому «Обед» после записи textContent'ом становится
   «Обедсъел ½» и точное совпадение с btn() рвётся. */
const helpers = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const btn = t => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t);
  const click = async (t) => { const b = btn(t); if (!b) throw new Error('нет кнопки ' + t); b.click(); await sleep(350); };
  const navBtn = t => [...document.querySelectorAll('nav.slot-switch button')]
    .find(b => (b.childNodes[0]?.textContent || '').trim() === t);
  const clickNav = async (t) => { const b = navBtn(t); if (!b) throw new Error('нет вкладки ' + t); b.click(); await sleep(350); };
  const onMealScreen = () => document.querySelector('.meal-title') !== null;
  const openMeal = async (t) => {
    if (onMealScreen()) { await clickNav(t); return; }
    const card = [...document.querySelectorAll('.day-meal')]
      .find(c => (c.querySelector('.day-meal__title')?.textContent || '').trim() === t);
    const b = card && card.querySelector('.day-meal__open');
    if (!b) throw new Error('нет карточки приёма ' + t);
    b.click(); await sleep(350);
  };
  const backToSummary = async () => {
    const b = document.querySelector('.meal-back');
    if (!b) throw new Error('нет кнопки возврата на сводку');
    b.click(); await sleep(350);
  };
`;
const squash = `.replace(/\\s+/g, ' ').trim()`;

/* Число ккал за день из сводки: первое целое в тексте `.day-hero__eaten`
   («820 из 2000 ккал за день»). Используется до/после записи приёма — доказать
   рост суммы числом, а не сверкой строки целиком. Вынесено в начало файла:
   нужно и сразу после записи обеда/ужина, и позже, у добавок из шторок. */
const dayEatenKcalNow = () => evaluate(
  `(() => { const m = document.querySelector('.day-hero__eaten')?.textContent.match(/\\d+/); return m ? Number(m[0]) : null; })()`
);
/* Закрытие шторки крестиком — общий приём для всех шторок сценария. */
const closeDialog = () => evaluate(`(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms));
  const d = document.querySelector('[role=dialog]');
  const close = d && [...d.querySelectorAll('button')].find(b => b.textContent.trim() === '✕' || /закры/i.test(b.getAttribute('aria-label') || ''));
  close?.click(); await sleep(400); return document.querySelector('[role=dialog]') === null; })()`);
/** Кнопки «Добавить блюдо из другого дня»/«Своя еда» и прогресс дня живут в
    сводке (DaySummary), а не на экране приёма — сцены 5–8 (шторки поверх
    главного экрана) обязаны сначала на неё вернуться, если сейчас открыт
    приём (например, потому что предыдущая сцена этого не сделала). */
async function ensureSummary() {
  const onMeal = await evaluate(`document.querySelector('.meal-title') !== null`);
  if (onMeal) {
    await evaluate(`(async () => { ${helpers} await backToSummary(); return 'ok'; })()`);
  }
}

const report = {};
let failed = false;
try {
  // 1. Первый запуск как есть — баннер про дату цикла, главный экран —
  // сводка дня (DaySummary), прогресс дня наверху прокручен в кадр.
  await goto(URL_APP);
  report.firstRunBanner = await evaluate(`document.querySelector('.cycle-start-notice')?.textContent${squash} ?? null`);
  await evaluate('window.scrollTo(0, 0)');
  await sleep(200);
  await shot('01-first-run');

  // 2. Дата цикла позавчера — сегодня день 3, приёмы на экране из середины цикла.
  const cycleStart = localDateShifted(-2);
  await evaluate(`(() => { const k = 'eda.state.v1'; const s = JSON.parse(localStorage.getItem(k));
    s.settings.cycleStartDate = ${JSON.stringify(cycleStart)}; s.settings.cycleStartConfirmed = true;
    localStorage.setItem(k, JSON.stringify(s)); return 'ok'; })()`);
  await goto(URL_APP);
  report.header = await evaluate(`document.querySelector('header')?.textContent${squash}.slice(0, 80) ?? null`);
  await evaluate('window.scrollTo(0, 0)');
  await sleep(200);
  await shot('02-day3-top');

  // 3. Обед — половина, ужин — целиком; обед с раскрытой панелью нутриентов.
  // Всё это теперь происходит на экране приёма (MealScreen), открытом
  // вкладкой navBtn — точным текстом самой подписи вкладки, а не всей
  // кнопки (см. комментарий у helpers).
  await evaluate(`(async () => { ${helpers}
    await openMeal('Обед'); await click('Съел часть');
    const half = [...document.querySelectorAll('.meal-actions button')].find(b => /^(½|1\\/2)$/.test(b.textContent.trim()));
    if (!half) throw new Error('нет кнопки половины среди: ' + [...document.querySelectorAll('.meal-actions button')].map(b => b.textContent.trim()).join(' | '));
    half.click(); await sleep(350);
    await clickNav('Ужин'); await click('Съел');
    await clickNav('Обед');
    const summary = [...document.querySelectorAll('summary')].find(s => s.textContent.includes('Микронутриенты'));
    if (!summary) throw new Error('нет панели «Микронутриенты»');
    summary.click(); await sleep(500); return 'ok'; })()`);
  report.panel = await evaluate(`(() => {
    const panel = [...document.querySelectorAll('details')].find(d => d.textContent.includes('Микронутриенты'));
    const fills = [...document.querySelectorAll('.nutrient__fill')];
    return {
      modes: [...panel.querySelectorAll('.meal-nutrients__modes button')].map(b => b.textContent.trim() + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')),
      note: panel.querySelector('.meal-nutrients__note')?.textContent ?? null,
      fills: fills.length,
      zeroHeight: fills.filter(f => f.offsetHeight === 0).length,
      emptyWithPct: fills.filter(f => parseFloat(f.style.width) > 5 && f.offsetWidth === 0).length,
      verdict: document.querySelector('.meal-verdict')?.textContent${squash}.slice(0, 160) ?? null
    };
  })()`);
  await shot('03-lunch-half-full', { full: true });
  if (report.panel.zeroHeight > 0 || report.panel.emptyWithPct > 0) failed = true;

  // 3b. Назад в сводку: ккал дня выросли, у обеда статус «съел», полосы
  // макросов под кольцом (.macro__fill) закрашены без нулевой ширины/высоты,
  // кольцо дня на месте. Прежней полосы из четырёх сегментов больше нет -
  // её роль взяли карточки приёмов; эта проверка возможна только в сводке.
  await evaluate(`(async () => { ${helpers} await backToSummary(); return 'ok'; })()`);
  await evaluate('window.scrollTo(0, 0)');
  await sleep(200);
  report.summaryAfterLogging = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.day-meal')];
    const lunch = cards.find(c => c.querySelector('.day-meal__title')?.textContent.trim() === 'Обед');
    const value = document.querySelector('.day-hero__eaten')?.textContent.match(/\\d+/);
    const fills = [...document.querySelectorAll('.macro__fill')];
    const ring = document.querySelector('.ring');
    return {
      cardCount: cards.length,
      lunchStatus: lunch?.querySelector('.day-meal__status')?.textContent ?? null,
      dayKcal: value ? Number(value[0]) : null,
      fillsCount: fills.length,
      hasRing: ring !== null,
      zeroHeight: fills.filter(f => f.offsetHeight === 0).length,
      emptyWithPct: fills.filter(f => parseFloat(f.style.width) > 5 && f.offsetWidth === 0).length
    };
  })()`);
  if (report.summaryAfterLogging.cardCount !== 4) failed = true;
  if (!report.summaryAfterLogging.hasRing || report.summaryAfterLogging.fillsCount === 0) failed = true;
  if (!report.summaryAfterLogging.lunchStatus || !report.summaryAfterLogging.lunchStatus.toLowerCase().includes('съел')) failed = true;
  if (report.summaryAfterLogging.zeroHeight > 0 || report.summaryAfterLogging.emptyWithPct > 0) failed = true;
  await shot('04-summary-after-logging');

  // 3c. «Съел: Завтрак» из карточки сводки — пишет приём целиком, не открывая
  // экран приёма (App.tsx: onLog в DaySummary). Ккал дня должны вырасти ещё
  // раз; приём остаётся записанным — «Отменить запись» сцене не нужна.
  const kcalBeforeBreakfast = await dayEatenKcalNow();
  await evaluate(`(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms));
    const b = document.querySelector('button[aria-label="Съел: Завтрак"]');
    if (!b) throw new Error('нет кнопки «Съел: Завтрак» в карточке сводки');
    b.click(); await sleep(350); return 'ok'; })()`);
  const kcalAfterBreakfast = await dayEatenKcalNow();
  report.breakfastLoggedFromCard = {
    before: kcalBeforeBreakfast,
    after: kcalAfterBreakfast,
    grew: kcalBeforeBreakfast !== null && kcalAfterBreakfast !== null && kcalAfterBreakfast > kcalBeforeBreakfast
  };
  if (!report.breakfastLoggedFromCard.grew) failed = true;
  await shot('05-summary-breakfast-logged');

  // 4. Шторки по кнопкам нижней панели вкладок - каждая открывается,
  // снимается и закрывается крестиком. Три иконки уехали из шапки в панель
  // (TabBar.tsx), aria-label у них прежние: «Неделя», «Книга предпочтений»,
  // «Настройки». Перебор ограничен панелью и её кнопками с aria-label: у
  // вкладки «Сводка» его нет намеренно (имя даёт видимая подпись), а секция
  // .day-extras добавляет на сводку ещё две кнопки с aria-label вне панели -
  // «Добавить блюдо из другого дня» и «Своя еда», у них свои сцены ниже (5-8).
  const labels = await evaluate(`[...document.querySelectorAll('nav.tab-bar button[aria-label]')].map(b => b.getAttribute('aria-label'))`);
  report.tabBarButtons = labels;
  let n = 6;
  for (const label of labels) {
    await evaluate(`(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms));
      [...document.querySelectorAll('button[aria-label]')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)}).click();
      await sleep(600); return 'ok'; })()`);
    report['sheet:' + label] = await evaluate(`document.querySelector('[role=dialog]')?.textContent${squash}.slice(0, 200) ?? null`);
    await shot(`${String(n++).padStart(2, '0')}-sheet-${label.replace(/[^a-zа-яё0-9]+/gi, '-').toLowerCase()}`);
    const closed = await closeDialog();
    if (!closed) {
      report['sheet:' + label + ':closed'] = false;
      failed = true;
    }
  }

  // 5. «Добавить блюдо из другого дня»: день 5, обед, доля ½, «Записать».
  // Кнопка теперь в сводке (DaySummary, .day-extras__actions) — ensureSummary()
  // подстраховывает на случай, если предыдущая сцена оставила открытым приём.
  await ensureSummary();
  await evaluate(`(async () => { ${helpers}
    const openBtn = [...document.querySelectorAll('button[aria-label]')].find(b => b.getAttribute('aria-label') === 'Добавить блюдо из другого дня');
    if (!openBtn) throw new Error('нет кнопки «Добавить блюдо из другого дня»');
    openBtn.click(); await sleep(500);
    // День 5 ищем ТОЛЬКО среди чипов шторки (.add-from-menu__days), а не через
    // общий btn(): к этому моменту обед уже записан (шаг 3), и под ним
    // отрисован блок оценки (RatingEditor) с кнопками-баллами 1..10 — они идут
    // раньше в DOM, и btn('5') находил кнопку балла «5», а не чип дня.
    const dayBtn5 = [...document.querySelectorAll('.add-from-menu__days button')].find(b => b.textContent.trim() === '5');
    if (!dayBtn5) throw new Error('нет чипа дня 5 в шторке переноса');
    dayBtn5.click(); await sleep(300);
    const slotBtn = [...document.querySelectorAll('.add-from-menu__slot')].find(b => b.querySelector('.add-from-menu__slot-title')?.textContent.trim() === 'Обед');
    if (!slotBtn) throw new Error('в дне 5 нет приёма «Обед» среди: ' + [...document.querySelectorAll('.add-from-menu__slot-title')].map(b => b.textContent.trim()).join(' | '));
    slotBtn.click(); await sleep(300);
    const half = [...document.querySelectorAll('.add-from-menu__fractions button')].find(b => /^(½|1\\/2)$/.test(b.textContent.trim()));
    if (!half) throw new Error('нет кнопки доли ½ в шторке переноса');
    half.click(); await sleep(300);
    return 'ok'; })()`);
  report['sheet:add-from-menu'] = await evaluate(`document.querySelector('[role=dialog]')?.textContent${squash}.slice(0, 300) ?? null`);
  await shot(`${String(n++).padStart(2, '0')}-sheet-add-from-menu`);

  const dayEatenKcalBefore = await dayEatenKcalNow();
  report.dayEatenKcalBefore = dayEatenKcalBefore;
  await evaluate(`(async () => { ${helpers} await click('Записать'); return 'ok'; })()`);
  await sleep(400);
  const addFromMenuClosed = await evaluate(`document.querySelector('[role=dialog]') === null`);
  if (!addFromMenuClosed) {
    report['sheet:add-from-menu:closed'] = false;
    failed = true;
  }
  const dayEatenKcalAfter = await dayEatenKcalNow();
  report.dayEatenKcalAfter = dayEatenKcalAfter;
  report.dayEatenKcalGrew = dayEatenKcalBefore !== null && dayEatenKcalAfter !== null && dayEatenKcalAfter > dayEatenKcalBefore;
  if (!report.dayEatenKcalGrew) failed = true;
  report['extras:menuRow'] = await evaluate(`document.querySelector('.day-extras__item')?.textContent${squash} ?? null`);
  // Список «Добавлено» стоит под прогрессом дня и карточками приёмов, ниже
  // сгиба — без прокрутки его на снимке нет.
  await evaluate(`document.querySelector('.day-extras')?.scrollIntoView({ block: 'center' })`);
  await sleep(300);
  await shot(`${String(n++).padStart(2, '0')}-main-with-menu-extra`);
  await evaluate('window.scrollTo(0, 0)');
  await sleep(200);

  // 6. «Своя еда» без токена — только объяснение и кнопка настроек, формы нет.
  await ensureSummary();
  await evaluate(`(async () => { ${helpers}
    const openBtn = [...document.querySelectorAll('button[aria-label]')].find(b => b.getAttribute('aria-label') === 'Своя еда');
    if (!openBtn) throw new Error('нет кнопки «Своя еда»');
    openBtn.click(); await sleep(500); return 'ok'; })()`);
  report.customNoToken = await evaluate(`document.querySelector('.custom-food-no-token__text')?.textContent${squash} ?? null`);
  if (!report.customNoToken) failed = true;
  await shot(`${String(n++).padStart(2, '0')}-sheet-custom-no-token`);
  const noTokenClosed = await closeDialog();
  if (!noTokenClosed) {
    report['sheet:custom-no-token:closed'] = false;
    failed = true;
  }

  // 7. «Своя еда» с готовым разбором: токен и pending-заказ status:'done' с
  // result из test/fixtures/food-result.json (настоящий вывод resolve-food.mjs).
  const foodResultFixture = JSON.parse(
    readFileSync(path.resolve('test/fixtures/food-result.json'), 'utf8')
  );
  const todayLocalDate = localDateShifted(0);
  const doneRequest = {
    id: 'shots-custom-done',
    text: foodResultFixture.request.text,
    grams: foodResultFixture.request.grams,
    askedAt: new Date().toISOString(),
    target: { date: todayLocalDate, slot: 'lunch' },
    status: 'done',
    result: foodResultFixture,
    pcAgo: 30
  };
  await evaluate(`(() => { const k = 'eda.state.v1'; const s = JSON.parse(localStorage.getItem(k));
    s.settings.shturmanToken = 'shots';
    s.foodRequests = [${JSON.stringify(doneRequest)}];
    localStorage.setItem(k, JSON.stringify(s)); return 'ok'; })()`);
  await goto(URL_APP);
  await evaluate('window.scrollTo(0, 0)');
  await sleep(200);

  await ensureSummary();
  await evaluate(`(async () => { ${helpers}
    const openBtn = [...document.querySelectorAll('button[aria-label]')].find(b => b.getAttribute('aria-label') === 'Своя еда');
    openBtn.click(); await sleep(500); return 'ok'; })()`);
  report['sheet:custom-done'] = await evaluate(`document.querySelector('.custom-food-request--done')?.textContent${squash}.slice(0, 300) ?? null`);
  report['sheet:custom-done:components'] = await evaluate(`document.querySelectorAll('.custom-food-component').length`);
  if (!report['sheet:custom-done'] || report['sheet:custom-done:components'] !== foodResultFixture.components.length) failed = true;
  await shot(`${String(n++).padStart(2, '0')}-sheet-custom-done`);
  // Второй кадр той же шторки — итог КБЖУ, полнота нутриентов, дата, приём и кнопка записи.
  await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === 'Сохранить и записать')?.scrollIntoView({ block: 'end' })`);
  await sleep(300);
  await shot(`${String(n++).padStart(2, '0')}-sheet-custom-done-totals`);

  const dayEatenKcalBefore2 = await dayEatenKcalNow();
  report.dayEatenKcalBeforeCustom = dayEatenKcalBefore2;
  await evaluate(`(async () => { ${helpers} await click('Сохранить и записать'); return 'ok'; })()`);
  await sleep(400);
  const customDoneClosed = await closeDialog();
  if (!customDoneClosed) {
    report['sheet:custom-done:closed'] = false;
    failed = true;
  }
  const dayEatenKcalAfter2 = await dayEatenKcalNow();
  report.dayEatenKcalAfterCustom = dayEatenKcalAfter2;
  report.dayEatenKcalGrewCustom = dayEatenKcalBefore2 !== null && dayEatenKcalAfter2 !== null && dayEatenKcalAfter2 > dayEatenKcalBefore2;
  if (!report.dayEatenKcalGrewCustom) failed = true;
  report['extras:customRow'] = await evaluate(`[...document.querySelectorAll('.day-extras__item')].map(li => li.textContent${squash}).find(t => t.includes('своя еда')) ?? null`);
  if (!report['extras:customRow']) failed = true;
  // Список «Добавлено» стоит под прогрессом дня и карточками приёмов, ниже
  // сгиба — без прокрутки его на снимке нет.
  await evaluate(`document.querySelector('.day-extras')?.scrollIntoView({ block: 'center' })`);
  await sleep(300);
  await shot(`${String(n++).padStart(2, '0')}-main-with-custom-extra`);
  await evaluate('window.scrollTo(0, 0)');
  await sleep(200);

  // 8. «Своя еда, ПК не в сети»: fetch к SHTURMAN_BASE подменён на pending с
  // pcAgo: 7200 (2 часа), задолго до порога 120 с в useFoodPolling.ts.
  const SHTURMAN_BASE_FOR_MOCK = 'https://shturman.vault-78edd5.workers.dev';
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const BASE = ${JSON.stringify(SHTURMAN_BASE_FOR_MOCK)};
      const orig = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.startsWith(BASE)) {
          const idMatch = url.match(/[?&]id=([^&]+)/);
          const id = idMatch ? decodeURIComponent(idMatch[1]) : 'food:unknown';
          const body = JSON.stringify({ ok: true, id, state: 'pending', pcAgo: 7200, modelOk: true });
          return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return orig(input, init);
      };
    })()`
  }, S);

  const pendingRequest = {
    id: 'shots-custom-pending',
    text: 'тирамису',
    grams: 120,
    askedAt: new Date().toISOString(),
    target: { date: todayLocalDate, slot: 'lunch' },
    status: 'pending',
    pcAgo: null
  };
  await evaluate(`(() => { const k = 'eda.state.v1'; const s = JSON.parse(localStorage.getItem(k));
    s.settings.shturmanToken = 'shots';
    s.foodRequests = [${JSON.stringify(pendingRequest)}];
    localStorage.setItem(k, JSON.stringify(s)); return 'ok'; })()`);
  await goto(URL_APP);
  await sleep(800); // useFoodPolling опрашивает сразу при монтировании — ждём круг опроса
  await evaluate('window.scrollTo(0, 0)');
  await sleep(200);

  await ensureSummary();
  await evaluate(`(async () => { ${helpers}
    const openBtn = [...document.querySelectorAll('button[aria-label]')].find(b => b.getAttribute('aria-label') === 'Своя еда');
    openBtn.click(); await sleep(500); return 'ok'; })()`);
  report.customPending = await evaluate(`document.querySelector('.custom-food-request__status')?.textContent${squash} ?? null`);
  if (!report.customPending || !/не в сети/.test(report.customPending)) failed = true;
  await shot(`${String(n++).padStart(2, '0')}-sheet-custom-pending`);
  const pendingClosed = await closeDialog();
  if (!pendingClosed) {
    report['sheet:custom-pending:closed'] = false;
    failed = true;
  }

  // 9. Широкий экран (960×900) — nav.slot-switch становится липкой боковой
  // колонкой слева от содержимого (layout.css, медиа-запрос 48rem): сводка,
  // затем экран приёма «Обед» в том же облике. Метрики устройства
  // возвращаются к узкой VIEW в конце сцены — она последняя в сценарии, но
  // явный возврат правильнее, чем полагаться на порядок.
  await ensureSummary();
  await evaluate(`window.scrollTo(0, 0)`);
  await sleep(200);
  await shotAt(`${String(n++).padStart(2, '0')}-wide-summary`, WIDE);

  // Метрики уже широкие (shotAt их не возвращает), поэтому боковая колонка на
  // месте и приём открывается её пунктом, а не карточкой сводки.
  await evaluate(`(async () => { ${helpers} await clickNav('Обед'); return 'ok'; })()`);
  await evaluate('window.scrollTo(0, 0)');
  await sleep(200);
  await shotAt(`${String(n++).padStart(2, '0')}-wide-meal`, WIDE);
  report.wideLayout = await evaluate(`(() => {
    const nav = document.querySelector('nav.slot-switch');
    const content = document.querySelector('.screen__content');
    const navRect = nav.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const lunchBtn = [...nav.querySelectorAll('button')]
      .find(b => (b.childNodes[0]?.textContent || '').trim() === 'Обед');
    const sub = lunchBtn?.querySelector('.slot-switch__sub');
    return {
      navRightLeContentLeft: navRect.right <= contentRect.left,
      lunchHasSub: Boolean(sub && sub.textContent.trim().length > 0)
    };
  })()`);
  if (!report.wideLayout.navRightLeContentLeft) failed = true;
  if (!report.wideLayout.lunchHasSub) failed = true;

  await send('Emulation.setDeviceMetricsOverride', VIEW, S);
  await sleep(200);
} catch (err) {
  report.error = String(err);
  failed = true;
} finally {
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  try { await send('Browser.close'); } catch { /* браузер уже закрыт */ }
  ws.close();
  chrome.kill();
}

console.log(`Снимков: ${files.length}, каталог ${OUT}`);
console.log(`Полос: ${report.panel?.fills ?? '—'}, с нулевой высотой: ${report.panel?.zeroHeight ?? '—'}, пустых при проценте > 5: ${report.panel?.emptyWithPct ?? '—'}`);
if (report.error) console.error(report.error);
process.exit(failed ? 1 : 0);
