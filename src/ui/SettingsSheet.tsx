/* Шторка настроек: дата старта цикла, ручной сдвиг, цель по калориям, цель по
   белку, имя команды Shortcuts, честная строка про хранение данных. Каркас
   (подложка, панель, хват, шапка, закрытие) — общий, в Sheet.tsx. */

import { useState } from 'react'
import { cycleDay, todayLocal } from '../core/cycle.ts'
import { logFootprint } from '../core/log.ts'
import Sheet from './Sheet.tsx'
import type { AppState, Settings } from '../core/types.ts'

interface SettingsSheetProps {
  settings: Settings
  cycleDays: number
  /** Дневник нужен здесь только чтобы показать его размер и дать его стереть. */
  log: AppState['log']
  /** Книга своей еды — входит в тот же размер (см. logFootprint): своя еда с
      компонентами весит не меньше дневника, и молчать про неё в строке
      размера значило бы занижать оценку перед очисткой. */
  customFoods: AppState['customFoods']
  onChange: (settings: Settings) => void
  onClearLog: () => void
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  const kb = bytes / 1024
  return kb < 1024 ? `${kb.toFixed(1)} КБ` : `${(kb / 1024).toFixed(1)} МБ`
}

/** Русское склонение слова «день» по числу дней. */
function daysWord(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return 'дней'
  switch (n % 10) {
    case 1: return 'день'
    case 2:
    case 3:
    case 4: return 'дня'
    default: return 'дней'
  }
}

/** Русское склонение слова «блюдо» по числу — для строки размера книги своей
    еды, той же формы, что и daysWord. */
function dishesWord(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return 'блюд'
  switch (n % 10) {
    case 1: return 'блюдо'
    case 2:
    case 3:
    case 4: return 'блюда'
    default: return 'блюд'
  }
}

export default function SettingsSheet({ settings, cycleDays, log, customFoods, onChange, onClearLog, onClose }: SettingsSheetProps) {
  const today = todayLocal(new Date())
  const todayCycleDay = cycleDay(settings.cycleStartDate, today, settings.cycleShift, cycleDays)
  const footprint = logFootprint(log, customFoods)

  /* Стирание дневника необратимо и никуда не отправляется — поэтому оно в два
     шага, а не по одному нажатию рядом с настройками цикла. */
  const [confirmingClear, setConfirmingClear] = useState(false)

  function patch(partial: Partial<Settings>): void {
    onChange({ ...settings, ...partial })
  }

  return (
    <Sheet title="Настройки" onClose={onClose}>
      {/* Поля сгруппированы в карточки (iOS grouped): «Цикл», «Цели»,
          «Интеграции», «Дневник». Тексты подсказок и подписей не менялись,
          изменилась только группировка. */}
      <div className="card settings-group">
        <h2 className="settings-group__title">Цикл</h2>
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
            <span className="cycle-shift__today">сегодня - день {todayCycleDay} из {cycleDays}</span>
            <button type="button" className="btn btn--secondary" onClick={() => patch({ cycleShift: settings.cycleShift + 1 })}>
              +1 день
            </button>
          </div>
        </div>
      </div>

      <div className="card settings-group">
        <h2 className="settings-group__title">Цели</h2>
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
          <span className="field__label">Цель по белку, г/сут</span>
          <input
            type="number"
            className="field__input"
            value={settings.targetProteinG}
            min={0}
            step={5}
            onChange={e => {
              const v = Number(e.target.value)
              if (Number.isFinite(v)) patch({ targetProteinG: v })
            }}
          />
          <span className="field__hint">
            Личная цель под набор массы. Норма, которой хватает, чтобы не заболеть, ниже - 56 г,
            но она про другое.
          </span>
        </label>
      </div>

      <div className="card settings-group">
        <h2 className="settings-group__title">Интеграции</h2>
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
            Пустое имя выключает канал Apple Health - кнопка выгрузки в него будет неактивна.
          </span>
        </label>

        <label className="field">
          <span className="field__label">Токен приложения для Штурмана</span>
          <input
            type="password"
            className="field__input"
            autoComplete="off"
            value={settings.shturmanToken}
            onChange={e => patch({ shturmanToken: e.target.value })}
          />
          <span className="field__hint">
            Хранится только в этом браузере, нужен для разбора своей еды на домашнем компьютере.
          </span>
        </label>
      </div>

      <div className="card settings-group">
        <h2 className="settings-group__title">Дневник</h2>
        <div className="field">
          <span className="field__label">Объём записей</span>
          <span className="field__hint">
            {footprint.days === 0 && footprint.foods === 0
              ? 'Записей нет'
              : [
                  footprint.days > 0 ? `${footprint.days} ${daysWord(footprint.days)}` : null,
                  footprint.foods > 0 ? `${footprint.foods} ${dishesWord(footprint.foods)} своей еды` : null
                ].filter(Boolean).join(', ') + `, ${formatBytes(footprint.bytes)} в хранилище браузера`}
          </span>
          {footprint.days > 0 && !confirmingClear && (
            <button type="button" className="btn btn--secondary" onClick={() => setConfirmingClear(true)}>
              Очистить дневник
            </button>
          )}
          {confirmingClear && (
            <div className="clear-log">
              <span className="clear-log__warning">
                Записи стираются безвозвратно и никуда не выгружены. Выгрузите нужные дни
                до очистки: кнопка «выгрузить день» на главном экране.
              </span>
              <div className="clear-log__actions">
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => { onClearLog(); setConfirmingClear(false) }}
                >
                  Стереть всё
                </button>
                <button type="button" className="btn btn--secondary" onClick={() => setConfirmingClear(false)}>
                  Отмена
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="storage-note">
          Всё состояние (дневник и настройки) хранится только в localStorage этого
          браузера на этом устройстве. Никуда не отправляется, аккаунтов и сервера нет.
          Очистка данных сайта в браузере стирает дневник безвозвратно.
        </p>
      </div>
    </Sheet>
  )
}
