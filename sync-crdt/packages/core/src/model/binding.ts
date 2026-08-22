// v8:hot — здесь собираются документ и канал, то есть форма всего, что читает
// прикладной код. Правила из docs/05 §3.14 действуют на весь файл.

import { computed, type KeyedComputedRef } from '@sync/fiber'
import { ROOT } from '../land/view'
import { type Handle, type Head, SPOT, type Spot } from './channel'
import { type Binding, CELL, type Cell, DERIVED } from './cell'
import { mountSlot } from './cell'
import { makerFor, readerFor, methodsFor, writerFor } from './kinds'
import type { AnyModel } from './model'
import { docOps } from './ops'
import type { SpaceCore } from './space'

/**
 * Реестр привязок: (пространство → модель → ячейки).
 *
 * Двухуровневая карта, а не склеенный ключ: `WeakMap` по пространству
 * освобождает всё разом вместе с лендом, а внутренняя карта по ОБЪЕКТУ модели
 * не требует ни строки, ни конкатенации (правило 3 горячего пути этого слоя).
 */
const bindings = new WeakMap<SpaceCore, Map<AnyModel, Binding>>()

/**
 * Слот, которого нет: производное поле ключевого юнита не имеет.
 *
 * Один канал на процесс, а не по одному на производное поле: он всегда отдаёт
 * `ROOT`, зависимостей не имеет и потому пересчитан не будет никогда.
 */
const NO_SLOT: KeyedComputedRef<Head, Head> = computed.keyed(() => ROOT)

export function bindingOf(core: SpaceCore, model: AnyModel): Binding {
  let models = bindings.get(core)
  if (models === undefined) {
    models = new Map()
    bindings.set(core, models)
  }

  const found = models.get(model)
  if (found !== undefined) return found

  const fresh = makeBinding(core, model)
  models.set(model, fresh)
  return fresh
}

/**
 * Ячейки модели: по две на поле схемы плюс по одной на производное.
 *
 * ПОЧЕМУ ячейка на модель, а не на сущность (решение Р2): `Post` с восемью
 * полями на одном ленде — это 16 `computed.keyed`, ≈16 × 14.7 нс ≈ 235 нс
 * ЕДИНОЖДЫ за жизнь процесса. Всё, что растёт с числом сущностей, — записи в
 * `Map` внутри keyed-каналов, и только для РЕАЛЬНО ПРОЧИТАННЫХ полей.
 * Непрочитанное поле не стоит ничего.
 */
function makeBinding(core: SpaceCore, model: AnyModel): Binding {
  const cells: Cell[] = []
  const bind: Binding = { core, model, cells, docs: new Map() }

  const schema = model.schema
  for (const key of Object.keys(schema)) {
    cells.push(makeCell(core, bind, key, schema[key] as Cell['field']))
  }

  // unsafe: в типе `derives` — фантом результатов, в рантайме — карта функций
  // (docs/05 §1.2). Развести их значило бы потребовать от прикладника писать
  // имена производных полей дважды.
  const derives = model.derives as Record<string, ((doc: unknown) => unknown) | undefined> | undefined
  if (derives !== undefined) {
    for (const key of Object.keys(derives)) {
      cells.push(makeDerive(core, bind, key, derives[key] as (doc: unknown) => unknown))
    }
  }

  return bind
}

function makeCell(core: SpaceCore, bind: Binding, key: string, field: Cell['field']): Cell {
  const kind = field.kind
  // Диспетчеризация по виду — ОДНОКРАТНАЯ, при создании ячейки, а не на каждом
  // чтении (docs/05 §3.14, п. 5).
  const read = readerFor(kind)
  const write = writerFor(kind)

  // Строка «где лежит». Пересчитывается при появлении/уходе ЛЮБОГО ключа
  // документа, но возвращает ТО ЖЕ значение — и распространение гасится
  // сравнением результата в `Fiber.put`.
  const slot = computed.keyed((head: Head) => core.keyIndex(head).get(key) ?? ROOT)

  const cell: Cell = {
    core,
    bind,
    key,
    field,
    slot,
    // Заполняется строкой ниже: `value` замкнут на саму ячейку, а ячейка на
    // `value`. Шейп при этом не меняется — свойство уже объявлено, меняется
    // только его содержимое, и происходит это ОДИН раз на (модель, поле), до
    // первого чтения.
    value: undefined as unknown as KeyedComputedRef<Head, unknown>,
    methods: methodsFor(kind),
    channels: new Map(),
  }

  cell.value = computed.keyed({
    get: (head: Head) => read(core, cell, head),
    set: (head: Head, next: unknown) => {
      write(core, cell, head, next)
    },
  })

  return cell
}

/**
 * Производное поле: обычный канал над готовым документом.
 *
 * Документ берётся ЛЕНИВО, в момент чтения: на момент создания ячейки его ещё
 * нет, а к первому чтению он уже лежит в `bind.docs` — и это тот же объект, что
 * у прикладного кода, поэтому производное поле подписывается ровно на те же
 * каналы.
 */
function makeDerive(core: SpaceCore, bind: Binding, key: string, fn: (doc: unknown) => unknown): Cell {
  const cell: Cell = {
    core,
    bind,
    key,
    field: DERIVED,
    slot: NO_SLOT,
    value: undefined as unknown as KeyedComputedRef<Head, unknown>,
    methods: EMPTY_METHODS,
    channels: new Map(),
  }
  cell.value = computed.keyed((head: Head) => fn(openDoc(core, bind.model, head)))
  return cell
}

const EMPTY_METHODS: Readonly<Record<string, unknown>> = Object.freeze({})

/**
 * Документ по адресу. Мемоизирован: два вызова дают ОДИН объект.
 *
 * На идентичности держатся сравнения в прикладном коде (`post.author() === user`)
 * и отсутствие размножения подписок.
 *
 * РАСХОЖДЕНИЕ С docs/05 §3.12: там реестр — `Map<head, WeakRef<Doc>>` плюс
 * `FinalizationRegistry`. Здесь карта СИЛЬНАЯ, и по той же причине, по которой
 * их не использует ядро (PRINCIPLES, гейт корректности): след прогона обязан
 * быть воспроизводимым, а `WeakRef` делает наблюдаемое состояние зависящим от
 * воли GC. Цена названа: документы живут, пока живо пространство. Освобождение
 * по достижимости — отдельная работа, и делать её надо там же, где живёт
 * сборка ядра, а не двумя разными механизмами.
 */
export function openDoc(core: SpaceCore, model: AnyModel, head: Head): object {
  const bind = bindingOf(core, model)
  const found = bind.docs.get(head)
  if (found !== undefined) return found

  const doc = makeDoc(core, bind, head)
  bind.docs.set(head, doc)
  return doc
}

/**
 * Хендл документа: объект стабильной формы плюс стрелки-каналы.
 *
 * Порядок ключей фиксирован при `model()`, значит ВСЕ документы одной модели
 * сходятся к одной карте скрытых классов, и `post.title` мономорфен.
 *
 * `Object.freeze` здесь нет: заморозка добавляет переход шейпа на каждый
 * документ, а инвариант «никто не пишет в документ» держит тип `readonly`.
 */
function makeDoc(core: SpaceCore, bind: Binding, head: Head): object {
  const out: Record<string, unknown> = {}
  const cells = bind.cells
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i] as Cell
    out[cell.key] = makeChannel(core, cell, head)
  }
  out.$ = docOps(core, bind, head)
  return out
}

/**
 * Собрать канал поля. Кэша здесь нет: у схемного поля его роль исполняет сам
 * документ, а он мемоизирован.
 *
 * Контекст замыкания держит ровно `{cell, head}` — два слота. Ни одного нового
 * замыкания на МЕТОД: таблица методов общая на (модель, поле) и копируется одним
 * `Object.assign`.
 */
function makeChannel(core: SpaceCore, cell: Cell, head: Head): Handle {
  // Ключевые виды (`dict`, `parts`, `index`) строят канал СВОЕЙ фабрикой: их
  // значение мультиплексировано парой (голова, ключ), и ключ обязан попасть в
  // ключ канала, а не в его аргумент. Выбор фабрики — такая же ОДНОКРАТНАЯ
  // диспетчеризация по виду, что и выбор пары чтения/записи: она случается при
  // сборке канала, а не на вызове.
  const make = makerFor(cell.field.kind)
  if (make !== undefined) return make(core, cell, head)

  // Одна ветка на вызов: «аргумента не было — это чтение».
  const channel = ((next?: unknown): unknown => {
    if (next === undefined) return cell.value(head)
    return cell.value(head, next)
  }) as unknown as Record<symbol | string, unknown>

  const spot: Spot = { land: core.id, head, field: cell.key }
  // Присваивание, а не `Object.defineProperty`: 4 нс против 120 (реестр, п. 17).
  channel[SPOT] = spot
  channel[CELL] = cell
  Object.assign(channel, cell.methods)

  return channel as unknown as Handle
}

/**
 * Канал поля на конкретной голове — с гарантией идентичности.
 *
 * У СХЕМНОЙ ячейки канал берётся из документа: `post.title` и есть тот самый
 * объект, и заводить под него вторую карту значило бы платить `Map.set` на
 * каждое открытие документа ради identity, которая уже обеспечена. У ad-hoc
 * спеки из `cast()` документа нет — там карта и нужна.
 */
export function channelFor(core: SpaceCore, cell: Cell, head: Head): Handle {
  const bind = cell.bind
  if (bind !== null) {
    return (openDoc(core, bind.model, head) as Record<string, Handle>)[cell.key] as Handle
  }

  const found = cell.channels.get(head)
  if (found !== undefined) return found

  const fresh = makeChannel(core, cell, head)
  cell.channels.set(head, fresh)
  return fresh
}

/** Ячейка поля модели — точка входа `cast` и следующего слоя. */
export function cellFor(core: SpaceCore, model: AnyModel, key: string): Cell | undefined {
  const cells = bindingOf(core, model).cells
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i] as Cell
    if (cell.key === key) return cell
  }
  return undefined
}

export { mountSlot }
