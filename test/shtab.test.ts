/**
 * Тесты клиента воркера «Штаба» (src/core/shtabClient.ts) и хука отправки
 * дневной сводки (src/ui/useShtabSync.ts, syncDaySummaries) - раздел «Еда»
 * плана «Штаб 2.0». Гоняется node-ом после сборки esbuild: `npm run test:shtab`.
 */
import { postDaySummary, SHTAB_BASE } from '../src/core/shtabClient'
import type { DaySummary } from '../src/core/shtabClient'
import { syncDaySummaries } from '../src/ui/useShtabSync'
import type { FingerprintStore } from '../src/ui/useShtabSync'
import type { AppState } from '../src/core/types'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}
function group(name: string): void { console.log(`  ok ${name}`); passed++ }

function fakeFetch(status: number, body: unknown): { calls: { url: string; init: RequestInit }[]; fetchFn: typeof fetch } {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    } as unknown as Response
  }) as typeof fetch
  return { calls, fetchFn }
}

function sampleSummary(): DaySummary {
  return { date: '2026-09-04', kcal: 2870, protein: 118, targetKcal: 3200, targetProtein: 120, weight: null }
}

function mapStore(): FingerprintStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: (date) => data.get(date) ?? null,
    set: (date, fingerprint) => { data.set(date, fingerprint) }
  }
}

function stateWithDay(date: string, kcal: number, p: number, targetKcal: number, targetProteinG: number): AppState {
  return {
    version: 5,
    settings: {
      cycleStartDate: '2026-08-01', cycleShift: 0, targetKcal, targetProteinG,
      shortcutName: '', cycleStartConfirmed: true, shturmanToken: 'my-secret-token'
    },
    log: {
      [date]: {
        cycleDay: 1,
        meals: {},
        extras: [{
          id: 'extra-1',
          kind: 'custom',
          customFoodId: 'food-1',
          title: 'обед',
          fraction: 1,
          loggedAt: `${date}T12:00:00`,
          kbju: { kcal, p, f: 0, c: 0 },
          nutrients: {}
        }]
      }
    },
    preferences: { ingredients: {}, dishes: {} },
    customFoods: {},
    foodRequests: []
  } as unknown as AppState
}

// ---- postDaySummary ---------------------------------------------------------

async function postsWithCorrectUrlHeaderAndBodyChecks(): Promise<void> {
  const { fetchFn, calls } = fakeFetch(200, { ok: true, date: '2026-09-04' })
  const summary = sampleSummary()
  const result = await postDaySummary(SHTAB_BASE, 'my-secret-token', summary, fetchFn)
  assert(result.ok === true, `ожидался ok:true, получено ${JSON.stringify(result)}`)
  assert(calls.length === 1, `ожидался ровно один вызов fetch, получено ${calls.length}`)
  assert(calls[0].url === `${SHTAB_BASE}/api/ingest/eda`, `URL ожидался ${SHTAB_BASE}/api/ingest/eda, получено ${calls[0].url}`)
  assert(calls[0].init.method === 'POST', `метод ожидался POST, получено ${calls[0].init.method}`)
  const headers = calls[0].init.headers as Record<string, string>
  assert(headers.authorization === 'Bearer my-secret-token', `заголовок authorization ожидался «Bearer my-secret-token», получено «${headers.authorization}»`)
  assert(headers['content-type'] === 'application/json', `заголовок content-type ожидался application/json, получено ${headers['content-type']}`)
  const body = JSON.parse(calls[0].init.body as string)
  assert(JSON.stringify(body) === JSON.stringify(summary), `тело запроса обязано быть сводкой как есть, получено ${JSON.stringify(body)}`)
  group('postDaySummary: правильные URL, заголовки и тело')
}

async function serverErrorReturnsOkFalseChecks(): Promise<void> {
  const { fetchFn } = fakeFetch(500, { error: 'внутренняя ошибка' })
  const result = await postDaySummary(SHTAB_BASE, 't', sampleSummary(), fetchFn)
  assert(!result.ok, 'ответ 500 обязан давать ok:false')
  if (!result.ok) {
    assert(result.status === 500, `status ожидался 500, получено ${result.status}`)
    assert(result.error === 'внутренняя ошибка', `error обязан прийти от сервера, получено «${result.error}»`)
  }
  group('postDaySummary: 500 от сервера -> ok:false, ничего не бросает')
}

async function networkErrorReturnsOkFalseWithStatusZeroChecks(): Promise<void> {
  const throwingFetch = (async () => { throw new Error('network down') }) as unknown as typeof fetch
  const result = await postDaySummary(SHTAB_BASE, 't', sampleSummary(), throwingFetch)
  assert(!result.ok, 'сетевая ошибка обязана давать ok:false')
  if (!result.ok) {
    assert(result.status === 0, `status ожидался 0, получено ${result.status}`)
  }
  group('postDaySummary: сетевая ошибка -> ok:false, status:0, ничего не бросает')
}

// ---- syncDaySummaries --------------------------------------------------------

async function repeatedSameFingerprintDoesNotRefetchChecks(): Promise<void> {
  const state = stateWithDay('2026-09-04', 2870, 118, 3200, 120)
  const store = mapStore()
  const { fetchFn, calls } = fakeFetch(200, { ok: true, date: '2026-09-04' })

  await syncDaySummaries(state, SHTAB_BASE, 'my-secret-token', store, fetchFn, () => {}, '2026-09-04')
  assert(calls.length === 2, `первый прогон обязан отправить сегодня и вчера (2 запроса), получено ${calls.length}`)

  await syncDaySummaries(state, SHTAB_BASE, 'my-secret-token', store, fetchFn, () => {}, '2026-09-04')
  assert(calls.length === 2, `повторный прогон с тем же отпечатком не обязан делать новых запросов, получено ${calls.length}`)

  const changedState = stateWithDay('2026-09-04', 2999, 118, 3200, 120)
  await syncDaySummaries(changedState, SHTAB_BASE, 'my-secret-token', store, fetchFn, () => {}, '2026-09-04')
  assert(calls.length === 3, `изменившийся отпечаток сегодняшнего дня обязан дать ровно один новый запрос, получено ${calls.length}`)

  group('syncDaySummaries: тот же отпечаток -> без новых запросов, изменившийся -> новый запрос')
}

async function noTokenMakesNoRequestsChecks(): Promise<void> {
  const state = stateWithDay('2026-09-04', 2870, 118, 3200, 120)
  const store = mapStore()
  const { fetchFn, calls } = fakeFetch(200, { ok: true, date: '2026-09-04' })

  await syncDaySummaries(state, SHTAB_BASE, '', store, fetchFn, () => {}, '2026-09-04')
  assert(calls.length === 0, `без токена не обязано быть ни одного запроса, получено ${calls.length}`)
  assert(store.data.size === 0, 'без токена store не обязан трогаться')

  group('syncDaySummaries: без токена - ни одного запроса')
}

async function serverFailureReportsWarningAndDoesNotUpdateStoreChecks(): Promise<void> {
  const state = stateWithDay('2026-09-04', 2870, 118, 3200, 120)
  const store = mapStore()
  const { fetchFn } = fakeFetch(500, { error: 'сбой на воркере' })
  const warnings: { date: string; error: string }[] = []

  await syncDaySummaries(state, SHTAB_BASE, 'my-secret-token', store, fetchFn, (date, error) => warnings.push({ date, error }), '2026-09-04')

  assert(warnings.length === 2, `сбой обязан дать предупреждение на каждую из двух дат, получено ${warnings.length}`)
  assert(warnings[0].error === 'сбой на воркере', `текст предупреждения обязан прийти от сервера, получено «${warnings[0].error}»`)
  assert(store.data.size === 0, 'провалившаяся отправка не обязана записываться в store - следующий заход должен попробовать снова')

  group('syncDaySummaries: 500 от Штаба -> onWarn на каждую дату, store не обновляется, исключений нет')
}

async function main(): Promise<void> {
  console.log('shtab - клиент воркера «Штаба» и синхронизация дневной сводки еды')
  await postsWithCorrectUrlHeaderAndBodyChecks()
  await serverErrorReturnsOkFalseChecks()
  await networkErrorReturnsOkFalseWithStatusZeroChecks()
  await repeatedSameFingerprintDoesNotRefetchChecks()
  await noTokenMakesNoRequestsChecks()
  await serverFailureReportsWarningAndDoesNotUpdateStoreChecks()
  console.log(`\nВсе проверки shtab пройдены (${passed} групп).`)
}

main().catch((e) => {
  console.error('\nТЕСТ SHTAB УПАЛ:\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
})
