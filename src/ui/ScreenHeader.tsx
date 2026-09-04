/* Шапка экрана - дата, чип дня цикла и партии, баннер первого запуска (дата
   старта цикла не подтверждена). Общая для сводки дня и экрана приёма:
   рендерится App-ом один раз над обоими видами, а не дублируется внутри
   каждого.

   Трёх кнопок-иконок (Неделя, Книга, Настройки) здесь больше нет: они уехали
   в нижнюю панель вкладок (TabBar.tsx), под большой палец. Обработчик
   настроек шапке всё-таки нужен - на него нажимает кнопка «Открыть настройки»
   в баннере первого запуска, и вести человека оттуда через панель вкладок
   значило бы прервать начатый вопрос. */

import { formatDateFull } from '../core/cycle.ts'

interface ScreenHeaderProps {
  date: string
  cycleDayNum: number
  cycleDays: number
  batchDayNum: number
  /** Дата первого дня цикла (Settings.cycleStartDate) - баннер первого
      запуска печатает её словами, а не выдуманным «сегодня - день 1», которая
      подставлена при установке и может уже разойтись с сегодня. */
  cycleStartDate: string
  /** Подтверждена ли дата первого дня цикла. Пока false, под шапкой висит
      баннер первого запуска. */
  cycleStartConfirmed: boolean
  /** Кнопка «Всё верно» в баннере первого запуска - дату не трогает. */
  onConfirmCycleStart: () => void
  /** Кнопка «Открыть настройки» в том же баннере. */
  onOpenSettings: () => void
}

export default function ScreenHeader({
  date, cycleDayNum, cycleDays, batchDayNum,
  cycleStartDate, cycleStartConfirmed, onConfirmCycleStart, onOpenSettings
}: ScreenHeaderProps) {
  return (
    <>
      <header className="screen__header">
        <div className="screen__header-lines">
          <div className="screen__date-line">{formatDateFull(date)}</div>
          {/* День цикла и день партии - справка, а не заголовок: чип
              приглушённым кеглем под датой, а не вторая крупная строка. */}
          <div className="screen__day-line chip nums">
            <span>День {cycleDayNum} из {cycleDays}</span>
            <span className="screen__day-line-sep">·</span>
            <span>партия: день {batchDayNum} из 4</span>
          </div>
        </div>
      </header>

      {!cycleStartConfirmed && (
        <div className="cycle-start-notice" role="status">
          <p className="cycle-start-notice__text">
            {/* Дата подставлена при установке и могла разойтись с сегодня -
                баннер печатает факт из data, а не застывшую фразу «сегодня -
                день 1», которая перестаёт быть правдой уже через сутки. */}
            Дата первого дня цикла подставлена при установке: {formatDateFull(cycleStartDate)}.
            Сегодня по ней — день {cycleDayNum} из {cycleDays}.
            Если цикл начался в другой день — поправь дату.
          </p>
          <div className="cycle-start-notice__actions">
            <button type="button" className="btn btn--secondary" onClick={onOpenSettings}>
              Открыть настройки
            </button>
            <button type="button" className="btn btn--primary" onClick={onConfirmCycleStart}>
              Всё верно
            </button>
          </div>
        </div>
      )}
    </>
  )
}
