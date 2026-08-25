import { describe, expect, test } from 'vitest'
import { Link } from '../../binary/link'
import { PACK_STEP, PackCursor, packDecode } from '../../binary/pack'
import { SandUnit } from '../../binary/unit'
import { fixedClock } from '../../land/clock'
import { Land } from '../../land/land'
import { ROOT } from '../../land/view'
import { memoryStore } from '../memory'
import { Mirrors } from '../mirrors'

/**
 * Гейт корректности контракта хранилища.
 *
 * Проверяется не «оно что-то сохранило», а четыре обещания из шапки `store.ts`:
 * пачка (а не юниты), замещение по ключу, атомарность и порядок. Плюс то, ради
 * чего файл сделан пачкой: после перезапуска состояние аллокатора
 * восстанавливается РАЗБОРОМ, а не отдельным индексом.
 */

const LAND = Link.land(Link.peer(new Uint8Array(8).fill(0xa1)), new Uint8Array(8))

function peerOf(byte: number): Link {
  return Link.peer(new Uint8Array(8).fill(byte))
}

function landOf(byte = 0x11): Land {
  const land = new Land(peerOf(byte), fixedClock(1000))
  land.track()
  return land
}

/** Значения ленда, поднятого из хранилища, — то, что увидит пользователь. */
function revived(bin: Uint8Array, peer = 0x99): unknown[] {
  const land = new Land(peerOf(peer), fixedClock(2000))
  land.adopt(bin)
  return land.order(ROOT).map(view => view.value)
}

describe('a pack, not units', () => {
  test('save → load yields the same values, external ones included', () => {
    const store = memoryStore()
    const land = landOf()
    land.post(ROOT, ROOT, 'коротко')
    land.post(ROOT, ROOT, 'я'.repeat(300))
    land.post(ROOT, ROOT, { вложено: [1, 2, 3] })

    store.save(LAND, land.flush(LAND))
    expect(revived(store.load(LAND))).toEqual(land.order(ROOT).map(view => view.value))
  })

  test('an unknown land returns an empty pack, not a refusal', () => {
    const store = memoryStore()
    const bin = store.load(LAND)
    // Пустая пачка — это заголовок и ничего больше: «ленда ещё нет» штатно.
    expect(packDecode(bin)).toHaveLength(1)
    expect(packDecode(bin)[0]?.[1].units).toHaveLength(0)
    expect(revived(bin)).toEqual([])
  })

  test('load bytes belong to the caller: editing the image does not touch them', () => {
    const store = memoryStore()
    const land = landOf()
    land.post(ROOT, ROOT, 'первое')
    store.save(LAND, land.flush(LAND))

    const before = store.load(LAND)
    land.post(ROOT, ROOT, 'второе')
    store.save(LAND, land.flush(LAND))

    // Если бы `load` отдавал окно в образ, ленд, принявший его главами арены,
    // увидел бы чужие правки задним числом — и байты юнита поменялись бы под
    // уже выданным видом.
    expect(revived(before)).toEqual(['первое'])
    expect(revived(store.load(LAND)).sort()).toEqual(['второе', 'первое'].sort())
  })
})

describe('removal is replacement by key', () => {
  test('overwriting a value adds no unit to the image', () => {
    const store = memoryStore()
    const land = landOf()
    const view = land.post(ROOT, ROOT, 'раз')
    store.save(LAND, land.flush(LAND))
    expect(store.units(LAND)).toBe(1)

    for (const value of ['два', 'три', 'четыре']) {
      land.write(ROOT, ROOT, view.self, value)
      store.save(LAND, land.flush(LAND))
    }

    expect(store.units(LAND)).toBe(1)
    expect(revived(store.load(LAND))).toEqual(['четыре'])
  })

  test('a tombstone replaces the live version instead of lying beside it', () => {
    const store = memoryStore()
    const land = landOf()
    const view = land.post(ROOT, ROOT, 'жил')
    land.remove(view.self)
    store.save(LAND, land.flush(LAND))

    expect(store.units(LAND)).toBe(1)
    expect(revived(store.load(LAND))).toEqual([])
  })

  test('versions of DIFFERENT peers live under different keys', () => {
    // Ключ различает пиров намеренно: проигравший по LWW нужен `diff` из S7, и
    // затирать его версией соседа значит терять то, что ещё придётся отдать.
    const store = memoryStore()
    const first = landOf(0x11)
    const second = landOf(0x22)
    const view = first.post(ROOT, ROOT, 'от первого')

    second.apply(first.part().units, first.part().balls)
    second.write(ROOT, ROOT, view.self, 'от второго')

    store.save(LAND, first.flush(LAND))
    store.save(LAND, second.flush(LAND))
    expect(store.units(LAND)).toBe(2)
  })
})

describe('the file is a valid pack and an arena at once', () => {
  test('the image parses with a cursor and carries free slots', () => {
    const store = memoryStore({ mirrors: 1 })
    const land = landOf()
    const view = land.post(ROOT, ROOT, 'коротко')
    store.save(LAND, land.flush(LAND))
    // Перезапись значением ДРУГОЙ длины освобождает прежний слот.
    land.write(ROOT, ROOT, view.self, 'значительно длиннее прежнего значения, чтобы слот сменился')
    store.save(LAND, land.flush(LAND))

    const bin = (store.volumes(LAND)[0] as { bin(): Uint8Array }).bin()
    const cursor = new PackCursor(bin)
    let units = 0
    let free = 0
    for (let step = cursor.next(); step !== PACK_STEP.end; step = cursor.next()) {
      if (step === PACK_STEP.unit) units += 1
      if (step === PACK_STEP.free) free += cursor.size
    }

    expect(units).toBe(1)
    expect(free).toBeGreaterThan(0)
  })

  test('a restart restores both the data and the allocator state', () => {
    const store = memoryStore()
    const land = landOf()
    const view = land.post(ROOT, ROOT, 'а'.repeat(40))
    store.save(LAND, land.flush(LAND))

    // Освобождаем слот: значение другой длины.
    land.write(ROOT, ROOT, view.self, 'б')
    store.save(LAND, land.flush(LAND))
    const grown = store.bytes()

    // Перезапуск процесса: образы забыты, тома целы.
    store.reopen()
    expect(revived(store.load(LAND))).toEqual(['б'])

    // Освобождённый слот найден РАЗБОРОМ — новый юнит той же длины садится в
    // него, и файл не растёт. Именно это обещает docs/06 §4.
    const again = landOf(0x33)
    again.post(ROOT, ROOT, 'в'.repeat(40))
    store.save(LAND, again.flush(LAND))
    expect(store.bytes()).toBe(grown)
  })

  test('an image of a foreign land is rejected instead of being read as own', () => {
    const store = memoryStore()
    const land = landOf()
    land.post(ROOT, ROOT, 'моё')
    store.save(LAND, land.flush(LAND))

    const other = Link.land(Link.peer(new Uint8Array(8).fill(0xb2)), new Uint8Array(8))
    // Тома те же, ленд другой: `Mirrors.open` обязан сказать это вслух.
    const volumes = store.volumes(LAND)
    expect(() => Mirrors.open(volumes, other)).toThrow(/carries land/)
  })
})

describe('ordering and batches', () => {
  test('load after save sees what was saved, call order is preserved', () => {
    const store = memoryStore()
    const land = landOf()
    let lead = ROOT
    for (const value of ['а', 'б', 'в']) {
      lead = land.post(ROOT, lead, value).self
      store.save(LAND, land.flush(LAND))
    }
    expect(revived(store.load(LAND))).toEqual(['а', 'б', 'в'])
  })

  test('an empty pack changes nothing', () => {
    const store = memoryStore()
    const land = landOf()
    land.post(ROOT, ROOT, 'раз')
    store.save(LAND, land.flush(LAND))
    const was = store.bytes()

    store.save(LAND, land.flush(LAND))
    expect(store.bytes()).toBe(was)
    expect(store.units(LAND)).toBe(1)
  })
})

describe('external values', () => {
  test('ball is served by hash without raising the land', () => {
    const store = memoryStore()
    const land = landOf()
    const long = 'я'.repeat(400)
    land.post(ROOT, ROOT, long)
    store.save(LAND, land.flush(LAND))

    const unit = land.part().units[0] as SandUnit
    expect(unit.big()).toBe(true)

    const ball = store.ball(LAND, unit.shot())
    expect(ball).toBeDefined()
    expect([...(ball as Uint8Array)]).toEqual([...(land.part().balls.get(shotOf(unit)) as Uint8Array)])
    expect(store.ball(LAND, new Uint8Array(12).fill(7))).toBeUndefined()
  })

  test('overwriting a big value does not leave the previous ball in the map', () => {
    const store = memoryStore()
    const land = landOf()
    const view = land.post(ROOT, ROOT, 'я'.repeat(400))
    const first = (land.part().units[0] as SandUnit).shot()
    store.save(LAND, land.flush(LAND))

    land.write(ROOT, ROOT, view.self, 'ю'.repeat(400))
    store.save(LAND, land.flush(LAND))

    expect(store.ball(LAND, first)).toBeUndefined()
    expect(store.units(LAND)).toBe(1)
  })
})

describe('lands', () => {
  test('lands lists the known ones, drop forgets a land', () => {
    const store = memoryStore()
    const land = landOf()
    land.post(ROOT, ROOT, 'раз')
    store.save(LAND, land.flush(LAND))

    expect(store.lands().map(id => id.str)).toEqual([LAND.str])
    store.drop(LAND)
    expect(store.units(LAND)).toBe(0)
    expect(revived(store.load(LAND))).toEqual([])
  })
})

function shotOf(unit: SandUnit): string {
  return [...unit.shot()].map(b => b.toString(16).padStart(2, '0')).join('')
}
