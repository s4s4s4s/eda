/* Экран приёма — содержимое одного приёма пищи: заголовок с окном времени,
   состав двумя раздельными списками, сборка, плюсы/минусы, КБЖУ, заметка о
   ревизии справочника, микронутриенты приёма, липкая панель действий и
   оценка. Порядок блоков сверху вниз — контракт из DESIGN.md, раздел
   «Иерархия экрана приёма» (шапка, кнопка «← Сводка», переключатель приёмов,
   прогресс дня и «Добавлено» живут в App.tsx/ScreenHeader.tsx/DaySummary.tsx):
   сначала еда, потом числа — человек открывает экран, чтобы узнать, что
   положить в тарелку.

   Каждый смысловой блок - одна карточка (.card), а не карточка на строку:
   состав, сборка, плюсы, минусы, КБЖУ, микронутриенты и оценка. Заголовок
   раздела стоит НАД карточкой мелким капсом: он подписывает группу, а не
   соперничает с названием блюда. */

import { useState } from 'react'
import { itemGrams } from '../core/nutrition.ts'
import { stanceOf } from '../core/preferences.ts'
import type { MealMinus, MealPlus, MealVerdict } from '../core/verdict.ts'
import { NUTRIENT_TITLE, NUTRIENT_UNIT, SLOT_TITLE } from '../core/types.ts'
import type {
  DishRating, ExtraLogEntry, Item, Kbju, Meal, MealLogEntry, MealStatus, NutrientNorms,
  NutrientTotals, Preferences, ProductIndex, Slot
} from '../core/types.ts'
import { formatDateFull } from '../core/cycle.ts'
import { formatNutrientAmount } from '../core/export/format.ts'
import { FRACTIONS, fractionLabel } from './fractions.ts'
import MacroBar from './MacroBar.tsx'
import { NutrientsBlock } from './NutrientsBlock.tsx'
import { SLOT_TIME_RANGE, STATUS_LABEL } from './slots.ts'
import type { DaySlotProgress } from './slots.ts'
import RatingEditor from './RatingEditor.tsx'

interface MealScreenProps {
  /** ISO-дата показываемого дня (YYYY-MM-DD) — заметка о ревизии печатает её
      словами. */
  date: string
  slot: Slot
  /** Приём, который идёт сейчас по времени суток. Если разошёлся с открытым
      слотом — под заголовком появляется ссылка «вернуться к текущему». */
  currentSlot: Slot
  onSelectSlot: (slot: Slot) => void
  meal: Meal | undefined
  /** КБЖУ приёма — из меню, если оно есть, иначе из снапшота записи
      (entry.kbju), иначе undefined. undefined — не «нули», а «нечего
      показать»: карточка КБЖУ в этом случае не рисуется вовсе. */
  mealKbju: Kbju | undefined
  /** Сумма нутриентов приёма вместе с полнотой: неизвестное здесь не ноль. */
  mealNutrients: NutrientTotals
  /** Сумма нутриентов за весь день — единственное, с чем можно сравнивать
      суточные нормы. Процент от нормы по одному приёму был бы неправдой. */
  dayNutrients: NutrientTotals
  /** Суточные нормы из data/norms.yaml. Карта частичная: ключа нет — нормы нет. */
  norms: NutrientNorms
  products: ProductIndex
  /** Книга предпочтений: отметки ингредиентов и оценки блюд. */
  preferences: Preferences
  /** Плюсы и минусы этого приёма — уже посчитаны core/verdict.ts, экран сам
      ничего не пересчитывает. */
  verdict: MealVerdict
  entry: MealLogEntry | undefined
  /** Текущая ревизия справочника продуктов (data/products.yaml, поле revision).
      Сравнивается с `entry.productsRevision`: справочник правится, а снапшот
      записи — нет, и расхождение стоит показать, а не спрятать за одинаково
      выглядящими числами. */
  productsRevision: string
  /** Оценка блюда по горячим следам. undefined — «не оценено». Блок оценки
      вообще не рисуется, пока приём не записан или у блюда нет id. */
  rating: DishRating | undefined
  onRate: (score: number, comment: string) => void
  onClearRating: () => void
  /** Все четыре приёма дня — нужны только подписи «Микронутриентов»
      (nutrientsCaption внутри NutrientsBlock), сам прогресс дня рисует
      DaySummary. */
  daySlots: DaySlotProgress[]
  /** Съеденное сверх меню за день — хвост подписи «+ добавлено: …» у
      NutrientsBlock (режимы 'day'/'projected'); сам список карточек
      «Добавлено» рисует DaySummary. */
  extras: ExtraLogEntry[]
  onLog: (slot: Slot, status: MealStatus, fraction: number) => void
  onUnlog: (slot: Slot) => void
  onOpenExport: () => void
}

function round(n: number): number {
  return Math.round(n)
}

/** Галочка у строки состояния записанного приёма. Цвет берётся от текста
    строки (currentColor, --ok), размер от кегля: своих значений у глифа нет. */
function CheckIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5 12.5 10 17.5 19 7" />
    </svg>
  )
}

/** Количество позиции ровно в том виде, в каком оно задано в меню: граммы,
    штуки или ложки — не переводим штуки/ложки в граммы в основной строке. */
function quantityLabel(item: Item): string {
  if (item.g !== undefined) return `${round(item.g)} г`
  if (item.pieces !== undefined) return `${item.pieces} шт`
  if (item.tbsp !== undefined) return `${item.tbsp} ст. л.`
  return ''
}

/** Отметка ингредиента из книги предпочтений — точка перед названием, у
    «не ем» ещё и зачёркнутое название. Нейтральный продукт не несёт ничего:
    приложение не прячет и не вычёркивает саму позицию, меню уже приготовлено.

    Строка живёт внутри карточки раздела (примитив .list__row): одна карточка
    на раздел, а не карточка на ингредиент. */
function ItemRow({ item, products, preferences }: { item: Item; products: ProductIndex; preferences: Preferences }) {
  const product = products.get(item.product)
  const name = product?.name ?? item.product
  const stance = stanceOf(preferences, item.product)
  const needsGramHint = item.pieces !== undefined || item.tbsp !== undefined
  let gramHint: string | null = null
  if (needsGramHint) {
    try {
      gramHint = `≈ ${round(itemGrams(item, products))} г`
    } catch {
      gramHint = null
    }
  }
  return (
    <li className="list__row meal-item">
      <span className="meal-item__name">
        {stance === 'love' && <span className="stance-dot stance-dot--love" aria-hidden="true" />}
        {stance === 'avoid' && <span className="stance-dot stance-dot--avoid" aria-hidden="true" />}
        <span className={stance === 'avoid' ? 'name--avoided' : undefined}>{name}</span>
      </span>
      <span className="meal-item__qty">
        <span className="meal-item__qty-value nums">{quantityLabel(item)}</span>
        {gramHint && <span className="meal-item__qty-hint nums">{gramHint}</span>}
      </span>
    </li>
  )
}

/** Раздел состава: заголовок мелким капсом над карточкой, внутри карточки —
    строки. Оба раздела показываются всегда, даже пустыми: «в контейнере
    пусто» и «раздела нет» - разные утверждения, и пустой раздел говорит
    словами, а не отсутствием. */
function MealItemsSection({
  title, items, emptyText, products, preferences
}: {
  title: string
  items: Item[]
  emptyText: string
  products: ProductIndex
  preferences: Preferences
}) {
  return (
    <section className="meal-section">
      <h2 className="meal-section__title">{title}</h2>
      {items.length === 0
        ? <div className="card"><p className="meal-section__empty">{emptyText}</p></div>
        : (
          /* Карточка снаружи, список внутри: примитивы .card и .list оба
             задают padding, и повесить их на один узел значило бы, что
             карточка останется без внутреннего отступа. */
          <div className="card">
            <ul className="list">
              {items.map((item, i) => (
                <ItemRow key={i} item={item} products={products} preferences={preferences} />
              ))}
            </ul>
          </div>
        )}
    </section>
  )
}

function productName(id: string, products: ProductIndex): string {
  return products.get(id)?.name ?? id
}

/** Строка плюса — человеческими словами, без ключей и долей в сыром виде.
    Норма с основанием AI (адекватное потребление) — не суточная норма в
    строгом смысле, и текст обязан это сказать: «% суточной нормы» для неё
    было бы враньём того же рода, что «набрано 0 из 26» на пустом дне. */
function plusLabel(plus: MealPlus, products: ProductIndex, norms: NutrientNorms): string {
  if (plus.kind === 'loved') {
    return `любимое: ${plus.products.map(id => productName(id, products)).join(', ')}`
  }
  const pct = Math.round(plus.ratio * 100)
  const isAi = norms[plus.key]?.basis === 'ai'
  return isAi
    ? `${NUTRIENT_TITLE[plus.key]} — ${pct} % ориентира (AI)`
    : `${NUTRIENT_TITLE[plus.key]} — ${pct} % суточной нормы`
}

/** Строка минуса. `low-coverage` и `sodium-cdrr` объясняются отдельно — оба
    легко прочитать неправильно, если оставить голым числом. */
function minusLabel(minus: MealMinus, products: ProductIndex): string {
  switch (minus.kind) {
    case 'avoided':
      return `здесь то, что ты не ешь: ${minus.products.map(id => productName(id, products)).join(', ')}`
    case 'over-ul': {
      const unit = NUTRIENT_UNIT[minus.key]
      return `${NUTRIENT_TITLE[minus.key]} — ${formatNutrientAmount(minus.value)} ${unit}, выше верхнего `
        + `безопасного предела ${formatNutrientAmount(minus.ul)} ${unit}`
    }
    case 'sodium-cdrr':
      return `натрий — ${formatNutrientAmount(minus.value)} мг, выше порога снижения риска `
        + `${formatNutrientAmount(minus.cdrr)} мг (это не предел безопасности — у натрия верхнего предела нет)`
    case 'low-coverage': {
      const missing = minus.total > 0 ? Math.round((1 - minus.known / minus.total) * 100) : 0
      return `данных нет о ${missing} % состава — числам выше можно верить только снизу`
    }
  }
}

/** Плюсы и минусы приёма — DESIGN.md, раздел «Плюсы и минусы приёма». Блок
    рисуется только при наличии, и каждая колонка отдельно: «сказать нечего»
    и «всё плохо» не имеют права выглядеть одинаково. Колонки - две карточки
    рядом на широком экране и одна под другой на узком; сторону называет
    цветная точка у заголовка (--ok / --danger), а не цвет текста.

    Заголовки и сам факт наличия блока зависят от того, что именно посчитано:
    - приём пропущен (`entry.status === 'skipped'`) — считать нечего вообще
      (App.tsx отдаёт `verdict` пустым), и вместо колонок одна строка;
    - «съел часть» — вердикт посчитан по доле снапшота, заголовки называют
      это прямо («Плюсы съеденного (½)»), а не «Плюсы приёма», который читался
      бы как весь приём целиком;
    - «съел целиком» и «ещё не записан» — заголовки как раньше: съеденное
      целиком неотличимо от приёма, а не начатое — это и есть приём. */
function MealVerdictBlock({
  verdict, products, norms, entry
}: {
  verdict: MealVerdict
  products: ProductIndex
  norms: NutrientNorms
  entry: MealLogEntry | undefined
}) {
  if (entry && entry.status === 'skipped') {
    return (
      <section className="meal-verdict">
        <div className="meal-verdict__col card">
          <p className="meal-verdict__skipped">приём пропущен — плюсов и минусов нет</p>
        </div>
      </section>
    )
  }

  const { pros, cons } = verdict
  if (pros.length === 0 && cons.length === 0) return null

  const partialSuffix = entry && entry.status === 'partial' ? ` (${fractionLabel(entry.fraction)})` : ''
  const prosTitle = partialSuffix ? `Плюсы съеденного${partialSuffix}` : 'Плюсы приёма'
  const consTitle = partialSuffix ? `Минусы съеденного${partialSuffix}` : 'Минусы приёма'

  return (
    <section className="meal-verdict">
      {pros.length > 0 && (
        <div className="meal-verdict__col card">
          <h2 className="meal-verdict__title meal-verdict__title--pro">
            <span className="meal-verdict__dot" aria-hidden="true" />
            {prosTitle}
          </h2>
          <ul className="meal-verdict__list">
            {pros.map((p, i) => (
              <li key={i} className="meal-verdict__item">{plusLabel(p, products, norms)}</li>
            ))}
          </ul>
        </div>
      )}
      {cons.length > 0 && (
        <div className="meal-verdict__col card">
          <h2 className="meal-verdict__title meal-verdict__title--con">
            <span className="meal-verdict__dot" aria-hidden="true" />
            {consTitle}
          </h2>
          <ul className="meal-verdict__list">
            {cons.map((c, i) => (
              <li key={i} className="meal-verdict__item">{minusLabel(c, products)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export default function MealScreen({
  date, slot, currentSlot, onSelectSlot,
  meal, mealKbju, mealNutrients, dayNutrients, norms, products, preferences, verdict,
  entry, productsRevision, rating, onRate, onClearRating, daySlots, extras,
  onLog, onUnlog, onOpenExport
}: MealScreenProps) {
  const [pickingFraction, setPickingFraction] = useState(false)

  const containerItems = meal ? meal.items.filter(i => i.where === 'container') : []
  const packetItems = meal ? meal.items.filter(i => i.where === 'packet') : []
  const isCurrentSlot = slot === currentSlot

  function handlePartial(fraction: number): void {
    setPickingFraction(false)
    onLog(slot, 'partial', fraction)
  }

  /* Справочник продуктов правится (смена fdcId, новые нутриенты), а снапшот
     записи — нет: числа записи и живого меню посчитаны по разным справочникам,
     и это стоит сказать рядом с числами записи, а не молчать под видом
     одинаковых цифр. Совпадает ревизия - строки нет вовсе. Место строки:
     внутри карточки КБЖУ, рядом с числами, которые она объясняет; но карточки
     КБЖУ может не быть (нечего показать), а запись при этом есть — тогда
     строка стоит сама по себе, а не исчезает вместе с карточкой. */
  const revisionNote = entry && entry.productsRevision !== productsRevision
    ? (
      <p className="meal-revision-note">
        {entry.productsRevision === undefined
          ? 'Запись сделана до того, как приложение стало помечать ревизию справочника; '
            + 'по каким числам она посчитана — неизвестно.'
          : `Запись от ${formatDateFull(date)} посчитана по справочнику от `
            + `${formatDateFull(entry.productsRevision)}; сейчас справочник от `
            + `${formatDateFull(productsRevision)}. Записанное не пересчитывается.`}
      </p>
    )
    : null

  return (
    <>
      <div className="meal-title">
        <div className="meal-title__meta">
          <span className="meal-title__slot">{SLOT_TITLE[slot]}</span>
          <span className="meal-title__sep" aria-hidden="true">·</span>
          <span className="meal-title__time nums">{SLOT_TIME_RANGE[slot]}</span>
          {isCurrentSlot && (
            <>
              <span className="meal-title__sep" aria-hidden="true">·</span>
              <span className="chip meal-title__now">сейчас</span>
            </>
          )}
        </div>
        <h1 className="meal-title__name">{meal ? meal.title : (entry ? entry.title : SLOT_TITLE[slot])}</h1>
        {(!isCurrentSlot || (!meal && entry)) && (
          <div className="meal-title__notes">
            {/* Ручной выбор виден и отпускается вручную; сам он отпускается,
                когда по времени наступает следующий приём (см. App.tsx). */}
            {!isCurrentSlot && (
              <button type="button" className="meal-title__back" onClick={() => onSelectSlot(currentSlot)}>
                вернуться к текущему
              </button>
            )}
            {/* Меню на приём пропало (правка меню, перенос блюда), а запись в
                дневнике осталась — заголовок правдив, но не из меню, и это
                стоит сказать явно. */}
            {!meal && entry && <span className="meal-title__source">из записи в дневнике</span>}
          </div>
        )}
      </div>

      {!meal && (
        <div className="meal-missing">Меню на этот приём не найдено</div>
      )}

      {meal && (
        <>
          <MealItemsSection
            title="Уже в контейнере"
            items={containerItems}
            emptyText="Пусто"
            products={products}
            preferences={preferences}
          />

          <MealItemsSection
            title="Досыпать из пакетика"
            items={packetItems}
            emptyText="Ничего досыпать не нужно"
            products={products}
            preferences={preferences}
          />

          {meal.steps.length > 0 && (
            <section className="meal-section">
              <h2 className="meal-section__title">Сборка</h2>
              <div className="card">
                <ol className="meal-steps">
                  {meal.steps.map((step, i) => (
                    <li key={i} className="meal-steps__item">
                      <span className="meal-steps__num nums" aria-hidden="true">{i + 1}</span>
                      <span className="meal-steps__text">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          )}
        </>
      )}

      <MealVerdictBlock verdict={verdict} products={products} norms={norms} entry={entry} />

      {/* Ни меню, ни записи на этот приём нет — карточке взяться неоткуда,
          рисовать нули под видом чисел нельзя (см. DESIGN.md, «Честность»).
          Кольца здесь нет намеренно: доля одного приёма от суточной нормы
          была бы враньём, а кольцо без знаменателя - украшением. */}
      {mealKbju && (
        <div className="meal-kbju card">
          <div className="meal-kbju__kcal">
            <span className="meal-kbju__kcal-value nums">{round(mealKbju.kcal)}</span>
            <span className="meal-kbju__kcal-unit">ккал</span>
          </div>
          <div className="meal-kbju__macros">
            <MacroBar label="Белок" eatenG={mealKbju.p} targetG={0} color="--macro-protein" caption="" />
            <MacroBar label="Жиры" eatenG={mealKbju.f} targetG={0} color="--macro-fat" caption="" />
            <MacroBar label="Углеводы" eatenG={mealKbju.c} targetG={0} color="--macro-carbs" caption="" />
          </div>
          {revisionNote}
        </div>
      )}

      {/* Карточки КБЖУ нет, а запись есть: оговорка о ревизии всё равно
          обязана быть на экране. */}
      {!mealKbju && revisionNote}

      <NutrientsBlock
        dayTotals={dayNutrients}
        mealTotals={mealNutrients}
        norms={norms}
        hasMeal={meal !== undefined}
        hasEntry={entry !== undefined}
        daySlots={daySlots}
        productsRevision={productsRevision}
        extras={extras}
      />

      {(meal || entry) && (
        <div className="meal-actions">
          {entry
            ? (
              <div className="meal-actions__recorded">
                <span className="meal-actions__recorded-label">
                  <CheckIcon />
                  {STATUS_LABEL[entry.status]}{entry.status === 'partial' ? ` (${FRACTIONS.find(f => f.value === entry.fraction)?.label ?? entry.fraction})` : ''}
                </span>
                <div className="meal-actions__main">
                  <button type="button" className="btn btn--ghost" onClick={() => onUnlog(slot)}>Отменить запись</button>
                  <button type="button" className="btn btn--secondary" onClick={onOpenExport}>Выгрузить</button>
                </div>
              </div>
            )
            : (
              <>
                {/* Одно главное действие крупной кнопкой во всю ширину, два
                    редких тише и рядом: палец идёт к «Съел» не глядя. */}
                {!pickingFraction && meal && (
                  <div className="meal-actions__stack">
                    <button type="button" className="btn btn--primary meal-actions__eat" onClick={() => onLog(slot, 'eaten', 1)}>Съел</button>
                    <div className="meal-actions__row">
                      <button type="button" className="btn btn--ghost" onClick={() => setPickingFraction(true)}>Съел часть</button>
                      <button type="button" className="btn btn--ghost" onClick={() => onLog(slot, 'skipped', 0)}>Пропустил</button>
                    </div>
                  </div>
                )}
                {pickingFraction && (
                  <div className="meal-actions__fractions">
                    {FRACTIONS.map(f => (
                      <button key={f.value} type="button" className="chip chip--tap nums" onClick={() => handlePartial(f.value)}>
                        {f.label}
                      </button>
                    ))}
                    <button type="button" className="chip chip--tap meal-actions__cancel" onClick={() => setPickingFraction(false)}>Отмена</button>
                  </div>
                )}
              </>
            )}
        </div>
      )}

      {/* Оценка по горячим следам: только когда приём записан и у блюда есть
          устойчивый id — запись без него нельзя привязать к блюду. */}
      {entry && meal && meal.id !== '' && (
        <section className="meal-rating card">
          <h2 className="meal-rating__title">Как было?</h2>
          <RatingEditor rating={rating} onChange={onRate} onClear={onClearRating} />
        </section>
      )}
    </>
  )
}
