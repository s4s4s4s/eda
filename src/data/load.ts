/* Единственное место, где данные попадают в браузер.
   Меню, справочник и суточные нормы вкомпилированы в бандл: приложению не нужна
   сеть, оно открывается за столом без интернета. Правка меню — это коммит и
   автодеплой; проверка check-menu в CI не пустит сломанное меню до телефона. */

import menuText from '../../data/menu.yaml?raw'
import normsText from '../../data/norms.yaml?raw'
import productsText from '../../data/products.yaml?raw'
import { parseMenu, parseNorms, parseProducts } from '../core/data.ts'
import type { Menu, NutrientNorms, ProductIndex } from '../core/types.ts'

let cached: { products: ProductIndex; menu: Menu; norms: NutrientNorms } | null = null

export function loadData(): { products: ProductIndex; menu: Menu; norms: NutrientNorms } {
  if (!cached) {
    const products = parseProducts(productsText)
    cached = { products, menu: parseMenu(menuText, products), norms: parseNorms(normsText) }
  }
  return cached
}
