// ─── Адреса: `self` ключевого юнита и элемента ───────────────────────────────
//
// docs/05 §3.6. РАСХОЖДЕНИЕ С baza дважды, оба раза сознательно.
//
// 1. Там `self = H(значение, H(head ‖ lead))`, то есть зависит от ТОЧКИ ВСТАВКИ:
//    два пира, добавившие один и тот же ключ в разные позиции, получали ДВА
//    поддерева на один ключ (реестр, п. 30). Наша формула ключа от позиции не
//    зависит, поэтому такие вставки схлопываются по LWW. Для ЭЛЕМЕНТОВ СПИСКА
//    формула baza сохранена: там зависимость от точки вставки — ровно то, что
//    нужно, иначе одинаковые значения в разных местах слиплись бы в один
//    элемент.
//
// 2. На ЗАШИФРОВАННОМ ленде baza берёт `self` случайным, и бесплатная
//    дедупликация конкурентных вставок просто исчезает (реестр, п. 31). У нас
//    адрес контентный ВСЕГДА, но подсолен секретом ленда: внутри ленда
//    детерминизм сохранён, снаружи хэш ничего не выдаёт.
//
// ─── Почему хэш синхронный и не криптографический ────────────────────────────
//
// Соблазн взять `crypto.subtle` понятен, но он асинхронен — а значит вычисление
// адреса стало бы точкой ПРИОСТАНОВКИ, и приостанавливаемой стала бы ЗАПИСЬ:
// `post.title('x')` из обработчика клика мог бы бросить `Suspend`. От адреса
// требуется детерминизм и равномерность, а не стойкость: тот, кто может угадать
// `self`, уже имеет право писать в этот ленд.

import { type Vary, varyEncode } from '../binary/vary'
import type { Land } from '../land/land'
import { ROOT, id48, putId48, type LocalId } from '../land/view'
import type { Key } from './value'

const FNV_BASIS = 0x811c9dc5
const FNV_PRIME = 0x0100_0193
const GOLDEN = 0x9e37_79b9
const MIX_A = 0x7feb_352d
const MIX_B = 0x846c_a68b
const SPREAD = 0x85eb_ca6b

/** 2⁴⁸ — потолок локального id: ровно шесть байт формата (docs/03 §2). */
const ID_SPACE = 0x1_0000_0000_0000

/**
 * 48 бит из последовательности байт — порт идеи `$mol_hash_numbers`.
 *
 * Два независимых 32-битных аккумулятора вместо одного 64-битного: `bigint`
 * здесь стоил бы аллокации на каждый шаг, а 48 бит из двух `Math.imul` ложатся
 * в double ТОЧНО и потому годятся ключом карты без бокса.
 */
function digest(parts: readonly Uint8Array[]): number {
  let a = FNV_BASIS
  let b = GOLDEN

  for (let p = 0; p < parts.length; p++) {
    const part = parts[p] as Uint8Array
    for (let i = 0; i < part.length; i++) {
      const byte = part[i] as number
      a = Math.imul(a ^ byte, FNV_PRIME)
      b = Math.imul(b + byte, SPREAD)
      b ^= b >>> 13
    }
    // Разделитель между частями: без него `('ab', 'c')` и `('a', 'bc')` дали бы
    // один адрес, то есть поле `abc` и поле `ab` документа `c` слиплись бы.
    a = Math.imul(a ^ 0xff, FNV_PRIME)
  }

  a ^= a >>> 16
  a = Math.imul(a, MIX_A)
  a ^= a >>> 15
  b ^= b >>> 16
  b = Math.imul(b, MIX_B)
  b ^= b >>> 16

  return ((a >>> 16) & 0xffff) * 0x1_0000_0000 + (b >>> 0)
}

/**
 * Свести хэш к законному локальному id.
 *
 * Ленд отвергает юнит, объявивший себя корнем или собственным родителем
 * (`land.ts`, `#accept`): корень — сентинел, а не узел, и такой юнит сделал бы
 * `order(ROOT)` содержащим сам `ROOT`, то есть увёл бы обход слоя моделей в
 * бесконечность. Поэтому оба значения сдвигаются, а не «проверяются потом».
 */
function settle(id: number, head: number): number {
  let out = id
  if (out === 0) out = 1
  if (out === head) out = out + 1 >= ID_SPACE ? 1 : out + 1
  return out
}

/** Шесть байт локального id головы — вход хэша, а не строка. */
function idBytes(land: Land, node: LocalId): Uint8Array {
  return node === ROOT ? ROOT_BYTES : land.idOf(node)
}

const ROOT_BYTES = new Uint8Array(6)

/**
 * `self` ключевого юнита: H(соль ‖ head ‖ ключ).
 *
 * От позиции НЕ зависит — в этом вся разница с baza.
 */
export function predictKey(land: Land, salt: Uint8Array, head: LocalId, key: Key): LocalId {
  const bytes = idBytes(land, head)
  const id = settle(digest([salt, bytes, varyEncode(key)]), id48(bytes, 0))
  return land.nodeAt(id)
}

/**
 * `self` элемента: H(соль ‖ head ‖ lead ‖ значение) — формула baza, зависимая от
 * точки вставки.
 *
 * На ней держится схлопывание общего префикса при слиянии одинаковых вставок:
 * два пира, набравшие один и тот же текст, обязаны получить ОДНИ юниты, а два
 * пира, вставившие одинаковое слово в разные места, — РАЗНЫЕ.
 */
export function predictItem(land: Land, salt: Uint8Array, head: LocalId, lead: LocalId, value: Vary): LocalId {
  const bytes = idBytes(land, head)
  const home = id48(bytes, 0)
  let id = settle(digest([salt, bytes, idBytes(land, lead), varyEncode(value)]), home)

  // ЗАНЯТЫЙ АДРЕС ПРОПУСКАЕТСЯ — и это не страховка от хэш-коллизий, а
  // обязательный шаг.
  //
  // Формула зависит от `lead`, а `lead` соседей при вставке НЕ переписывается,
  // поэтому одна и та же пара (lead, значение) законно встречается дважды за
  // жизнь списка. Три обычные записи это показывают:
  //
  //     tags(['-'])            → '-' рождается по адресу H(slot, ROOT, '-')
  //     tags(['a', '-'])       → 'a' встаёт перед ним, '-' сохраняет lead = ROOT
  //     tags(['-', 'a', '-'])  → минимальная правка — вставить '-' в начало,
  //                              адрес снова H(slot, ROOT, '-') — ЗАНЯТ
  //
  // Без пропуска третья запись не рождает элемент, а переклеивает живой хвостовой
  // '-' в начало: читатель получает `['-', 'a']` вместо `['-', 'a', '-']`, и
  // сходимость этого не ловит — реплики теряют элемент СОГЛАСОВАННО. Найдено
  // property-прогоном `text.prop.test.ts` (сид 1838113582), воспроизводится и на
  // голом `list`.
  //
  // Это ровно тот шаг, который есть у baza: `self_make` крутит
  // `if (_self_all.has(idea)) continue` с перехэшированием до свободного, — и
  // ровно то, о чём п. 32 реестра говорит «иначе контентный адрес может выдать
  // занятый self и молча заменить чужой элемент».
  //
  // Пропускаются только ЖИВЫЕ узлы: надгробие обязано переиспользоваться, иначе
  // повторный набор стёртого текста не воскрешал бы его юниты, а плодил вторые.
  for (let spin = 0; spin < SPIN_MAX; spin++) {
    const node = land.nodeAt(id)
    const view = land.peek(node)
    if (view === null || view.dead) return node
    id = respin(id, home)
  }
  return land.nodeAt(id)
}

/** Потолок перехэширований. Выше него адрес принимается как есть: цикл не имеет права висеть. */
const SPIN_MAX = 8

/** Метка перехэша: без неё повторный digest тех же байт дал бы тот же ответ. */
const SPIN_TAG = new Uint8Array([0x5f])

function respin(id: number, home: number): number {
  const bytes = new Uint8Array(6)
  putId48(bytes, 0, id)
  return settle(digest([SPIN_TAG, bytes]), home)
}
