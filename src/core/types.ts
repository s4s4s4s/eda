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
  'linoleic', 'ala', 'epa', 'dha',
  'calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'sodium',
  'zinc', 'copper', 'manganese', 'selenium',
  'vitA', 'retinol', 'vitC', 'vitD', 'vitE', 'vitK',
  'thiamin', 'riboflavin', 'niacin', 'vitB6', 'folate', 'vitB12', 'pantothenic',
  'choline',
  'betaCarotene', 'alphaCarotene', 'betaCryptoxanthin', 'lycopene', 'luteinZeaxanthin',
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
  linoleic: 'г',
  ala: 'г',
  epa: 'г',
  dha: 'г',
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
  retinol: 'мкг',
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
  choline: 'мг',
  betaCarotene: 'мкг',
  alphaCarotene: 'мкг',
  betaCryptoxanthin: 'мкг',
  lycopene: 'мкг',
  luteinZeaxanthin: 'мкг',
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
  linoleic: 'Линолевая кислота (омега-6)',
  ala: 'Альфа-линоленовая кислота (омега-3)',
  epa: 'ЭПК (омега-3)',
  dha: 'ДГК (омега-3)',
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
  retinol: 'Ретинол (готовый витамин A)',
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
  choline: 'Холин',
  betaCarotene: 'Бета-каротин',
  alphaCarotene: 'Альфа-каротин',
  betaCryptoxanthin: 'Бета-криптоксантин',
  lycopene: 'Ликопин',
  luteinZeaxanthin: 'Лютеин и зеаксантин',
  water: 'Вода'
}

/** Раздел, в который нутриент попадает при показе. Группировка смысловая, а не
    оформительская: витамины и минералы человек читает разными списками.

    Жиры собраны в один раздел целиком: разводить «полиненасыщенные жиры» и
    линолевую кислоту по разным спискам бессмысленно — вторая является частью
    первых. Холестерин формально не жирная кислота, но читается вместе с ними,
    поэтому раздел называется «жиры», а не «жирные кислоты». */
export type NutrientGroup = 'витамины' | 'минералы' | 'жиры' | 'каротиноиды' | 'прочее'

/** Порядок разделов на экране. Живёт рядом с самой группировкой, а не копиями в
    каждом экране: копии молча теряют новый раздел, и нутриент исчезает из
    показа, не оставив следа. */
export const NUTRIENT_GROUP_ORDER: readonly NutrientGroup[] = [
  'витамины',
  'минералы',
  'жиры',
  'каротиноиды',
  'прочее'
]

export const NUTRIENT_GROUP: Record<NutrientKey, NutrientGroup> = {
  fiber: 'прочее',
  sugar: 'прочее',
  satFat: 'жиры',
  monoFat: 'жиры',
  polyFat: 'жиры',
  cholesterol: 'жиры',
  linoleic: 'жиры',
  ala: 'жиры',
  epa: 'жиры',
  dha: 'жиры',
  calcium: 'минералы',
  iron: 'минералы',
  magnesium: 'минералы',
  phosphorus: 'минералы',
  potassium: 'минералы',
  sodium: 'минералы',
  zinc: 'минералы',
  copper: 'минералы',
  manganese: 'минералы',
  selenium: 'минералы',
  vitA: 'витамины',
  retinol: 'витамины',
  vitC: 'витамины',
  vitD: 'витамины',
  vitE: 'витамины',
  vitK: 'витамины',
  thiamin: 'витамины',
  riboflavin: 'витамины',
  niacin: 'витамины',
  vitB6: 'витамины',
  folate: 'витамины',
  vitB12: 'витамины',
  pantothenic: 'витамины',
  choline: 'прочее',
  betaCarotene: 'каротиноиды',
  alphaCarotene: 'каротиноиды',
  betaCryptoxanthin: 'каротиноиды',
  lycopene: 'каротиноиды',
  luteinZeaxanthin: 'каротиноиды',
  water: 'прочее'
}

/* ---- суточные нормы ----

   Числа живут в data/norms.yaml (DRI, мужчины 19–30), в коде их нет. Единица
   нормы — та же, что в NUTRIENT_UNIT: в данных она не дублируется. */

/** Основание нормы: rda — рекомендуемая суточная норма, ai — адекватное
    потребление (задаётся там, где данных на RDA не хватило). */
export type NormBasis = 'rda' | 'ai'

export interface NutrientNorm {
  /** Суточная норма в единице из NUTRIENT_UNIT. */
  amount: number
  basis: NormBasis
  /** Верхний безопасный предел, если источник его задаёт. */
  ul?: number
  /** Уровень снижения риска хронических болезней (в DRI задан только натрию). */
  cdrr?: number
  /** false — сравнивать сумму приложения с этим числом нельзя (считается разное),
      процент по строке не показывается. */
  comparable: boolean
  /** Оговорка к строке: что именно норма означает и чего не покрывает. */
  note?: string
}

/** Карта норм ЧАСТИЧНАЯ НАМЕРЕННО: отсутствие ключа означает «нормы нет», а не
    «норма ноль». Часть ключей нормы не имеет вовсе — см. шапку data/norms.yaml. */
export type NutrientNorms = Partial<Record<NutrientKey, NutrientNorm>>

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
  /** Сколько позиций всего вошло в сумму. Запись дневника, у которой снапшота
      по этому нутриенту нет вовсе (сделана до появления ключа или повреждена),
      входит в сумму ОДНОЙ неизвестной позицией: known 0, total 1. Иначе она
      выпадала бы из отношения known/total, и день без целого приёма выглядел
      бы полным — см. sanitizeNutrients в src/state/storage.ts. */
  total: number
}

/** Сумма по приёму или дню: все ключи NUTRIENT_KEYS присутствуют всегда —
    отсутствие данных выражается через known === 0, а не через отсутствие ключа. */
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
  /** Устойчивый идентификатор блюда, латиница-слаг. Оценки и предпочтения
      держатся за него, а не за название и не за место в цикле: блюдо можно
      переименовать и переставить в другой день, не потеряв оценку. */
  id: string
  title: string
  /** Короткие шаги сборки: разогреть, досыпать пакетик, полить маслом, сладкое отдельно. */
  steps: string[]
  items: Item[]
}

export interface MenuDay {
  day: number
  meals: Meal[]
}

/** Одна присланная диетологом порция меню. Редакции не переписывают друг друга:
    прежняя остаётся в файле, потому что по ней человек ел и заглянуть в
    прошедший день должно быть можно. Редакция вправе описывать не все дни
    цикла — недостающие берутся из предыдущей. */
export interface MenuEdition {
  /** Дата вступления в силу (YYYY-MM-DD). undefined — базовая редакция: когда
      она вступила в силу, никто не записал, а выдуманная дата была бы враньём.
      Такая редакция допустима только одна и только первой. */
  from?: string
  /** Человеческое имя редакции — его видно на экране: «неделя от 4 сентября». */
  title: string
  /** Дни цикла, которые описывает эта редакция; отсортированы по номеру. */
  days: MenuDay[]
}

export interface Menu {
  cycleDays: number
  /** Отсортированы по дате вступления в силу, базовая (без from) — первой. */
  editions: MenuEdition[]
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
  /** Идентификатор съеденного блюда — снапшот, как и КБЖУ. Пустая строка
      означает запись, сделанную до появления идентификаторов: такую нельзя
      привязать к блюду, и предлагать оценить её приложение не имеет права. */
  mealId: string
  status: MealStatus
  /** Доля съеденного: 1, 0.75, 0.5, 0.25 либо 0 для пропущенного. */
  fraction: number
  kbju: Kbju
  /** СНАПШОТ нутриентов полного приёма — по той же причине, что и kbju:
      правка меню не должна переписывать уже записанные дни. */
  nutrients: NutrientTotals
  title: string
  loggedAt: string
  /** Ревизия справочника продуктов (поле revision в data/products.yaml,
      YYYY-MM-DD), по которой посчитаны kbju и nutrients. Снапшот честен только
      вместе с ней: справочник правится (смена fdcId, новые нутриенты), и без
      отметки два соседних дня молча считаются по разным числам. Отсутствует у
      записей, сделанных до появления поля. */
  productsRevision?: string
}

/* ---- добавленная еда ----

   Съеденное сверх меню: перенесённое блюдо другого дня цикла («вчерашний обед
   на ужин») либо своя еда, разобранная по USDA на домашнем компьютере.

   Добавленная запись НЕ трогает статус приёма: meals[slot] отвечает на вопрос
   «съеден ли приём по меню», и еда сверх него этого ответа не меняет. Поэтому
   extras живут отдельным списком, а не внутри meals: подмешай мы их туда,
   «перекус» стал бы съеденным оттого, что человек добавил к обеду десерт. */

/** Общее у обоих видов добавленной записи. kbju/nutrients — СНАПШОТ ПОЛНОЙ
    порции, как у MealLogEntry: долю применяет потребитель (eatenExtraKbju). */
interface ExtraLogEntryBase {
  /** Устойчивый идентификатор самой записи: по нему её убирают из дня.
      Слота тут мало — добавленных записей в одном слоте может быть несколько. */
  id: string
  /** К какому приёму человек это отнёс. На статус приёма не влияет. */
  slot: Slot
  /** Доля съеденного, строго в (0, 1]. Нуля здесь нет и быть не может:
      «добавил и не съел» — это отсутствие записи, а не запись с нулём
      (в отличие от приёма меню, где пропуск — самостоятельный статус). */
  fraction: number
  title: string
  kbju: Kbju
  nutrients: NutrientTotals
  loggedAt: string
}

/** Добавленная еда. Два вида различает поле kind:
    - 'menu' — блюдо из меню, перенесённое из другого дня цикла;
    - 'custom' — своя еда из книги customFoods. */
export type ExtraLogEntry =
  | (ExtraLogEntryBase & {
      kind: 'menu'
      /** Meal.id перенесённого блюда — снапшот, как и КБЖУ. */
      mealId: string
      /** Откуда блюдо взято: день цикла и приём. Нужно для подписи «день 5, обед». */
      fromCycleDay: number
      fromSlot: Slot
      /** Ревизия справочника на момент записи — по той же причине, что у
          MealLogEntry.productsRevision. Отсутствует, если вызывающий её не знал. */
      productsRevision?: string
    })
  | (ExtraLogEntryBase & {
      kind: 'custom'
      /** Ключ в AppState.customFoods. Запись остаётся честной и после удаления
          еды из книги: снапшот самодостаточен, ссылка нужна только для подписи. */
      customFoodId: string
      /** Источник чисел, дословно из разбора: «USDA SR Legacy 2018-04». */
      source: string
    })

export interface DayLog {
  /** День цикла на дату — тоже снапшот: сдвиг цикла не переписывает прошлое.
      null — снапшот в хранилище повреждён и не восстановлен; записи приёмов
      при этом сохраняются, номер дня — косметика, а не данные о еде. */
  cycleDay: number | null
  meals: Partial<Record<Slot, MealLogEntry>>
  /** Съеденное сверх меню. Поле обязательное и всегда есть: день, дошедший до
      ядра, прошёл либо logMeal/addExtra, либо санитизацию хранилища, и обе
      достраивают пустой список. Необязательным его делать нельзя — иначе
      каждая сумма дня обязана была бы помнить про `?? []`, и один забытый
      случай молча терял бы добавленную еду. */
  extras: ExtraLogEntry[]
}

export interface Settings {
  /** Дата первого дня цикла, локальная, YYYY-MM-DD. */
  cycleStartDate: string
  /** Ручная поправка «сдвинуть цикл на день», в днях. */
  cycleShift: number
  targetKcal: number
  /** Цель по белку, г/сут. Это личная цель под набор массы, а не норма DRI:
      RDA для мужчины 19–30 — 56 г, и она про «не заболеть», а не про «набрать». */
  targetProteinG: number
  /** Имя команды Apple Shortcuts. Пусто — канал Health не настроен. */
  shortcutName: string
  /** Человек подтвердил, что дата первого дня цикла верна (или сам её
      поправил). Пока false, главный экран держит баннер «сегодня — день 1» —
      cycleStartDate по умолчанию равна дню установки, и это не всегда так. */
  cycleStartConfirmed: boolean
  /** Токен приложения для воркера «Штурмана» — им заказывается разбор своей
      еды на домашнем компьютере. Вводится человеком в настройках и живёт
      только в localStorage этого браузера: в репозитории токена нет и быть не
      может. Пустая строка — разбор своей еды не настроен, и шторка честно
      говорит об этом вместо того, чтобы делать вид, что отправила запрос. */
  shturmanToken: string
}

/* ---- своя еда ----

   Числа считает не модель, а расчёт по USDA SR Legacy (scripts/resolve-food.mjs):
   модель только подбирает строки датасета и граммы. Поэтому в состоянии лежат
   не «калории тирамису», а компоненты с их per100 — по ним приложение
   пересчитывает граммы само, той же арифметикой, что считает позиции меню
   (addPer100ToTotals в nutrition.ts). Смена состава требует нового разбора. */

export interface FoodComponent {
  /** Идентификатор записи USDA FoodData Central — по нему число проверяется. */
  fdcId: number
  /** Дословное описание записи USDA. */
  description: string
  /** Категория USDA — «Sweets», «Dairy and Egg Products», ... */
  category: string
  grams: number
  /** Чем эта запись обоснована: «готовый десерт, mascarpone-based». */
  note?: string
  /** Числа на 100 г. micro частичный НАМЕРЕННО — отсутствие ключа означает
      «строки нутриента нет в датасете», а не ноль (см. Nutrients). */
  per100: { kbju: Kbju; micro: Nutrients }
}

/** Разобранная своя еда, сохранённая в книгу. Самодостаточна: даже если
    компонент в USDA когда-нибудь переопределят, записанное останется тем,
    по чему человек ел. */
export interface CustomFood {
  id: string
  title: string
  /** Источник чисел, дословно: «USDA SR Legacy 2018-04». */
  source: string
  /** Версия формата разбора — на случай, если форма результата изменится. */
  spec: number
  /** Наряд воркера, которым эта еда разобрана: адрес происхождения чисел. */
  jobId: string
  /** О чём человек спрашивал. Хранится дословно: по «тирамису 120 г» видно,
      что именно разбиралось, а по одному названию из ответа — уже нет. */
  request: { text: string; grams: number | null }
  components: FoodComponent[]
  createdAt: string
}

/** Результат разбора, каким его отдаёт воркер при успехе (зеркало FoodResult
    с ok: true). Форма проверяется целиком при разборе ответа — в состояние
    попадает только то, что прошло проверку. */
export interface FoodResultOk {
  ok: true
  spec: number
  source: string
  title: string
  request: { text: string; grams: number | null }
  components: FoodComponent[]
  kbju: Kbju
  /** Все ключи NUTRIENT_KEYS: полнота выражена через known/total, а не
      отсутствием ключа. */
  nutrients: NutrientTotals
}

/** Состояние заказа разбора. 'pending' — наряд в очереди (компьютер может быть
    выключен, наряд живёт сутки); 'failed' — разбор не удался и причина известна;
    'expired' — компьютер не взял наряд за сутки. */
export type FoodRequestStatus = 'pending' | 'done' | 'failed' | 'expired'

/** Заказ на разбор своей еды. Живёт в состоянии, а не в памяти вкладки:
    ответа ждут минуты и часы, и перезапуск приложения не должен его терять. */
export interface FoodRequest {
  /** UUID, сгенерированный приложением; в очереди воркера — «food:<uuid>». */
  id: string
  text: string
  grams: number | null
  askedAt: string
  /** Куда человек собирался это записать. Хранится с запросом, потому что
      ответ приходит через часы, и «сегодня» к тому моменту уже другое. */
  target: { date: string; slot: Slot }
  status: FoodRequestStatus
  result?: FoodResultOk
  /** Человеческая причина отказа при status === 'failed'. */
  error?: string
  /** Сколько секунд назад домашний компьютер выходил на связь. null — не
      выходил ни разу; это не «давно», а «неизвестно», и текст на экране разный. */
  pcAgo: number | null
  lastPolledAt?: string
}

/* ---- книга предпочтений ---- */

/** Отношение к ингредиенту. Нейтральное — это ОТСУТСТВИЕ записи, а не третье
    значение: держать в хранилище полсотни строк «всё равно» значит хранить
    молчание как мнение. */
export type IngredientStance = 'love' | 'avoid'

/** Оценка блюда. Балл и комментарий — одно целое: балл говорит «сколько»,
    комментарий — «что именно», и без второго первый через месяц не читается. */
export interface DishRating {
  /** Целое 1..10. Нуля нет: «не оценено» — это отсутствие записи. */
  score: number
  /** Свободный текст. Пустая строка допустима — оценка без слов тоже оценка. */
  comment: string
  /** ISO-время последней правки. */
  ratedAt: string
}

export interface Preferences {
  /** Ключ — идентификатор продукта из data/products.yaml. */
  ingredients: Partial<Record<string, IngredientStance>>
  /** Ключ — Meal.id. */
  dishes: Partial<Record<string, DishRating>>
}

export interface AppState {
  version: number
  settings: Settings
  /** Ключ — локальная дата YYYY-MM-DD. */
  log: Record<string, DayLog>
  preferences: Preferences
  /** Книга своей еды. Ключ — CustomFood.id. Записи дневника на неё только
      ссылаются: удаление еды из книги не переписывает уже съеденное. */
  customFoods: Record<string, CustomFood>
  /** Очередь заказов на разбор. Список, а не карта: порядок — это порядок
      обращений человека, и на экране он читается сверху вниз. */
  foodRequests: FoodRequest[]
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
