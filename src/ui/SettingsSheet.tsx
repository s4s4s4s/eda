/* Шторка настроек: дата старта цикла, ручной сдвиг, цель по калориям, имя
   команды Shortcuts, честная строка про хранение данных. */

import { cycleDay, todayLocal } from '../core/cycle.ts'
import type { Settings } from '../core/types.ts'

interface SettingsSheetProps {
  settings: Settings
  cycleDays: number
  onChange: (settings: Settings) => void
  onClose: () => void
}

export default function SettingsSheet({ settings, cycleDays, onChange, onClose }: SettingsSheetProps) {
  const today = todayLocal(new Date())
  const todayCycleDay = cycleDay(settings.cycleStartDate, today, settings.cycleShift, cycleDays)

  function patch(partial: Partial<Settings>): void {
    onChange({ ...settings, ...partial })
  }

  return (
    <div className="sheet">
      <div className="sheet__backdrop" onClick={onClose} />
      <div className="sheet__panel">
        <header className="sheet__header">
          <h1 className="sheet__title">Настройки</h1>
          <button type="button" className="sheet__close" onClick={onClose} aria-label="Закрыть">✕</button>
        </header>

        <div className="sheet__body">
          <label className="field">
            <span className="field__label">Дата первого дня цикла</span>
            <input
              type="date"
              className="field__input"
              value={settings.cycleStartDate}
              onChange={e => patch({ cycleStartDate: e.target.value })}
            />
          </label>

          <div className="field">
            <span className="field__label">Сдвинуть цикл</span>
            <div className="cycle-shift">
              <button type="button" className="btn btn--secondary" onClick={() => patch({ cycleShift: settings.cycleShift - 1 })}>
                −1 день
              </button>
              <span className="cycle-shift__today">сегодня — день {todayCycleDay} из {cycleDays}</span>
              <button type="button" className="btn btn--secondary" onClick={() => patch({ cycleShift: settings.cycleShift + 1 })}>
                +1 день
              </button>
            </div>
          </div>

          <label className="field">
            <span className="field__label">Цель по калориям</span>
            <input
              type="number"
              className="field__input"
              value={settings.targetKcal}
              min={0}
              step={50}
              onChange={e => {
                const v = Number(e.target.value)
                if (Number.isFinite(v)) patch({ targetKcal: v })
              }}
            />
          </label>

          <label className="field">
            <span className="field__label">Имя команды Apple Shortcuts</span>
            <input
              type="text"
              className="field__input"
              value={settings.shortcutName}
              placeholder="например, ЗаписатьЕду"
              onChange={e => patch({ shortcutName: e.target.value })}
            />
            <span className="field__hint">
              Пустое имя выключает канал Apple Health — кнопка выгрузки в него будет неактивна.
            </span>
          </label>

          <p className="storage-note">
            Всё состояние (дневник и настройки) хранится только в localStorage этого
            браузера на этом устройстве. Никуда не отправляется, аккаунтов и сервера нет.
            Очистка данных сайта в браузере стирает дневник безвозвратно.
          </p>
        </div>
      </div>
    </div>
  )
}
