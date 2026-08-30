/* Доменные типы. Этот файл — контракт между ядром, экранами и экспортом:
   его правит только владелец задачи «ядро», остальные от него зависят. */

/** Приём пищи. Порядок значений в SLOTS — это порядок дня, на него опирается UI. */
export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export const SLOTS: readonly Slot[] = ['breakfast', 'lunch', 'dinner', 'snack'] as const

export const SLOT_TITLE: Record<Slot, string> = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус'
}

/** Основные приёмы — те, к которым применим порог «не легче 800 ккал». */
export const MAIN_SLOTS: readonly Slot[] = ['breakfast', 'lunch', 'dinner'] as const

/** Где лежит позиция к моменту еды. Два списка на экране — это оно. */
export type Where = 'container' | 'packet'

/** Калории, белки, жиры, углеводы. Всегда без округления; округляет только UI. */
export interface Kbju {
  kcal: number
  p: number
  f: number
  c: number
}

/* ---- микронутриенты ----

   Список ключей закрыт и совпадает один в один с блоком micro100g в
   data/products.yaml: справочник собирается скриптом scripts/build-products.mjs,
   и любой ключ вне этого списка означает рассинхрон кода со скриптом, а не
   новые данные. Поэтому парсер такой ключ не пропускает (см. parseProducts). */

export const NUTRIENT_KEYS = [
  'fiber', 'sugar', 'satFat', 'monoFat', 'polyFat', 'cholesterol',
  'calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'sodium',
  'zinc', 'copper', 'manganese', 'selenium',
  'vitA', 'vitC', 'vitD', 'vitE', 'vitK',
  'thiamin', 'riboflavin', 'niacin', 'vitB6', 'folate', 'vitB12', 'pantothenic',
  'water'
] as const

export type NutrientKey = (typeof NUTRIENT_KEYS)[number]

/** Нутриенты продукта или позиции. КАРТА ЧАСТИЧНАЯ НАМЕРЕННО: отсутствие ключа
    означает «в USDA SR Legacy нет строки для этого нутриента у этого продукта».
    Это не ноль. Ноль стоит только там, где ноль реально записан в датасете. */
export type Nutrients = Partial<Record<NutrientKey, number>>

/** Единицы измерения — из шапки data/products.yaml (nutrient.csv, unit_name):
    G -> г, MG -> мг, UG -> мкг. */
export type NutrientUnit = 'г' | 'мг' | 'мкг'

export const NUTRIENT_UNIT: Record<NutrientKey, NutrientUnit> = {
  fiber: 'г',
  sugar: 'г',
  satFat: 'г',
  monoFat: 'г',
  polyFat: 'г',
  cholesterol: 'мг',
  calcium: 'мг',
  iron: 'мг',
  magnesium: 'мг',
  phosphorus: 'мг',
  potassium: 'мг',
  sodium: 'мг',
  zinc: 'мг',
  copper: 'мг',
  manganese: 'мг',
  selenium: 'мкг',
  vitA: 'мкг',
  vitC: 'мг',
  vitD: 'мкг',
  vitE: 'мг',
  vitK: 'мкг',
  thiamin: 'мг',
  riboflavin: 'мг',
  niacin: 'мг',
  vitB6: 'мг',
  folate: 'мкг',
  vitB12: 'мкг',
  pantothenic: 'мг',
  water: 'г'
}

/** Названия для экрана. Ключи латиницей человеку у стола ничего не говорят. */
export const NUTRIENT_TITLE: Record<NutrientKey, string> = {
  fiber: 'Клетчатка',
  sugar: 'Сахара',
  satFat: 'Насыщенные жиры',
  monoFat: 'Мононенасыщенные жиры',
  polyFat: 'Полиненасыщенные жиры',
  cholesterol: 'Холестерин',
  calcium: 'Кальций',
  iron: 'Железо',
  magnesium: 'Магний',
  phosphorus: 'Фосфор',
  potassium: 'Калий',
  sodium: 'Натрий',
  zinc: 'Цинк',
  copper: 'Медь',
  manganese: 'Марганец',
  selenium: 'Селен',
  vitA: 'Витамин A',
  vitC: 'Витамин C',
  vitD: 'Витамин D',
  vitE: 'Витамин E',
  vitK: 'Витамин K',
  thiamin: 'Тиамин (B1)',
  riboflavin: 'Рибофлавин (B2)',
  niacin: 'Ниацин (B3)',
  vitB6: 'Витамин B6',
  folate: 'Фолаты',
  vitB12: 'Витамин B12',
  pantothenic: 'Пантотеновая кислота (B5)',
  water: 'Вода'
}

/** Сумма одного нутриента по набору позиций — ЧИСЛО ВМЕСТЕ С ЕГО ПОЛНОТОЙ.
    Голого числа тут мало: у части продуктов датасет просто не знает нутриента,
    и сумма, посчитанная по трём позициям из пяти, занижена — молча, выглядя при
    этом исправной. `known` и `total` дают потребителю право решать: показать
    «нет данных» (known === 0), пометить неполноту (known < total) или отправить
    число в Health (только при known > 0). */
export interface NutrientTotal {
  /** Сумма известных значений. При known === 0 это ноль-заглушка, НЕ результат. */
  value: number
  /** Сколько позиций знали этот нутриент. */
  known: number
  /** Сколько позиций всего вошло в сумму. */
  total: number
}

/** Сумма по приёму или дню: все 29 ключей присутствуют всегда — отсутствие
    данных выражается через known === 0, а не через отсутствие ключа. */
export type NutrientTotals = Record<NutrientKey, NutrientTotal>

export interface Product {
  id: string
  /** Человеческое имя, его видит Александр на экране. */
  name: string
  /** Идентификатор записи в USDA FoodData Central — по нему число проверяется. */
  fdcId: number
  /** Дословное описание записи USDA, чтобы подмена продукта была видна глазами. */
  fdcDescription: string
  /** Заполнено, если продукт взят как замена отсутствующему в датасете. */
  substitute?: string
  /** Метки для правил проверки: fish, chicken, turkey, beef, grain, legumes, nuts, ... */
  tags: string[]
  /** Граммы одной штуки. Обязательно для продуктов, которые меню задаёт штуками. */
  pieceG?: number
  /** Граммы одной столовой ложки. Обязательно для продуктов, задаваемых ложками. */
  tbspG?: number
  /** КБЖУ на 100 г сырого (сухого) веса. */
  per100: Kbju
  /** Микронутриенты на те же 100 г. Ключа нет — значения нет в датасете. */
  micro100: Nutrients
}

/** Позиция приёма. Количество задано РОВНО одним из трёх полей. */
export interface Item {
  product: string
  g?: number
  pieces?: number
  tbsp?: number
  where: Where
}

export interface Meal {
  slot: Slot
  title: string
  /** Короткие шаги сборки: разогреть, досыпать пакетик, полить маслом, сладкое отдельно. */
  steps: string[]
  items: Item[]
}

export interface MenuDay {
  day: number
  meals: Meal[]
}

export interface Menu {
  cycleDays: number
  days: MenuDay[]
}

export type ProductIndex = ReadonlyMap<string, Product>

/* ---- дневник ---- */

export type MealStatus = 'eaten' | 'partial' | 'skipped'

/** Запись о съеденном приёме.
    kbju — СНАПШОТ полного приёма на момент записи. Съеденное считается как
    kbju * fraction. Снапшот нужен, чтобы правка меню не переписывала задним
    числом уже записанные дни. */
export interface MealLogEntry {
  slot: Slot
  status: MealStatus
  /** Доля съеденного: 1, 0.75, 0.5, 0.25 либо 0 для пропущенного. */
  fraction: number
  kbju: Kbju
  /** СНАПШОТ нутриентов полного приёма — по той же причине, что и kbju:
      правка меню не должна переписывать уже записанные дни. */
  nutrients: NutrientTotals
  title: string
  loggedAt: string
}

export interface DayLog {
  /** День цикла на дату — тоже снапшот: сдвиг цикла не переписывает прошлое. */
  cycleDay: number
  meals: Partial<Record<Slot, MealLogEntry>>
}

export interface Settings {
  /** Дата первого дня цикла, локальная, YYYY-MM-DD. */
  cycleStartDate: string
  /** Ручная поправка «сдвинуть цикл на день», в днях. */
  cycleShift: number
  targetKcal: number
  /** Имя команды Apple Shortcuts. Пусто — канал Health не настроен. */
  shortcutName: string
}

export interface AppState {
  version: number
  settings: Settings
  /** Ключ — локальная дата YYYY-MM-DD. */
  log: Record<string, DayLog>
}

/* ---- проверка меню ---- */

export type ViolationScope =
  | { kind: 'day'; day: number }
  | { kind: 'meal'; day: number; slot: Slot }

export interface Violation {
  /** Код правила: 'portion.fish', 'day.kcal.low', 'day.flax.missing', ... */
  rule: string
  scope: ViolationScope
  /** Готовая к печати строка по-русски. */
  message: string
}
