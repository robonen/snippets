// Корпус моделей для списков, словарей, частей и индекса.
//
// Отдельно от `blog.ts` намеренно. `blog.ts` — сквозной пример docs/05 §2, и
// половина его полей (`text`, `link`, `links`, `part`) собирается другими руками
// и в другое время; рантайм-тесты обязаны работать на том, что собрано, а не
// притворяться. Здесь ровно четыре вида, за которые отвечает этот слой, плюс
// атом внутри вложенного документа — чтобы было что записать в часть.

import { atom, dict, index, list, model, parts, t } from '../index'

/** Что лежит внутри части и внутри листа индекса. */
export const Card = model('shelf-card', {
  title: atom(t.string),
  rank: atom(t.int),
})

export const Shelf = model('shelf', {
  title: atom(t.string),
  /** Список строк — основной предмет реконсиляции. */
  tags: list(t.string),
  /** Список чисел: другой примитив под тем же алгоритмом. */
  sizes: list(t.int),
  /** Список с линзой, которая умеет отказать на записи. */
  mails: list(t.pattern(/.+@.+/, 'email')),
  /** Словарь скаляров: `x(key)` читает, `x(key, next)` пишет. */
  counts: dict(t.string, t.int),
  /** Числовые ключи: `Key` — это `string | number`, и оба обязаны доехать. */
  labels: dict(t.number, t.string),
  /** Вложенные документы по ключу. */
  cards: parts(t.string, 'shelf-card'),
  /** Трёхуровневый индекс — бывший empire. */
  archive: index(3, 'shelf-card'),
  /** Одноуровневый: путь из одного ключа тоже кортеж, а не голый ключ. */
  flat: index(1, 'shelf-card'),
})

declare module '../registry' {
  interface Models {
    shelf: typeof Shelf
    'shelf-card': typeof Card
  }
}
