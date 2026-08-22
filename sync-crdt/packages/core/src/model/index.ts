/**
 * Слой моделей: схема — источник истины ([docs/05](../../../../docs/05-model-api.md)).
 *
 * Объявление модели — это ДАННЫЕ, документ — замороженный объект каналов, поле
 * читается и пишется той же конвенцией, что `ref`/`computed` в ядре. Ни классов,
 * которые пишет прикладник, ни `this`, ни патчинга прототипов.
 *
 * @example
 * ```ts
 * export const Post = model('post', {
 *   title: atom(t.string),
 *   status: atom(t.enum(['draft', 'live']).or('draft')),
 * })
 *
 * declare module '@sync/core' {
 *   interface Models {post: typeof Post}
 * }
 *
 * const space = createSpace({land})
 * const post = space.doc(Post, id)
 * post.title()                 // string
 * post.title('Файберы и CRDT') // запись; вернётся победитель LWW
 * ```
 *
 * ЧТО СОБРАНО: значения (`Cast`/`Type`/`t`), реестр и модель, документ и `$`,
 * пространство, привязка и кэш поля, атом. Списки, словари, текст, ссылки,
 * `cast` и индекс собираются поверх — ручки для них перечислены ниже.
 */

// ── Значения ─────────────────────────────────────────────────────────────────
export { t, type Cast, type Key, type Type } from './value'

// ── Реестр и модель ──────────────────────────────────────────────────────────
export { type Models, type ModelName } from './registry'
export {
  extend,
  model,
  modelOf,
  type AnyModel,
  type Derives,
  type Model,
  type ReservedFieldName,
  type Schema,
  type View,
} from './model'

// ── Поля схемы ───────────────────────────────────────────────────────────────
export {
  atom,
  dict,
  index,
  link,
  links,
  list,
  part,
  parts,
  text,
  type AtomField,
  type Born,
  type Depth,
  type DictField,
  type Field,
  type FieldKind,
  type IndexField,
  type LinkField,
  type LinksField,
  type ListField,
  type PartField,
  type PartsField,
  type TextField,
} from './field'

// ── Каналы и документ ────────────────────────────────────────────────────────
export {
  SPOT,
  type AtomChannel,
  type Caret,
  type Chan,
  type DerivedChannel,
  type DictChannel,
  type Doc,
  type DocOps,
  type Handle,
  type Head,
  type IndexChannel,
  type LinkChannel,
  type LinksChannel,
  type ListChannel,
  type PartChannel,
  type PartsChannel,
  type Peer,
  type Point,
  type Spot,
  type TextChannel,
} from './channel'

// ── Перевод вида (docs/05 §1.7) ──────────────────────────────────────────────
//
// `cast` публичен по той же причине, что и сами каналы: это ЕДИНСТВЕННЫЙ способ
// прочитать текст списком токенов, а список — атомом, и без него §1.7 остаётся
// объявлением на бумаге. Обе перегрузки уже типизированы (`Chan<F>` и `Doc<N>`),
// в барьер он не попал по недосмотру.
export { cast, type CastFrom } from './cast'

// ── Пространство и диагностика ───────────────────────────────────────────────
export { CORE, coreOf, createSpace, ROOT_HEAD, type Space, type SpaceCore, type SpaceOptions } from './space'
export { ModelError, describe, warnIssue, type Issue, type IssueKind } from './issue'

// ── Ручки для следующего слоя ────────────────────────────────────────────────
//
// Списки, словари, текст, ссылки, `cast` и индекс строятся ПОВЕРХ этого
// основания и обязаны брать состав детей, кэш поля и адреса отсюда, а не заводить
// свои: два кэша на один состав детей — это два ответа на один вопрос.
export {
  CELL,
  cellOf,
  firstOf,
  headOf,
  mountSlot,
  tagOf,
  type Binding,
  type Cell,
  type Reader,
  type Writer,
} from './cell'
export { bindingOf, cellFor, channelFor, openDoc } from './binding'
export { METHODS, READERS, WRITERS, methodsFor, readerFor, writerFor } from './kinds'
export { predictItem, predictKey } from './address'
export { ATOM_METHODS, readAtom, writeAtom } from './atom'
