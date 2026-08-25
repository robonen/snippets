// ─── Объявление модели: схема — источник истины ──────────────────────────────
//
// `model()` возвращает ДАННЫЕ — `{name, schema, derives}`, а не класс. Это
// расхождение №23 реестра: прошлая редакция docs/05 объявляла модель через
// `Object.defineProperty(Model.prototype, key)`, то есть требовала `this`,
// мутировала чужие объекты и отдавала `Pawn | null` вместо значения. Тот же ход,
// что в п. 15 реестра для `computed()`.

import type { Chan } from './channel'
import type { Field } from './field'
import type { ModelName } from './registry'

export type Schema = { readonly [key: string]: Field }

/** Карта производных полей: имя → тип результата. */
export type Derives = { readonly [key: string]: unknown }

export interface Model<N extends string, S extends Schema, D extends Derives = Record<never, never>> {
  readonly name: N
  readonly schema: S
  /**
   * Фантом-носитель типов производных полей. В рантайме тут карта функций; в
   * типе от них нужен только РЕЗУЛЬТАТ — параметр `doc` в сигнатуре сделал бы
   * `Model` инвариантной по схеме, и `Model<'post', S, D>` перестал бы быть
   * `AnyModel` (docs/05 §3.13, п. 3).
   */
  readonly derives?: D
}

export type AnyModel<N extends string = string> = Model<N, Schema, Derives>

/** Документ, как его видит производное поле: только каналы схемы, без `$`. */
export type View<S extends Schema> = { readonly [K in keyof S]: Chan<S[K]> }

declare const RESERVED: unique symbol

export interface ReservedFieldName<Why extends string> {
  readonly [RESERVED]: Why
}

/**
 * Запрет на имя `$` — типом, а не проверкой в рантайме.
 *
 * Схема с полем `$` не собирается вовсе: `AtomField<string>` не присваивается
 * `ReservedFieldName<…>`, и сообщение компилятора называет причину. Проверка в
 * рантайме нашла бы то же самое, но на первом запуске и у пользователя.
 */
type NoReserved<S> = {
  readonly [K in keyof S]: K extends '$'
    ? ReservedFieldName<'$ is reserved for document operations'>
    : S[K]
}

/**
 * Объявить модель.
 *
 * Производные поля вынесены ТРЕТЬИМ аргументом, а не смешаны со схемой:
 * `derived(post => …)` внутри того же литерала — круговая ссылка на собственный
 * инициализатор (TS7022), и одно такое поле обращает в `any` ВСЮ схему. Здесь
 * `S` выводится из второго аргумента, а колбэки третьего контекстно
 * типизируются уже готовым `View<S>`.
 *
 * @example
 * ```ts
 * export const Post = model('post', {
 *   title: atom(t.string),
 *   status: atom(t.enum(['draft', 'live']).or('draft')),
 * }, {
 *   loud: post => post.title().toUpperCase(),
 * })
 *
 * declare module '@sync/core' {
 *   interface Models {post: typeof Post}
 * }
 * ```
 */
export function model<const N extends string, S extends Schema, D extends Derives = Record<never, never>>(
  name: N,
  schema: S & NoReserved<S>,
  derives?: { readonly [K in keyof D]: (doc: View<S>) => D[K] },
): Model<N, S, D> {
  // unsafe: `derives` в типе — фантом результатов, в рантайме — карта функций.
  // Развести их двумя полями значило бы завести второе имя для одного понятия и
  // потребовать от прикладника писать его дважды.
  const out = Object.freeze({ name, schema: schema as S, derives }) as unknown as Model<N, S, D>
  enlist(name, out as unknown as AnyModel)
  return out
}

/**
 * Карта «имя → модель» для тех, у кого на руках только имя: `link('user')`
 * знает имя цели, а объект `User` в его файле может не импортироваться вовсе.
 *
 * Это НЕ дубль реестра типов: `Models` живёт в типах и наполняется аугментацией,
 * которая действует на всю программу; эта карта живёт в рантайме и наполняется
 * ВЫЗОВОМ `model()`. Промах здесь значит ровно одно — файл модели не загружен, и
 * сообщение говорит именно это, а не «undefined is not a function».
 */
const known = new Map<string, AnyModel>()

function enlist(name: string, model: AnyModel): void {
  const found = known.get(name)
  // Повторный вызов с тем же объектом — это перезагрузка модуля (HMR, второй
  // тестовый файл в том же процессе), и она законна. Два РАЗНЫХ объекта на одно
  // имя — нет: имя лежит в данных и обязано быть уникальным вечно (docs/05 §7.2).
  if (found !== undefined && found !== model) {
    throw new TypeError(`model «${name}» is already declared: model names are global (docs/05 §7.2)`)
  }
  known.set(name, model)
}

/** Модель по имени. `undefined` — файл модели не загружен. */
export function modelOf(name: string): AnyModel | undefined {
  return known.get(name)
}

/**
 * Композиция схем — обычное слияние объектов, проверяемое типами.
 *
 * У baza `dict.with` наследование работало наполовину: `static get schema`
 * закомментирован, а `Object.assign` делал СНИМОК, поэтому поле, добавленное в
 * базу позже, до потомка не доезжало (реестр, п. 36). Схема-данные снимает
 * вопрос: слияние происходит в момент объявления и других моментов у него нет.
 */
export function extend<
  const N extends string,
  A extends Schema,
  B extends Schema,
  D extends Derives = Record<never, never>,
>(
  name: N,
  base: Model<string, A, Derives>,
  more: B & NoReserved<B>,
  derives?: { readonly [K in keyof D]: (doc: View<A & B>) => D[K] },
): Model<N, A & B, D> {
  // Явная инстанциация: без неё компилятор выводит `S` из УЖЕ проверенного
  // аргумента и накладывает `NoReserved` вторым слоем на самого себя.
  const merged = { ...base.schema, ...(more as B) } as (A & B) & NoReserved<A & B>
  return model<N, A & B, D>(name, merged, derives)
}

/** Имя модели из модели или из самого имени. Одна точка нормализации на слой. */
export function nameOf<N extends ModelName>(model: AnyModel<N> | N): N {
  return typeof model === 'string' ? model : model.name
}
