/* Клиент воркера «Штурмана» для разбора своей еды (маршрут /food, раздел 1.1
   плана «своя еда»). Чистые функции - fetchFn передаётся параметром, чтобы
   тесты подменяли его фейком, а не мокали глобальный fetch. Токен нигде не
   логируется и не попадает в текст ошибки: причины отказа - фиксированные
   русские строки, а не эхо заголовков запроса. */

import { parseOffProduct } from './food'
import type { FoodPollResponse } from './food'
import type { OffProduct } from './types'

/** Адрес воркера. Тот же, каким пользуется клиент sat-srs (WHY_URL в
    C:\Users\sasha\dev\sat-srs\src\lib\coach.ts) - один воркер на оба проекта. */
export const SHTURMAN_BASE = 'https://shturman.vault-78edd5.workers.dev'

/** 'off' - Open Food Facts не дал карточку товара при заказе по штрихкоду
    (воркер отвечает 404/502/504 с {reason}); текст ошибки уже русский, от воркера. */
export type FoodClientFailureReason = 'unauthorized' | 'not-found' | 'bad-request' | 'network' | 'bad-response' | 'off'

export type FoodClientResult =
  | { ok: true; response: FoodPollResponse }
  | { ok: false; reason: FoodClientFailureReason; error: string }

type FetchFn = typeof fetch

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Проверяет форму ответа воркера {ok, id, state, pcAgo, modelOk, ...}.
    Не-JSON или ответ не по форме - это bad-response: воркер жив (HTTP не
    провалился), но прислал то, что клиент не умеет прочитать. */
function parseFoodPollResponse(v: unknown): FoodPollResponse | null {
  if (!isPlainObject(v)) return null
  if (v.ok !== true) return null
  if (typeof v.id !== 'string') return null
  const state = v.state
  if (state !== 'pending' && state !== 'taken' && state !== 'done' && state !== 'failed' && state !== 'expired') return null
  if (typeof v.pcAgo !== 'number' && v.pcAgo !== null) return null
  if (typeof v.modelOk !== 'boolean' && v.modelOk !== null) return null
  if (v.error !== undefined && typeof v.error !== 'string') return null
  return {
    ok: true,
    id: v.id,
    state,
    ...(v.result !== undefined ? { result: v.result } : {}),
    ...(typeof v.error === 'string' ? { error: v.error } : {}),
    pcAgo: v.pcAgo,
    modelOk: v.modelOk
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return undefined
  }
}

/** Разбирает HTTP-ответ воркера в размеченное объединение. Общий код для
    askFood и pollFood - оба обязаны трактовать 401/404/400 и не-JSON одинаково. */
async function interpretResponse(res: Response, offAware = false): Promise<FoodClientResult> {
  if (res.status === 401) {
    return { ok: false, reason: 'unauthorized', error: 'Токен приложения не принят - проверь его в Настройках.' }
  }
  if (offAware && (res.status === 404 || res.status === 502 || res.status === 504)) {
    const body = await readJson(res)
    if (isPlainObject(body) && typeof body.reason === 'string') {
      const serverError = typeof body.error === 'string' ? body.error : undefined
      return { ok: false, reason: 'off', error: serverError ?? 'Open Food Facts не ответил, попробуй через минуту.' }
    }
    // 404 без reason - сбой на стороне воркера (маршрут, прокси), а не «штрихкода нет»:
    // not-found карточка товара читает как отсутствие штрихкода в Open Food Facts.
    return { ok: false, reason: 'bad-response', error: `Воркер ответил кодом ${res.status}.` }
  }
  if (res.status === 404) {
    return { ok: false, reason: 'not-found', error: 'Такой запрос на разбор не найден - возможно, он уже убран.' }
  }
  if (res.status === 400) {
    const body = await readJson(res)
    const serverError = isPlainObject(body) && typeof body.error === 'string' ? body.error : undefined
    return { ok: false, reason: 'bad-request', error: serverError ?? 'Запрос отклонён воркером как некорректный.' }
  }
  if (res.status === 413) {
    return { ok: false, reason: 'bad-request', error: 'Снимок слишком большой, попробуй переснять ближе.' }
  }
  if (!res.ok) {
    return { ok: false, reason: 'bad-response', error: `Воркер ответил кодом ${res.status}.` }
  }
  const body = await readJson(res)
  const response = parseFoodPollResponse(body)
  if (!response) {
    return { ok: false, reason: 'bad-response', error: 'Ответ воркера пришёл в непонятном виде.' }
  }
  return { ok: true, response }
}

async function callWorker(url: string, token: string, init: RequestInit, fetchFn: FetchFn, offAware = false): Promise<FoodClientResult> {
  let res: Response
  try {
    res = await fetchFn(url, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${token}`
      }
    })
  } catch {
    // сеть недоступна, ПК/воркер не отвечает и т.п. - токен в это сообщение
    // не попадает, там и так нечего показывать, кроме факта отказа.
    return { ok: false, reason: 'network', error: 'Не удалось связаться с воркером - проверь подключение к сети.' }
  }
  return interpretResponse(res, offAware)
}

/** Заказывает разбор. body.id - uuid, сгенерированный приложением заранее
    (см. newFoodRequest в food.ts); он же адресует наряд и в последующем опросе. */
export async function askFood(
  base: string,
  token: string,
  body: { id: string; text: string; grams?: number | null },
  fetchFn: FetchFn = fetch
): Promise<FoodClientResult> {
  return callWorker(`${base}/food`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }, fetchFn)
}

/** Заказывает разбор по снимку наклейки. Поле text в тело НЕ кладётся нарочно:
    старый воркер без поддержки kind ответит 400 «поле text обязательно», а не
    создаст текстовый наряд из заметки и не потеряет фото молча. */
export async function askLabel(
  base: string,
  token: string,
  body: { id: string; mime: string; image: string; note?: string; grams?: number | null },
  fetchFn: FetchFn = fetch
): Promise<FoodClientResult> {
  return callWorker(`${base}/food`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: body.id,
      kind: 'label',
      mime: body.mime,
      image: body.image,
      note: body.note ?? '',
      grams: body.grams ?? null
    })
  }, fetchFn)
}

/** Заказывает разбор товара из Open Food Facts по штрихкоду. Факты о товаре
    воркер берёт сам, поэтому тело несёт только код и граммы; цель и долю
    держит FoodRequest клиента. Отказ OFF приходит как reason 'off'. */
export async function askProduct(
  base: string,
  token: string,
  body: { id: string; code: string; grams: number; note?: string },
  fetchFn: FetchFn = fetch
): Promise<FoodClientResult> {
  return callWorker(`${base}/food`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: body.id, kind: 'product', code: body.code, grams: body.grams, note: body.note ?? '' })
  }, fetchFn, true)
}

/** Опрашивает состояние наряда. id - уже с префиксом food: (как в FoodRequest.id,
    который приложение само генерирует и передаёт воркеру при заказе). */
export async function pollFood(base: string, token: string, id: string, fetchFn: FetchFn = fetch): Promise<FoodClientResult> {
  return callWorker(`${base}/food?id=${encodeURIComponent(id)}`, token, { method: 'GET' }, fetchFn)
}

export type OffClientFailureReason =
  | 'unauthorized' | 'bad-request' | 'not-found' | 'no-nutrition' | 'off-unavailable' | 'old-worker' | 'network' | 'bad-response'

/** detail - техническая причина (сообщение разбора), не для показа человеку:
    error остаётся фиксированной русской строкой. */
type OffFailure = { ok: false; reason: OffClientFailureReason; error: string; detail?: string }

/** skipped - сколько товаров отбросил воркер (нет полного КБЖУ); invalid - сколько
    items клиент не смог разобрать (воркер прислал не ту форму), invalidReason -
    сообщение первой ошибки разбора. */
export type OffSearchResult =
  | { ok: true; items: OffProduct[]; skipped: number; invalid: number; invalidReason?: string; total: number }
  | OffFailure

export type OffProductResult =
  | { ok: true; product: OffProduct }
  | OffFailure

/** Общий разбор статусов маршрутов /off/*. Возвращает отказ либо null, если
    статус успешный и тело надо читать дальше. */
async function interpretOffFailure(res: Response): Promise<OffFailure | null> {
  if (res.status === 401) {
    return { ok: false, reason: 'unauthorized', error: 'Токен приложения не принят - проверь его в Настройках.' }
  }
  if (res.status === 404) {
    const body = await readJson(res)
    const reason = isPlainObject(body) ? body.reason : undefined
    if (reason === 'not-found' || reason === 'no-nutrition') {
      const serverError = isPlainObject(body) && typeof body.error === 'string' ? body.error : undefined
      const fallback = reason === 'no-nutrition'
        ? 'У товара в Open Food Facts нет полного КБЖУ на 100 г.'
        : 'Товара с таким штрихкодом в Open Food Facts не найдено.'
      return { ok: false, reason, error: serverError ?? fallback }
    }
    return { ok: false, reason: 'old-worker', error: 'Воркер ещё не обновлён: поиск товаров недоступен.' }
  }
  if (res.status === 400) {
    const body = await readJson(res)
    const serverError = isPlainObject(body) && typeof body.error === 'string' ? body.error : undefined
    return { ok: false, reason: 'bad-request', error: serverError ?? 'Запрос отклонён воркером как некорректный.' }
  }
  if (res.status === 502 || res.status === 504) {
    return { ok: false, reason: 'off-unavailable', error: 'Open Food Facts не отвечает, попробуй через минуту.' }
  }
  if (!res.ok) {
    return { ok: false, reason: 'bad-response', error: `Воркер ответил кодом ${res.status}.` }
  }
  return null
}

const OFF_BAD_BODY: OffFailure = { ok: false, reason: 'bad-response', error: 'Ответ воркера пришёл в непонятном виде.' }

/** GET к маршруту /off/*: либо отказ, либо тело ответа как есть. */
async function callOff(url: string, token: string, fetchFn: FetchFn): Promise<{ failure: OffFailure } | { body: unknown }> {
  let res: Response
  try {
    res = await fetchFn(url, { method: 'GET', headers: { authorization: `Bearer ${token}` } })
  } catch {
    return { failure: { ok: false, reason: 'network', error: 'Не удалось связаться с воркером - проверь подключение к сети.' } }
  }
  const failure = await interpretOffFailure(res)
  if (failure) return { failure }
  return { body: await readJson(res) }
}

/** Поиск товаров в Open Food Facts через воркер. Битый item пропускается и
    считается в invalid (skipped - только отсев воркера); о нём пишется один
    console.warn на ответ. bad-response - только когда тело негодно целиком. */
export async function searchOff(base: string, token: string, q: string, n: number, fetchFn: FetchFn = fetch): Promise<OffSearchResult> {
  const got = await callOff(`${base}/off/search?q=${encodeURIComponent(q)}&n=${n}`, token, fetchFn)
  if ('failure' in got) return got.failure
  const body = got.body
  if (!isPlainObject(body) || body.ok !== true || !Array.isArray(body.items)) return OFF_BAD_BODY
  const items: OffProduct[] = []
  let invalid = 0
  let invalidReason: string | undefined
  for (const raw of body.items) {
    try {
      items.push(parseOffProduct(raw))
    } catch (e) {
      invalid += 1
      invalidReason ??= e instanceof Error ? e.message : String(e)
    }
  }
  if (invalidReason !== undefined) console.warn(`searchOff: не разобрано товаров: ${invalid}, первая причина: ${invalidReason}`)
  const serverSkipped = typeof body.skipped === 'number' && Number.isFinite(body.skipped) ? body.skipped : 0
  const total = typeof body.total === 'number' && Number.isFinite(body.total) ? body.total : items.length
  return { ok: true, items, skipped: serverSkipped, invalid, ...(invalidReason !== undefined ? { invalidReason } : {}), total }
}

/** Карточка товара Open Food Facts по штрихкоду (8-14 цифр). */
export async function fetchOffProduct(base: string, token: string, code: string, fetchFn: FetchFn = fetch): Promise<OffProductResult> {
  const got = await callOff(`${base}/off/product?code=${encodeURIComponent(code)}`, token, fetchFn)
  if ('failure' in got) return got.failure
  const body = got.body
  if (!isPlainObject(body) || body.ok !== true) return OFF_BAD_BODY
  try {
    return { ok: true, product: parseOffProduct(body.product) }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.warn(`fetchOffProduct: карточка не разобрана: ${detail}`)
    return { ...OFF_BAD_BODY, detail }
  }
}
