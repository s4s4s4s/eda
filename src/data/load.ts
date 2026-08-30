/* Единственное место, где данные попадают в браузер.
   Меню и справочник вкомпилированы в бандл: приложению не нужна сеть, оно
   открывается за столом без интернета. Правка меню — это коммит и автодеплой;
   проверка check-menu в CI не пустит сломанное меню до телефона. */

import menuText from '../../data/menu.yaml?raw'
import productsText from '../../data/products.yaml?raw'
import { parseMenu, parseProducts } from '../core/data.ts'
import type { Menu, ProductIndex } from '../core/types.ts'

let cached: { products: ProductIndex; menu: Menu } | null = null

export function loadData(): { products: ProductIndex; menu: Menu } {
  if (!cached) {
    const products = parseProducts(productsText)
    cached = { products, menu: parseMenu(menuText, products) }
  }
  return cached
}
