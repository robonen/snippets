// Референсная реконсиляция — «честно тупая», как требует PRINCIPLES (правило 2:
// «для алгоритмов, которые сложно проверить глазами, — референсная наивная
// реализация и тест эквивалентности; референс остаётся в репозитории навсегда»).
//
// ─── Чем она отличается от боевой, и почему это оракул, а не копия ───────────
//
// Боевая делает ДВЕ вещи одним проходом: решает, что с чем сопоставить, и тут же
// протягивает якорь (`lead`) через уже сделанные записи. Ровно в этом сращивании
// и живут ошибки анкеровки — надгробие, потерявшее роль якоря, или вставка,
// вставшая за старым соседом вместо только что вставленного.
//
// Здесь эти две вещи РАЗВЕДЕНЫ:
//
//   1. сопоставление считается на двух ОЧЕРЕДЯХ (`shift`, O(n²)) — без индексов,
//      без `to`, без арифметики «сколько осталось справа»;
//   2. якоря протягиваются ВТОРЫМ проходом по готовому плану.
//
// Плюс референс предсказывает не только содержимое, но и ТОЧНУЮ
// последовательность `self` после правки — то есть отвечает на вопрос, ради
// которого всё затевалось: сколько юнитов родилось и где они встали.

import type { Vary } from '../../binary/vary'
import { varyEqual } from '../../binary/vary'
import { ROOT, type SandView } from '../../land/view'
import { predictItem } from '../address'
import type { Head } from '../channel'
import type { SpaceCore } from '../space'

export interface NaivePost {
  /** Что это была за ветка: вставка заводит НОВЫЙ узел, остальные переписывают. */
  readonly kind: 'insert' | 'remove' | 'replace'
  readonly lead: Head
  readonly self: Head
  /** `null` — надгробие. */
  readonly value: Vary
}

export interface NaivePlan {
  /** Что обязано быть записано, по порядку. */
  readonly posts: readonly NaivePost[]
  /** Значения, которые обязаны прочитаться после правки. */
  readonly values: readonly Vary[]
  /** Узлы, которые обязаны остаться живыми, по порядку чтения. */
  readonly selves: readonly Head[]
}

type Step =
  | { readonly kind: 'keep' }
  | { readonly kind: 'remove' }
  | { readonly kind: 'insert'; readonly value: Vary }
  | { readonly kind: 'replace'; readonly value: Vary }

/**
 * Шаг 1: сопоставление на очередях.
 *
 * Приоритет ветвей тот же, что в спеке (docs/05 §3.8): совпало → вставка →
 * удаление → замена. «Справа осталось больше нового» здесь выражено буквально —
 * длиной очереди, а не разностью индексов.
 */
function align(olds: readonly Vary[], news: readonly Vary[]): Step[] {
  const left = olds.slice()
  const right = news.slice()
  const out: Step[] = []

  while (left.length > 0 || right.length > 0) {
    if (left.length > 0 && right.length > 0 && varyEqual(left[0] as Vary, right[0] as Vary)) {
      out.push({ kind: 'keep' })
      left.shift()
      right.shift()
      continue
    }
    if (right.length > left.length) {
      out.push({ kind: 'insert', value: right.shift() as Vary })
      continue
    }
    if (left.length > right.length) {
      out.push({ kind: 'remove' })
      left.shift()
      continue
    }
    out.push({ kind: 'replace', value: right.shift() as Vary })
    left.shift()
  }
  return out
}

/** Шаг 2: якоря — вторым проходом по готовому плану. */
export function reconcileNaive(
  core: SpaceCore,
  slot: Head,
  prev: readonly SandView[],
  next: readonly Vary[],
  from: number,
  to: number,
): NaivePlan {
  const olds: Vary[] = []
  for (let i = from; i < to; i++) olds.push(core.valueOf(prev[i] as SandView) as Vary)

  const steps = align(olds, next)

  const posts: NaivePost[] = []
  const selves: Head[] = []
  for (let i = 0; i < from; i++) selves.push((prev[i] as SandView).self)

  let lead: Head = from > 0 ? (prev[from - 1] as SandView).self : ROOT
  let at = from

  for (const step of steps) {
    if (step.kind === 'keep') {
      const stay = prev[at] as SandView
      selves.push(stay.self)
      lead = stay.self
      at++
      continue
    }
    if (step.kind === 'insert') {
      const self = predictItem(core.land, core.salt, slot, lead, step.value)
      posts.push({ kind: 'insert', lead, self, value: step.value })
      selves.push(self)
      lead = self
      continue
    }
    if (step.kind === 'remove') {
      const gone = prev[at] as SandView
      // Надгробие встаёт за ЯКОРЕМ РЕЗУЛЬТАТА и само становится якорем для
      // следующего шага. Не за своим прежним соседом: ранг среди сиблингов
      // определяется меткой победителя, а у надгробия она свежая, и оставленный
      // на месте узел прыгал бы в начало группы (см. `list.ts`, ветка 3).
      posts.push({ kind: 'remove', lead, self: gone.self, value: null })
      lead = gone.self
      at++
      continue
    }
    const stay = prev[at] as SandView
    posts.push({ kind: 'replace', lead, self: stay.self, value: step.value })
    selves.push(stay.self)
    lead = stay.self
    at++
  }

  for (let i = to; i < prev.length; i++) selves.push((prev[i] as SandView).self)

  const values: Vary[] = []
  for (let i = 0; i < from; i++) values.push(core.valueOf(prev[i] as SandView) as Vary)
  for (const value of next) values.push(value)
  for (let i = to; i < prev.length; i++) values.push(core.valueOf(prev[i] as SandView) as Vary)

  return { posts, values, selves }
}
