/* Клиент маршрута POST /health/meals воркера «Штурмана» (раздел 3.1 плана
   «здоровье в одном месте»). Устроен как foodClient.ts: чистая функция,
   fetchFn передаётся параметром, токен не логируется и не попадает в текст
   ошибки - причины отказа это фиксированные русские строки (или текст ошибки
   самого воркера при 400, он про форму тела, а не про заголовки). */

import { SHTURMAN_BASE } from './foodClient'
import type { SyncEntry } from './sync'

export { SHTURMAN_BASE }

/** Потолок записей в одном запросе по контракту сервера (больше - 400). */
export const MEALS_BATCH_MAX = 200

export type HealthClientFailureReason = 'unauthorized' | 'bad-request' | 'network' | 'bad-response'

export interface MealsAccepted {
  /** id записей, которые сервер принял (в том числе надгробий). */
  accepted: string[]
  /** Затронутые дни, дословно из ответа. */
  days: string[]
}

export type HealthClientResult =
  | ({ ok: true } & MealsAccepted)
  | { ok: false; reason: HealthClientFailureReason; error: string }

type FetchFn = typeof fetch

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function stringList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  return v.every(x => typeof x === 'string') ? (v as string[]) : null
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return undefined
  }
}

/** Разбор ответа по контракту: { ok: true, accepted: [id...], days: [...] }. */
function parseMealsResponse(v: unknown): MealsAccepted | null {
  if (!isPlainObject(v) || v.ok !== true) return null
  const accepted = stringList(v.accepted)
  if (!accepted) return null
  const days = v.days === undefined ? [] : stringList(v.days)
  if (!days) return null
  return { accepted, days }
}

/** Отправляет пачку записей дневника. Не больше MEALS_BATCH_MAX записей:
    разбивать на пачки - дело очереди, а не клиента. */
export async function postMeals(
  base: string,
  token: string,
  body: { entries: readonly SyncEntry[] },
  fetchFn: FetchFn = fetch
): Promise<HealthClientResult> {
  if (body.entries.length > MEALS_BATCH_MAX) {
    return { ok: false, reason: 'bad-request', error: `В запросе больше ${MEALS_BATCH_MAX} записей.` }
  }
  let res: Response
  try {
    res = await fetchFn(`${base}/health/meals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    })
  } catch {
    return { ok: false, reason: 'network', error: 'Не удалось связаться с воркером - проверь подключение к сети.' }
  }
  if (res.status === 401) {
    return { ok: false, reason: 'unauthorized', error: 'Токен приложения не принят - проверь его в Настройках.' }
  }
  if (res.status === 400) {
    const json = await readJson(res)
    const serverError = isPlainObject(json) && typeof json.error === 'string' ? json.error : undefined
    return { ok: false, reason: 'bad-request', error: serverError ?? 'Запрос отклонён воркером как некорректный.' }
  }
  if (res.status === 413) {
    return { ok: false, reason: 'bad-request', error: 'Запрос слишком большой для воркера.' }
  }
  if (!res.ok) {
    return { ok: false, reason: 'bad-response', error: `Воркер ответил кодом ${res.status}.` }
  }
  const parsed = parseMealsResponse(await readJson(res))
  if (!parsed) {
    return { ok: false, reason: 'bad-response', error: 'Ответ воркера пришёл в непонятном виде.' }
  }
  return { ok: true, ...parsed }
}
