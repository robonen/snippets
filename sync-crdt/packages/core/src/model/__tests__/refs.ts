// Корпус моделей для ссылок, частей и `cast`.
//
// Отдельно от `blog.ts` намеренно: там сквозной пример из docs/05 §2, и он же
// корпус тестов ТИПОВ. Здесь — модели под рантайм ссылок, и у них другая нагрузка:
// взаимная рекурсия «автор ↔ заметки», вложенная часть, три вида рождения
// (`here`/`area`/`{land}`) и заведомо недостижимый ленд для проверки отказа.

import { Link } from '../../binary/link'
import { atom, dict, link, links, list, model, part, t, text } from '../index'

function landOf(byte: number): Link {
  const peer = new Uint8Array(8)
  peer[0] = byte
  const area = new Uint8Array(8)
  area[0] = 0x0a
  return Link.land(Link.peer(peer), area)
}

/** Ленд, который стенд открывать умеет. */
export const GUEST_LAND: Link = landOf(0x71)
/** Ленд, которого у стенда нет: `of()` откажет, и отказ обязан быть громким. */
export const LOST_LAND: Link = landOf(0x72)

export const Author = model('ref-author', {
  name: atom(t.string),
  /** Обратная сторона рекурсии: заметки ссылаются на автора, автор — на заметки. */
  notes: links('ref-note'),
})

export const Meter = model('ref-meter', {
  views: atom(t.int),
  likes: atom(t.int),
})

/** Другая схема на ТУ ЖЕ голову — «схема это линза», проверяется `cast`. */
export const Gauge = model('ref-gauge', {
  views: atom(t.string),
  extra: atom(t.string),
})

export const Note = model('ref-note', {
  title: atom(t.string),
  body: text(),
  tags: list(t.string),
  marks: dict(t.string, t.string),
  /** Автор живёт своей жизнью — отдельная сущность, возможно в другом ленде. */
  author: link('ref-author'),
  editors: links('ref-author'),
  /** Счётчики живут внутри заметки и умирают вместе с ней. */
  stats: part('ref-meter'),
})

/** Три гранулярности рождения в одной схеме — docs/05 §5. */
export const Vault = model('ref-vault', {
  here: link('ref-author'),
  area: link('ref-author', 'area'),
  guest: link('ref-author', { land: GUEST_LAND }),
  lost: link('ref-author', { land: LOST_LAND }),
})

declare module '../registry' {
  interface Models {
    'ref-author': typeof Author
    'ref-meter': typeof Meter
    'ref-gauge': typeof Gauge
    'ref-note': typeof Note
    'ref-vault': typeof Vault
  }
}
