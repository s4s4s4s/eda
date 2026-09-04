/* Шапка экрана — дата, день цикла и партии, три иконки-кнопки шторок и баннер
   первого запуска (дата старта цикла не подтверждена). Общая для сводки дня и
   экрана приёма: рендерится App-ом один раз над обоими видами, а не дублируется
   внутри каждого — раньше жила внутри MealScreen.tsx. */

import { formatDateFull } from '../core/cycle.ts'

interface ScreenHeaderProps {
  date: string
  cycleDayNum: number
  cycleDays: number
  batchDayNum: number
  onOpenWeek: () => void
  onOpenBook: () => void
  onOpenSettings: () => void
  /** Дата первого дня цикла (Settings.cycleStartDate) — баннер первого
      запуска печатает её словами, а не выдуманным «сегодня — день 1», которая
      подставлена при установке и может уже разойтись с сегодня. */
  cycleStartDate: string
  /** Подтверждена ли дата первого дня цикла. Пока false, под шапкой висит
      баннер первого запуска. */
  cycleStartConfirmed: boolean
  /** Кнопка «Всё верно» в баннере первого запуска — дату не трогает. */
  onConfirmCycleStart: () => void
}

/* Иконки — inline SVG в currentColor, размер в em: эмодзи-глифы (⚙, ▸) каждая
   система рисует по-своему, часть шрифтов подставляет цветную картинку, и в
   интерфейсе это читается как заглушка. */

function SettingsIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2.2" />
      <circle cx="9" cy="17" r="2.2" />
    </svg>
  )
}

/** Книга предпочтений — раскрытая книга: две страницы корешком. Своя иконка,
    а не украденный смысл у настроек — книга ведёт к вкусу, а не к параметрам. */
function BookIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 6.5c-1.5-1-3.5-1.5-5.5-1.5-1 0-1.7.1-2.5.3v12.7c.8-.2 1.5-.3 2.5-.3 2 0 4 .5 5.5 1.5" />
      <path d="M12 6.5c1.5-1 3.5-1.5 5.5-1.5 1 0 1.7.1 2.5.3v12.7c-.8-.2-1.5-.3-2.5-.3-2 0-4 .5-5.5 1.5V6.5Z" />
    </svg>
  )
}

/** Неделя — семь дней столбиками разной высоты: календарной сетки здесь нет,
    шторка отвечает на вопрос «ем ли я как собирался», а не «какое число». */
function WeekIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M4 19h16" />
      <path d="M6.5 16v-3M10 16V8M13.5 16v-5M17 16v-8" />
    </svg>
  )
}

export default function ScreenHeader({
  date, cycleDayNum, cycleDays, batchDayNum, onOpenWeek, onOpenBook, onOpenSettings,
  cycleStartDate, cycleStartConfirmed, onConfirmCycleStart
}: ScreenHeaderProps) {
  return (
    <>
      <header className="screen__header">
        <div className="screen__header-lines">
          <div className="screen__date-line">{formatDateFull(date)}</div>
          <div className="screen__day-line nums">
            <span>День {cycleDayNum} из {cycleDays}</span>
            <span className="screen__day-line-sep">·</span>
            <span>партия: день {batchDayNum} из 4</span>
          </div>
        </div>
        <div className="screen__header-actions">
          <button type="button" className="screen__icon-btn" onClick={onOpenWeek} aria-label="Неделя">
            <WeekIcon />
          </button>
          <button type="button" className="screen__icon-btn" onClick={onOpenBook} aria-label="Книга предпочтений">
            <BookIcon />
          </button>
          <button type="button" className="screen__icon-btn" onClick={onOpenSettings} aria-label="Настройки">
            <SettingsIcon />
          </button>
        </div>
      </header>

      {!cycleStartConfirmed && (
        <div className="cycle-start-notice" role="status">
          <p className="cycle-start-notice__text">
            {/* Дата подставлена при установке и могла разойтись с сегодня —
                баннер печатает факт из data, а не застывшую фразу «сегодня —
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
