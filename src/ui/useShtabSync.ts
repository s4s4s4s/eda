/* Отправка дневной сводки еды в Штаб (POST /api/ingest/eda, раздел «Еда»
   плана «Штаб 2.0»). Живёт рядом с useFoodPolling.ts в App.tsx: тот опрашивает
   воркер «Штурмана», этот - раз в изменение состояния - шлёт итог дня
   воркеру «Штаба». Данные «Еды» существуют только в localStorage телефона:
   отправка с телефона в момент сохранения состояния - единственный путь
   доставить их без ручного ввода.

   Токен - существующий settings.shturmanToken: Штаб проверяет
   /api/ingest/eda тем же токеном, что Штурман проверяет /food (оба равны
   APP_TOKEN Штурмана), поэтому отдельная настройка не нужна.

   syncDaySummaries вынесена отдельной чистой (насколько это возможно для
   похода в сеть) функцией от useShtabSync-хука: она берёт хранилище
   отпечатков параметром вместо прямого sessionStorage, поэтому тесты гоняют
   её в node без DOM и без рендера React - тем же способом, каким тестируется
   остальное ядро приложения. */

import { useEffect, useRef } from 'react'
import { todayLocal } from '../core/cycle.ts'
import { dayTotal } from '../core/log.ts'
import { postDaySummary, SHTAB_BASE, summaryFingerprint } from '../core/shtabClient.ts'
import type { DaySummary } from '../core/shtabClient.ts'
import type { AppState } from '../core/types.ts'

const SENT_KEY_PREFIX = 'shtab:sent:'

type FetchFn = typeof fetch

/** Хранилище последних отправленных отпечатков, по одному ключу на дату.
    Прод-реализация - sessionStorage (см. sessionStorageFingerprintStore), тесты
    подставляют обычную Map. */
export interface FingerprintStore {
  get(date: string): string | null
  set(date: string, fingerprint: string): void
}

function sessionStorageFingerprintStore(): FingerprintStore {
  return {
    get(date) {
      try {
        return sessionStorage.getItem(SENT_KEY_PREFIX + date)
      } catch {
        return null
      }
    },
    set(date, fingerprint) {
      try {
        sessionStorage.setItem(SENT_KEY_PREFIX + date, fingerprint)
      } catch {
        // sessionStorage недоступен (приватный режим и т.п.) - отпечаток
        // просто не сохранится, следующий заход попробует отправить снова;
        // сама отправка от этого не ломается.
      }
    }
  }
}

/** Локальная дата, сдвинутая на день назад. Та же арифметика через
    UTC-полдень, что в week.ts (addDaysLocal) - не дублируем экспортом,
    потому что здесь нужен ровно один случай «вчера», а не общий сдвиг на
    диапазон. */
function yesterdayLocal(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const utcNoon = Date.UTC(y, m - 1, d, 12) - 86_400_000
  const dt = new Date(utcNoon)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export function summaryFor(state: AppState, date: string): DaySummary {
  const dayLog = state.log[date]
  const totals = dayLog ? dayTotal(dayLog) : { kcal: 0, p: 0, f: 0, c: 0 }
  return {
    date,
    kcal: totals.kcal,
    protein: totals.p,
    targetKcal: state.settings.targetKcal,
    targetProtein: state.settings.targetProteinG,
    weight: null
  }
}

/** Отправляет сводки сегодняшнего и вчерашнего дня, если их отпечаток
    отличается от того, что лежит в store. Без токена не делает ничего - ни
    одного обращения к store, ни одного вызова fetchFn. Провал отправки не
    трогает store (следующий вызов попробует снова) и сообщается через onWarn
    вместо исключения - вызывающая сторона решает, как долго об этом молчать. */
export async function syncDaySummaries(
  state: AppState,
  base: string,
  token: string,
  store: FingerprintStore,
  fetchFn: FetchFn = fetch,
  onWarn: (date: string, error: string) => void = () => {},
  today: string = todayLocal(new Date())
): Promise<void> {
  if (!token) return

  const yesterday = yesterdayLocal(today)
  for (const date of [today, yesterday]) {
    const summary = summaryFor(state, date)
    const fingerprint = summaryFingerprint(summary)
    if (store.get(date) === fingerprint) continue

    const result = await postDaySummary(base, token, summary, fetchFn)
    if (result.ok) {
      store.set(date, fingerprint)
    } else {
      onWarn(date, result.error)
    }
  }
}

/** После каждого сохранения состояния сверяет отпечаток сводки сегодняшнего и
    вчерашнего дня с последней отправкой (sessionStorage) и досылает то, что
    изменилось. Сетевые и серверные ошибки не бросаются наружу - один
    console.warn на дату за сессию вкладки, дальше тишина, чтобы неработающий
    Штаб не заваливал консоль на каждый рендер. */
export function useShtabSync(state: AppState): void {
  const warnedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const token = state.settings.shturmanToken
    void syncDaySummaries(state, SHTAB_BASE, token, sessionStorageFingerprintStore(), fetch, (date, error) => {
      if (warnedRef.current.has(date)) return
      warnedRef.current.add(date)
      console.warn(`Штаб: не удалось отправить сводку за ${date} - ${error}`)
    })
  }, [state])
}
