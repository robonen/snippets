// ─── Поля схемы: данные, а не классы ─────────────────────────────────────────
//
// Поле — это ОПИСАНИЕ, обычный замороженный объект с тегом `kind`. Ни `this`, ни
// прототипов, ни классов у прикладника (ограничение 1 из docs/05).
//
// Базовый `Field` НЕ параметризован, и это несущее решение (docs/05 §3.13, п. 3):
// с параметром `AtomField<string>` перестал бы быть присваиваем `Field` из-за
// контравариантного `encode`, а `Schema` — ловить ошибку вариантности на каждом
// объявлении.
//
// Имя `link`, а не `ref`: `ref` занято ядром (`@sync/fiber`) в значении
// «записываемый источник», и второе значение на то же имя — ровно тот случай,
// который правило 3 PRINCIPLES называет непредставимым состоянием.

import type { LandId } from '../binary/pack'
import type { ModelName } from './registry'
import type { Cast, Key, Type } from './value'

/**
 * Где рождается новая сущность — прямой порт `ensure_here`/`ensure_area`/
 * `ensure_lord` (docs/05 §5).
 *
 * Место рождения объявляется В СХЕМЕ и переопределяется в вызове. Если бы выбор
 * жил только в вызове, два места кода родили бы одну и ту же сущность в разных
 * лендах — и это единственное место, где прикладной разработчик обязан подумать
 * про гранулярность синхронизации.
 */
export type Born =
  /** Текущий ленд: живёт и умирает с родителем. */
  | 'here'
  /** Новая area внутри ленда: синкается отдельно. */
  | 'area'
  /** Новый ленд со своими правами. */
  | { readonly land: LandId }

export type FieldKind =
  | 'atom' | 'list' | 'dict' | 'text'
  | 'link' | 'links' | 'part' | 'parts' | 'index'

/** Базовый супертип БЕЗ параметров — иначе `Schema` ловит ошибку вариантности. */
export interface Field {
  readonly kind: FieldKind
}

export interface AtomField<T> extends Field {
  readonly kind: 'atom'
  readonly type: Type<T>
}

export interface ListField<T> extends Field {
  readonly kind: 'list'
  readonly item: Cast<T>
}

export interface DictField<K extends Key, T> extends Field {
  readonly kind: 'dict'
  readonly key: Cast<K>
  readonly value: Type<T>
}

export interface TextField extends Field {
  readonly kind: 'text'
}

export interface LinkField<N extends ModelName> extends Field {
  readonly kind: 'link'
  readonly to: N
  readonly born: Born
}

export interface LinksField<N extends ModelName> extends Field {
  readonly kind: 'links'
  readonly to: N
  readonly born: Born
}

export interface PartField<N extends ModelName> extends Field {
  readonly kind: 'part'
  readonly of: N
}

export interface PartsField<K extends Key, N extends ModelName> extends Field {
  readonly kind: 'parts'
  readonly key: Cast<K>
  readonly of: N
}

/** Глубина вложенного индекса. Литерал, а не рекурсия по кортежу (docs/05 §7.14). */
export type Depth = 1 | 2 | 3 | 4

export interface IndexField<D extends Depth, N extends ModelName> extends Field {
  readonly kind: 'index'
  readonly depth: D
  readonly of: N
  readonly born: Born
}

/**
 * Скаляр в одном юните.
 *
 * Принимает только {@link Type} — то есть линзу, которой НАЗВАЛИ «пустое»
 * значение. `atom(t.enum([...]))` не компилируется, и это решение Р5: вопрос
 * «а что подставить вместо неизвестного члена» сделан невыразимым, а не
 * запрещённым на словах.
 *
 * @example
 * ```ts
 * atom(t.string)                              // blank ''
 * atom(t.enum(['draft', 'live']).or('draft')) // дефолт назван явно
 * ```
 */
export function atom<T>(type: Type<T>): AtomField<T> {
  // Страховка на границе типов: сюда можно попасть только через `as`, но линза
  // без `blank` превратила бы чтение непрочитанного поля в `undefined` — то
  // самое значение, которого в этом слое не существует (правило 3 горячего пути).
  if ((type as { blank?: unknown }).blank === undefined) {
    throw new TypeError(`atom(${type.name}): у линзы нет blank — нужен .or(значение) или t.maybe(...)`)
  }
  return Object.freeze({ kind: 'atom', type })
}

/** Список с настоящим слиянием по элементам. Элементу `blank` не нужен. */
export function list<T>(item: Cast<T>): ListField<T> {
  return Object.freeze({ kind: 'list', item })
}

/** Словарь: ключ — значение ключевого юнита, значение — его поддерево. */
export function dict<K extends Key, T>(key: Cast<K>, value: Type<T>): DictField<K, T> {
  return Object.freeze({ kind: 'dict', key, value })
}

/** Совместно редактируемый текст: абзацы, внутри токены. */
export function text(): TextField {
  return TEXT
}

/** Ссылка на отдельную сущность. Читается `Doc | null` — забыть про null нельзя. */
export function link<N extends ModelName>(to: N, born: Born = 'here'): LinkField<N> {
  return Object.freeze({ kind: 'link', to, born })
}

export function links<N extends ModelName>(to: N, born: Born = 'here'): LinksField<N> {
  return Object.freeze({ kind: 'links', to, born })
}

/** Вложенная часть: живёт в поддереве родителя, есть всегда, `null` не бывает. */
export function part<N extends ModelName>(of: N): PartField<N> {
  return Object.freeze({ kind: 'part', of })
}

export function parts<K extends Key, N extends ModelName>(key: Cast<K>, of: N): PartsField<K, N> {
  return Object.freeze({ kind: 'parts', key, of })
}

/** Вложенный индекс (бывший empire): словарь словарей глубины 1…4. */
export function index<D extends Depth, N extends ModelName>(depth: D, of: N, born: Born = 'here'): IndexField<D, N> {
  return Object.freeze({ kind: 'index', depth, of, born })
}

/** У текста параметров нет — описание одно на процесс (правило 7 горячего пути). */
const TEXT: TextField = Object.freeze({ kind: 'text' })
