/* Опрос воркера «Штурмана» по заказам на разбор своей еды (раздел 1.7 плана
   «своя еда»). Живёт одним хуком в App.tsx, монтируется один раз и работает
   независимо от того, открыта ли шторка CustomFoodSheet: foodRequests лежат
   в AppState и переживают закрытие шторки и перезапуск приложения, поэтому
   опрос не должен зависеть от того, что сейчас на экране.

   Адресация наряда — асимметрия между askFood и pollFood, и это знание
   вызывающей стороны (см. комментарии в foodClient.ts и types.ts у
   FoodRequest.id): askFood получает «сырой» uuid (FoodRequest.id как есть),
   а pollFood — тот же uuid с префиксом «food:», под которым воркер держит
   наряд в своей очереди. Дублировать это правило в другом месте (например,
   в App.tsx при отправке) нельзя — тогда два места могли бы разойтись. */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { applyFoodPoll } from '../core/food.ts'
import { pollFood } from '../core/foodClient.ts'
import type { AppState } from '../core/types.ts'

/** Пока последний известный pcAgo хотя бы одного заказа в очереди не превышает
    порог — это «компьютер недавно был на связи», опрашиваем часто. Иначе —
    редко, чтобы выключенный на сутки компьютер не стоил бесплатному воркеру
    тысяч запросов (см. комментарий в разделе 1.7 плана). */
const FAST_POLL_MS = 4_000
const SLOW_POLL_MS = 60_000
/** Порог в секундах, отделяющий «недавно был на связи» от «давно не в сети». */
const RECENT_PC_THRESHOLD_S = 120

function wireId(id: string): string {
  return `food:${id}`
}

/** Заказ считается «недавно на связи», только если pcAgo уже известен (не
    null) и не превышает порог — свежесозданный заказ, который ещё ни разу не
    опрашивался, здесь не в счёт: он получит первый ответ уже на этом ходе
    опроса, вне зависимости от выбранного интервала. */
function isRecentlyOnline(pcAgo: number | null): boolean {
  return pcAgo !== null && pcAgo <= RECENT_PC_THRESHOLD_S
}

/** Опрашивает все `status === 'pending'` заказы: на монтировании (и заново —
    когда меняется сам набор заказов в очереди) и дальше по таймеру с
    адаптивным интервалом. Возвращает строку последней временной ошибки
    опроса (сеть, неверный токен) или null, если последний круг опроса прошёл
    без сетевых неполадок. Статус заказов при такой ошибке не меняется —
    applyFoodPoll вызывается только для успешных ответов воркера. */
export function useFoodPolling(
  state: AppState,
  setState: Dispatch<SetStateAction<AppState>>,
  base: string,
  token: string
): string | null {
  const [pollError, setPollError] = useState<string | null>(null)

  /* Свежие state/base/token нужны внутри асинхронного цикла опроса, но сам
     эффект не должен перезапускаться на каждое изменение state (иначе поход
     за новым состоянием обрывал бы уже идущий круг опроса) — поэтому они
     читаются через ref, а не идут в зависимости useEffect. */
  const stateRef = useRef(state)
  stateRef.current = state
  const baseRef = useRef(base)
  baseRef.current = base
  const tokenRef = useRef(token)
  tokenRef.current = token

  /* Эффект перезапускается, только когда меняется САМ НАБОР заказов в
     очереди, — не на каждое сохранение состояния. Именно это оправдывает
     повторный запуск цикла: появился новый заказ — его нужно опросить сразу,
     а не ждать до конца текущего медленного интервала. */
  const pendingIds = useMemo(
    () => state.foodRequests.filter(r => r.status === 'pending').map(r => r.id).join(','),
    [state.foodRequests]
  )

  useEffect(() => {
    if (!token || pendingIds === '') return undefined

    let cancelled = false
    let timeoutId: number | undefined

    async function pollOnce(): Promise<void> {
      const pending = stateRef.current.foodRequests.filter(r => r.status === 'pending')
      if (pending.length === 0) return
      const now = new Date().toISOString()
      let roundError: string | null = null
      for (const request of pending) {
        if (cancelled) return
        const result = await pollFood(baseRef.current, tokenRef.current, wireId(request.id))
        if (cancelled) return
        if (result.ok) {
          setState(prev => applyFoodPoll(prev, request.id, result.response, now))
        } else {
          roundError = result.error
        }
      }
      if (!cancelled) setPollError(roundError)
    }

    function nextDelayMs(): number {
      const pending = stateRef.current.foodRequests.filter(r => r.status === 'pending')
      return pending.some(r => isRecentlyOnline(r.pcAgo)) ? FAST_POLL_MS : SLOW_POLL_MS
    }

    function scheduleNext(): void {
      if (cancelled || document.hidden) return
      timeoutId = window.setTimeout(() => {
        void pollOnce().then(scheduleNext)
      }, nextDelayMs())
    }

    function start(): void {
      if (cancelled || document.hidden) return
      void pollOnce().then(scheduleNext)
    }

    function onVisibilityChange(): void {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
        timeoutId = undefined
      }
      // вкладка вернулась на передний план — опрашиваем сразу, не дожидаясь
      // истечения интервала, который тикал бы всё это время впустую; ушла в
      // фон — просто гасим таймер, start() выше уже проверяет document.hidden
      if (!document.hidden) start()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    start()

    return () => {
      cancelled = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [token, base, setState, pendingIds])

  return pollError
}
