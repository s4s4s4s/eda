/* Клиент воркера «Штаба» для дневной сводки еды (POST /api/ingest/eda, раздел
   4 плана «Штаб 2.0», подраздел «Еда»). Тот же стиль, что у foodClient.ts:
   чистая функция, fetchFn параметром - тесты подменяют его фейком, а не
   мокают глобальный fetch. Токен нигде не логируется. */

/** Адрес воркера «Штаба». Уточняется после деплоя - вынесен в одну
    константу, чтобы менять адрес правкой в одном месте. */
export const SHTAB_BASE = 'https://shtab.vault-78edd5.workers.dev'

/** Дневная сводка, как её ждёт /api/ingest/eda. weight «Еда» не хранит (в её
    типах вес есть только у продуктов) - вес приходит из вечернего ритуала
    Штаба, поэтому здесь всегда null. */
export interface DaySummary {
  /** Локальная дата YYYY-MM-DD. */
  date: string
  kcal: number
  protein: number
  targetKcal: number
  targetProtein: number
  weight: null
}

export type ShtabPostResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

type FetchFn = typeof fetch

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return undefined
  }
}

/** Отправляет дневную сводку в Штаб. Повторная присылка той же даты
    перезаписывает день на стороне воркера - это его контракт, здесь
    отправка идёт безусловно, решение «отправлять ли снова» принимает
    вызывающая сторона (см. useShtabSync.ts). */
export async function postDaySummary(
  base: string,
  token: string,
  summary: DaySummary,
  fetchFn: FetchFn = fetch
): Promise<ShtabPostResult> {
  let res: Response
  try {
    res = await fetchFn(`${base}/api/ingest/eda`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(summary)
    })
  } catch {
    // сеть недоступна, воркер не отвечает - причина не показывается человеку
    // (см. useShtabSync.ts: console.warn один раз на день), поэтому строка
    // фиксированная, без эха деталей запроса.
    return { ok: false, status: 0, error: 'Не удалось связаться со Штабом.' }
  }
  if (!res.ok) {
    const body = await readJson(res)
    const serverError = isPlainObject(body) && typeof body.error === 'string' ? body.error : undefined
    return { ok: false, status: res.status, error: serverError ?? `Штаб ответил кодом ${res.status}.` }
  }
  return { ok: true }
}

/** Отпечаток сводки для сравнения «изменилось ли с прошлой отправки» -
    округлённые ккал и белок. Округление нужно потому, что дробные хвосты
    арифметики КБЖУ (доли порций, суммирование per100 на граммы) меняются от
    рендера к рендеру на тысячные, а на отправку это менять не должно. */
export function summaryFingerprint(summary: DaySummary): string {
  return `${Math.round(summary.kcal)}:${Math.round(summary.protein)}`
}
