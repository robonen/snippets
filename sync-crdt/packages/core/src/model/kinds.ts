// ─── Диспетчеризация по виду поля — ОДНОКРАТНАЯ ──────────────────────────────
//
// docs/05 §3.14, п. 5: вид выбирается при создании ячейки, дальше работают
// мономорфные пары функций. Ни одного `switch (field.kind)` на пути чтения.
//
// ─── Три таблицы, а не две ───────────────────────────────────────────────────
//
// К паре «читатель/писатель» добавлена третья — ФАБРИКА КАНАЛА. Виды с ключом
// (`dict`, `parts`, `index`) в общую фабрику не вписываются вторым аргументом:
// их значение мультиплексировано парой (голова, ключ), и ключ обязан попасть в
// ключ канала, а не в его аргумент (`binding.ts`, комментарий у `makeChannel`).
// Промах таблицы — не ошибка, а «канал обычной формы», поэтому у неё
// `undefined`, а не бросок.
//
// ─── Чего здесь ещё нет ──────────────────────────────────────────────────────
//
// `text` собирается поверх этого же основания. Пустая
// клетка — не забывчивость: канал такого поля создаётся с правильной формой и
// правильным `Spot`, и падает только при ОБРАЩЕНИИ, с текстом, называющим вид.
// Молча вернуть `undefined` было бы хуже вдвойне — `undefined` не является
// значением ни одного типа схемы (решение Р6), и он утёк бы в прикладной код как
// «значение».

import { ATOM_METHODS, readAtom, writeAtom } from './atom'
import type { Cell, Reader, Writer } from './cell'
import type { Handle, Head } from './channel'
import { DICT_METHODS, dictChannel, readEntry, writeEntry } from './dict'
import { ModelError } from './issue'
import {
  LINK_METHODS,
  LINKS_METHODS,
  readLink,
  readLinks,
  readPart,
  writeLink,
  writeLinks,
  writePart,
} from './link'
import { LIST_METHODS, readList, writeList } from './list'
import { INDEX_METHODS, indexChannel, PARTS_METHODS, partsChannel, readKeys, writeNest } from './parts'
import type { SpaceCore } from './space'
import { TEXT_METHODS, readText, writeText } from './text'

const NO_METHODS: Readonly<Record<string, unknown>> = Object.freeze({})

/** Фабрика канала для видов, чьё значение мультиплексировано ключом. */
export type Maker = (core: SpaceCore, cell: Cell, head: Head) => Handle

function absent(kind: string): never {
  throw new ModelError(
    `a field of kind «${kind}» is built by the next layer on top of the S4 foundation — currently supported: atom, list, dict, text, parts, index, link, links, part`,
    'model/kinds',
  )
}

export const READERS: Readonly<Record<string, Reader | undefined>> = Object.freeze({
  atom: readAtom,
  list: readList,
  // Ключ ячейки словаря — `self` КЛЮЧЕВОГО ЮНИТА, а не голова документа: пара
  // (голова, ключ) сводится к одному числу двумя уже кэшированными чтениями.
  dict: readEntry,
  // У `parts` и `index` под ключом лежит документ, а он мемоизирован сам, —
  // поэтому здесь кэшируется набор ключей УРОВНЯ (см. `parts.ts`).
  parts: readKeys,
  index: readKeys,
  // Ссылка — тот же первый живой ребёнок, что у атома, только значение его
  // разбирается как пешка и превращается в документ. На этом совпадении и стоит
  // бесплатность `cast(post.author, atom(t.maybe(t.link)))`.
  link: readLink,
  links: readLinks,
  // У части значения нет вовсе: её слот и есть голова вложенного документа.
  part: readPart,
  // Текст — два уровня на тех же юнитах: абзацы, внутри токены (`text.ts`).
  text: readText,
})

export const WRITERS: Readonly<Record<string, Writer | undefined>> = Object.freeze({
  atom: writeAtom,
  list: writeList,
  dict: writeEntry,
  parts: writeNest,
  index: writeNest,
  link: writeLink,
  links: writeLinks,
  part: writePart,
  text: writeText,
})

export const METHODS: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>> = Object.freeze({
  atom: ATOM_METHODS,
  list: LIST_METHODS,
  dict: DICT_METHODS,
  parts: PARTS_METHODS,
  index: INDEX_METHODS,
  link: LINK_METHODS,
  links: LINKS_METHODS,
  text: TEXT_METHODS,
  // У части методов нет: она есть всегда, читается одним вызовом и не пишется.
})

export const MAKERS: Readonly<Record<string, Maker | undefined>> = Object.freeze({
  dict: dictChannel,
  parts: partsChannel,
  index: indexChannel,
})

/** Пара чтения/записи для вида. Промах — вид, до которого слой не дошёл. */
export function readerFor(kind: string): Reader {
  return READERS[kind] ?? (() => absent(kind))
}

export function writerFor(kind: string): Writer {
  return WRITERS[kind] ?? (() => absent(kind))
}

export function methodsFor(kind: string): Readonly<Record<string, unknown>> {
  return METHODS[kind] ?? NO_METHODS
}

/** `undefined` — вид обходится каналом обычной формы `x()` / `x(next)`. */
export function makerFor(kind: string): Maker | undefined {
  return MAKERS[kind]
}
