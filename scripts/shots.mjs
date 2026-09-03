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
// Сценарий: первый запуск (баннер даты цикла) → дата цикла «позавчера» (день 3) →
// обед записан наполовину, ужин целиком → обед с раскрытой панелью нутриентов →
// каждая шторка из шапки. Итог — PNG-файлы, report.json и код возврата: 1, если
// хоть одна полоса с процентом получила нулевую ширину или высоту.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const URL_APP = process.argv[2] ?? 'http://localhost:5173/eda/';
const OUT = path.resolve(process.argv[3] ?? 'node_modules/.cache/eda/shots');
const VIEW = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };

if (!existsSync(CHROME)) {
  console.error(`Chrome не найден: ${CHROME}. Укажи путь через переменную окружения CHROME.`);
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Дата в местном времени сдвигом на N дней от сегодня, ГГГГ-ММ-ДД. */
function localDateShifted(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(OUT, 'profile')}`,
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

/* Помощники внутри страницы: кнопка по точному тексту и клик с паузой на перерисовку. */
const helpers = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const btn = t => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t);
  const click = async (t) => { const b = btn(t); if (!b) throw new Error('нет кнопки ' + t); b.click(); await sleep(350); };
`;
const squash = `.replace(/\\s+/g, ' ').trim()`;

const report = {};
let failed = false;
try {
  // 1. Первый запуск как есть — баннер про дату цикла и дефолтное состояние.
  await goto(URL_APP);
  report.firstRunBanner = await evaluate(`document.querySelector('.cycle-start-notice')?.textContent${squash} ?? null`);
  await shot('01-first-run');

  // 2. Дата цикла позавчера — сегодня день 3, приёмы на экране из середины цикла.
  const cycleStart = localDateShifted(-2);
  await evaluate(`(() => { const k = 'eda.state.v1'; const s = JSON.parse(localStorage.getItem(k));
    s.settings.cycleStartDate = ${JSON.stringify(cycleStart)}; s.settings.cycleStartConfirmed = true;
    localStorage.setItem(k, JSON.stringify(s)); return 'ok'; })()`);
  await goto(URL_APP);
  report.header = await evaluate(`document.querySelector('header')?.textContent${squash}.slice(0, 80) ?? null`);
  await shot('02-day3-top');

  // 3. Обед — половина, ужин — целиком; обед с раскрытой панелью нутриентов.
  await evaluate(`(async () => { ${helpers}
    await click('Обед'); await click('Съел часть');
    const half = [...document.querySelectorAll('button')].find(b => /^(½|1\\/2)$/.test(b.textContent.trim()));
    if (!half) throw new Error('нет кнопки половины среди: ' + [...document.querySelectorAll('.meal-actions button')].map(b => b.textContent.trim()).join(' | '));
    half.click(); await sleep(350);
    await click('Ужин'); await click('Съел');
    await click('Обед');
    const summary = [...document.querySelectorAll('summary')].find(s => s.textContent.includes('Микронутриенты'));
    if (!summary) throw new Error('нет панели «Микронутриенты»');
    summary.click(); await sleep(500); return 'ok'; })()`);
  report.panel = await evaluate(`(() => {
    const panel = [...document.querySelectorAll('details')].find(d => d.textContent.includes('Микронутриенты'));
    const fills = [...document.querySelectorAll('.nutrient__fill, .day-progress__fill')];
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

  // 4. Шторки по кнопкам шапки — каждая открывается, снимается и закрывается крестиком.
  const labels = await evaluate(`[...document.querySelectorAll('button[aria-label]')].filter(b => !b.closest('[role=dialog]')).map(b => b.getAttribute('aria-label'))`);
  report.headerButtons = labels;
  let n = 4;
  for (const label of labels) {
    await evaluate(`(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms));
      [...document.querySelectorAll('button[aria-label]')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)}).click();
      await sleep(600); return 'ok'; })()`);
    report['sheet:' + label] = await evaluate(`document.querySelector('[role=dialog]')?.textContent${squash}.slice(0, 200) ?? null`);
    await shot(`${String(n++).padStart(2, '0')}-sheet-${label.replace(/[^a-zа-яё0-9]+/gi, '-').toLowerCase()}`);
    const closed = await evaluate(`(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms));
      const d = document.querySelector('[role=dialog]');
      const close = d && [...d.querySelectorAll('button')].find(b => b.textContent.trim() === '✕' || /закры/i.test(b.getAttribute('aria-label') || ''));
      close?.click(); await sleep(400); return document.querySelector('[role=dialog]') === null; })()`);
    if (!closed) {
      report['sheet:' + label + ':closed'] = false;
      failed = true;
    }
  }
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
