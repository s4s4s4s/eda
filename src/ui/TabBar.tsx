/* Нижняя панель вкладок - главная навигация приложения. Четыре кнопки:
   «Сводка» выбирает вид дня, остальные три открывают шторки. Раньше эти три
   были иконками в шапке: на телефоне верх экрана - самое неудобное место для
   пальца, а шторки открывают чаще всего именно на ходу.

   Иконки WeekIcon/BookIcon/SettingsIcon переехали сюда из ScreenHeader.tsx
   без изменений: смысл у них тот же, поменялось только место.

   aria-label кнопок шторок - «Неделя», «Книга предпочтений», «Настройки»:
   ровно эти строки ищет сценарий снимков (scripts/shots.mjs), и на них же
   опирается голосовой доступ. У «Сводки» своего aria-label нет намеренно -
   её имя даёт видимая подпись, и перебор `button[aria-label]` внутри панели
   попадает ровно на три кнопки шторок.

   На узком экране панель липнет к низу (position: fixed) с учётом
   env(safe-area-inset-bottom); на широком (48rem) уезжает в боковую колонку
   под переключатель приёмов и перестаёт быть fixed - см. layout.css. */

import type { View } from './App.tsx'

interface TabBarProps {
  /** Текущий вид: на 'day' активна вкладка «Сводка». */
  view: View
  onSelectDay: () => void
  onOpenWeek: () => void
  onOpenBook: () => void
  onOpenSettings: () => void
}

/* Иконки - inline SVG в currentColor, размер в em: эмодзи-глифы (⚙, ▸) каждая
   система рисует по-своему, часть шрифтов подставляет цветную картинку, и в
   интерфейсе это читается как заглушка. */

function SettingsIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2.2" />
      <circle cx="9" cy="17" r="2.2" />
    </svg>
  )
}

/** Книга предпочтений - раскрытая книга: две страницы корешком. Своя иконка,
    а не украденный смысл у настроек - книга ведёт к вкусу, а не к параметрам. */
function BookIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 6.5c-1.5-1-3.5-1.5-5.5-1.5-1 0-1.7.1-2.5.3v12.7c.8-.2 1.5-.3 2.5-.3 2 0 4 .5 5.5 1.5" />
      <path d="M12 6.5c1.5-1 3.5-1.5 5.5-1.5 1 0 1.7.1 2.5.3v12.7c-.8-.2-1.5-.3-2.5-.3-2 0-4 .5-5.5 1.5V6.5Z" />
    </svg>
  )
}

/** Неделя - семь дней столбиками разной высоты: календарной сетки здесь нет,
    шторка отвечает на вопрос «ем ли я как собирался», а не «какое число». */
function WeekIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M4 19h16" />
      <path d="M6.5 16v-3M10 16V8M13.5 16v-5M17 16v-8" />
    </svg>
  )
}

/** Сводка - то самое кольцо калорий, которое встречает на экране дня.
    Не «домик»: вкладка ведёт не «в начало», а к картине дня. */
function SummaryIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 7.6 5.5" strokeWidth="3" />
    </svg>
  )
}

export default function TabBar({
  view, onSelectDay, onOpenWeek, onOpenBook, onOpenSettings
}: TabBarProps) {
  return (
    <nav className="tab-bar">
      <button
        type="button"
        className={`tab-bar__btn tab-bar__btn--day${view === 'day' ? ' tab-bar__btn--active' : ''}`}
        aria-current={view === 'day' ? 'page' : undefined}
        onClick={onSelectDay}
      >
        <SummaryIcon />
        <span className="tab-bar__label">Сводка</span>
      </button>
      <button type="button" className="tab-bar__btn" aria-label="Неделя" onClick={onOpenWeek}>
        <WeekIcon />
        <span className="tab-bar__label">Неделя</span>
      </button>
      <button type="button" className="tab-bar__btn" aria-label="Книга предпочтений" onClick={onOpenBook}>
        <BookIcon />
        <span className="tab-bar__label">Книга</span>
      </button>
      <button type="button" className="tab-bar__btn" aria-label="Настройки" onClick={onOpenSettings}>
        <SettingsIcon />
        <span className="tab-bar__label">Настройки</span>
      </button>
    </nav>
  )
}
