import { expect, test } from 'vitest'
import { Link } from '../../binary/link'
import { fixedClock } from '../../land/clock'
import { Land } from '../../land/land'
import { ROOT } from '../../land/view'
import { packDecode, packEncode, packPart } from '../../binary/pack'
import { exchange, helloPack } from '../exchange'
import { diffOf, facesFromPack } from '../face'

const LAND = Link.land(Link.peer(new Uint8Array(8).fill(0xd7)), new Uint8Array(8))

function peerOf(fill: number): Link {
  return Link.peer(new Uint8Array(8).fill(fill))
}

/** Серверная реплика: свой пир, ничего не чеканит. */
function serverLand(): Land {
  return new Land(peerOf(0x5e), fixedClock(2000))
}

function device(session: number): Land {
  return new Land(peerOf(0x11), fixedClock(1000), { session })
}

function valuesOf(land: Land): unknown[] {
  return land.order(ROOT).map((view) => view.value)
}

test('устройство наполняет пустой сервер через привет и встречную дельту', () => {
  const remote = serverLand()
  const local = device(0x10)
  const first = local.post(ROOT, ROOT, 'запись')
  local.post(ROOT, first.self, 'ещё одна')

  // Привет: у сервера пусто, дельты нет — но он обязан назваться.
  const hello = exchange(remote, LAND, helloPack(local, LAND))
  expect(hello.taken).toBe(0)
  expect(hello.reply).not.toBeNull()

  // Клиент по фейсам сервера строит встречную дельту и шлёт юниты.
  const push = exchange(remote, LAND, packOfDelta(local, hello.reply as Uint8Array))
  expect(push.taken).toBe(2)
  expect(valuesOf(remote)).toEqual(['запись', 'ещё одна'])
})

test('второе устройство получает всё одним приветом', () => {
  const remote = serverLand()
  const one = device(0x000010)
  const first = one.post(ROOT, ROOT, 'с первого устройства')
  exchange(remote, LAND, packOfDelta(one, exchange(remote, LAND, helloPack(one, LAND)).reply as Uint8Array))

  const two = device(0x800010)
  const back = exchange(remote, LAND, helloPack(two, LAND))
  const applied = exchange(two, LAND, back.reply as Uint8Array)
  expect(applied.taken).toBe(1)
  expect(valuesOf(two)).toEqual(['с первого устройства'])

  // И в обратную сторону: правка второго доезжает до первого через сервер.
  two.post(ROOT, first.self, 'со второго')
  exchange(remote, LAND, packOfDelta(two, back.reply as Uint8Array))
  const refresh = exchange(remote, LAND, helloPack(one, LAND))
  exchange(one, LAND, refresh.reply as Uint8Array)
  expect(valuesOf(one)).toEqual(['с первого устройства', 'со второго'])
})

test('повторный привет при равных состояниях ничего не меняет', () => {
  const remote = serverLand()
  const local = device(0x10)
  local.post(ROOT, ROOT, 'x')
  exchange(remote, LAND, packOfDelta(local, exchange(remote, LAND, helloPack(local, LAND)).reply as Uint8Array))

  const again = exchange(remote, LAND, helloPack(local, LAND))
  expect(again.taken).toBe(0)
  // Ответ есть (сервер называется), но юниты в нём — только пограничная секунда,
  // и их повторное применение у клиента изменений не даст.
  const echo = exchange(local, LAND, again.reply as Uint8Array)
  expect(echo.taken).toBe(0)
})

test('чужой ленд в пачке игнорируется', () => {
  const OTHER = Link.land(Link.peer(new Uint8Array(8).fill(0x99)), new Uint8Array(8))
  const remote = serverLand()
  const local = device(0x10)
  local.post(ROOT, ROOT, 'не туда')

  // Пачка с юнитами, адресованная ДРУГОМУ ленду, — сервер её не принимает.
  const delta = diffOf(local.part(), new Map())
  const bytes = packEncode([[OTHER, packPart({ units: delta.units, balls: delta.balls })]])
  const out = exchange(remote, LAND, bytes)
  expect(out.taken).toBe(0)
  expect(out.reply).toBeNull()
  expect(remote.size()).toBe(0)
})

/**
 * Дельта клиента в ответ на фейсы сервера — то, что на живом клиенте делает
 * обработчик порта. Здесь руками: собрать пачку юнитов, которых серверу не
 * хватает по его же фейсам.
 */
function packOfDelta(local: Land, serverReply: Uint8Array): Uint8Array {
  for (const [, part] of packDecode(serverReply)) {
    if (part.faces.length === 0) continue
    const delta = diffOf(local.part(), facesFromPack(part.faces))
    return packEncode([[LAND, packPart({ units: delta.units, balls: delta.balls })]])
  }
  return packEncode([[LAND, packPart()]])
}
