/* Единственное место, где данные попадают в браузер.
   Меню, справочник и суточные нормы вкомпилированы в бандл: приложению не нужна
   сеть, оно открывается за столом без интернета. Правка меню — это коммит и
   автодеплой; проверка check-menu в CI не пустит сломанное меню до телефона. */

import menuText from '../../data/menu.yaml?raw'
import normsText from '../../data/norms.yaml?raw'
import productsText from '../../data/products.yaml?raw'
import { parseMenu, parseNorms, parseProducts, parseProductsRevision } from '../core/data.ts'
import type { Menu, NutrientNorms, ProductIndex } from '../core/types.ts'

interface LoadedData {
  products: ProductIndex
  menu: Menu
  norms: NutrientNorms
  /** Ревизия справочника (data/products.yaml, поле revision), по которой
      посчитаны текущие products. Используется при записи снапшота приёма в
      дневник (MealLogEntry.productsRevision) — правку самой записи дневника
      и показ ревизии на экране делает следующий этап, здесь только источник. */
  productsRevision: string
}

let cached: LoadedData | null = null

export function loadData(): LoadedData {
  if (!cached) {
    const products = parseProducts(productsText)
    cached = {
      products,
      menu: parseMenu(menuText, products),
      norms: parseNorms(normsText),
      productsRevision: parseProductsRevision(productsText)
    }
  }
  return cached
}
