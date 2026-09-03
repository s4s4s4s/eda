/* Клиент воркера «Штурмана» для разбора своей еды (маршрут /food, раздел 1.1
   плана «своя еда»). Чистые функции — fetchFn передаётся параметром, чтобы
   тесты подменяли его фейком, а не мокали глобальный fetch. Токен нигде не
   логируется и не попадает в текст ошибки: причины отказа — фиксированные
   русские строки, а не эхо заголовков запроса. */

import type { FoodPollResponse } from './food'

/** Адрес воркера. Тот же, каким пользуется клиент sat-srs (WHY_URL в
    C:\Users\sasha\dev\sat-srs\src\lib\coach.ts) — один воркер на оба проекта. */
export const SHTURMAN_BASE = 'https://shturman.vault-78edd5.workers.dev'

export type FoodClientFailureReason = 'unauthorized' | 'not-found' | 'bad-request' | 'network' | 'bad-response'

export type FoodClientResult =
  | { ok: true; response: FoodPollResponse }
  | { ok: false; reason: FoodClientFailureReason; error: string }

type FetchFn = typeof fetch

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Проверяет форму ответа воркера {ok, id, state, pcAgo, modelOk, ...}.
    Не-JSON или ответ не по форме — это bad-response: воркер жив (HTTP не
    провалился), но прислал то, что клиент не умеет прочитать. */
function parseFoodPollResponse(v: unknown): FoodPollResponse | null {
  if (!isPlainObject(v)) return null
  if (v.ok !== true) return null
  if (typeof v.id !== 'string') return null
  const state = v.state
  if (state !== 'pending' && state !== 'taken' && state !== 'done' && state !== 'failed' && state !== 'expired') return null
  if (typeof v.pcAgo !== 'number' && v.pcAgo !== null) return null
  if (typeof v.modelOk !== 'boolean') return null
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
    askFood и pollFood — оба обязаны трактовать 401/404/400 и не-JSON одинаково. */
async function interpretResponse(res: Response): Promise<FoodClientResult> {
  if (res.status === 401) {
    return { ok: false, reason: 'unauthorized', error: 'Токен приложения не принят — проверь его в Настройках.' }
  }
  if (res.status === 404) {
    return { ok: false, reason: 'not-found', error: 'Такой запрос на разбор не найден — возможно, он уже убран.' }
  }
  if (res.status === 400) {
    const body = await readJson(res)
    const serverError = isPlainObject(body) && typeof body.error === 'string' ? body.error : undefined
    return { ok: false, reason: 'bad-request', error: serverError ?? 'Запрос отклонён воркером как некорректный.' }
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

async function callWorker(url: string, token: string, init: RequestInit, fetchFn: FetchFn): Promise<FoodClientResult> {
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
    // сеть недоступна, ПК/воркер не отвечает и т.п. — токен в это сообщение
    // не попадает, там и так нечего показывать, кроме факта отказа.
    return { ok: false, reason: 'network', error: 'Не удалось связаться с воркером — проверь подключение к сети.' }
  }
  return interpretResponse(res)
}

/** Заказывает разбор. body.id — uuid, сгенерированный приложением заранее
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

/** Опрашивает состояние наряда. id — уже с префиксом food: (как в FoodRequest.id,
    который приложение само генерирует и передаёт воркеру при заказе). */
export async function pollFood(base: string, token: string, id: string, fetchFn: FetchFn = fetch): Promise<FoodClientResult> {
  return callWorker(`${base}/food?id=${encodeURIComponent(id)}`, token, { method: 'GET' }, fetchFn)
}
