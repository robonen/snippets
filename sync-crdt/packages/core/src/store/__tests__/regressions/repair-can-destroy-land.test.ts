import { expect, test } from 'vitest'
import { Link } from '../../../binary/link'
import { PackImage } from '../../image'
import { Mirrors } from '../../mirrors'
import { RamVolume } from '../../memory'

/**
 * Регрессия: **починка зеркала могла уничтожить ленд целиком**.
 *
 * Восстановление разошедшейся стороны идёт копией: `PackImage.create(volume, id)`,
 * затем `clone(raw)`. Но `create` зовёт `#format()`, а тот пишет метку секции
 * «LAND» и делает `flush` — то есть сторона объявляется ЦЕЛОЙ и ПУСТОЙ ещё до
 * того, как в неё приедут данные.
 *
 * Обрыв в этом окне оставлял валидную пустышку. Следующее открытие берёт первую
 * помеченную сторону ведущей, находит пустышку — и восстанавливает по ней вторую
 * сторону, единственную, где данные ещё были. Ленд исчезал целиком, при том что
 * на носителе он был.
 *
 * Гейт `kill9` этого не видел и не мог: он ставит обрыв внутри `Mirrors.save`, а
 * восстановление во всех его тестах идёт на томе, который не рвётся.
 *
 * Лечение — копия под тем же протоколом, что и всякая запись: `soil` до, `seal`
 * после. Недописанная копия целой не выглядит, и открытие её отвергает.
 */

const LAND = Link.land(Link.peer(new Uint8Array(8).fill(0xd1)), new Uint8Array(8))

/** Том, который перестаёт принимать запись после N вызовов `wrote`. */
class TornVolume extends RamVolume {
  #left: number

  constructor(left: number) {
    super()
    this.#left = left
  }

  override wrote(at: number, size: number): void {
    if (this.#left <= 0) throw new Error('обрыв записи')
    this.#left -= 1
    super.wrote(at, size)
  }
}

function filled(): Uint8Array {
  const volume = new RamVolume()
  const image = PackImage.create(volume, LAND)
  image.seal()
  return image.raw()
}

test('недописанная копия не выглядит целой', () => {
  const raw = filled()

  // Обрыв ровно в окне между «пометил целой» и «скопировал данные».
  const torn = new TornVolume(2)
  const spare = PackImage.create(torn, LAND)
  expect(() => spare.clone(raw)).toThrow()

  // Вот проверка, ради которой всё: оборванная копия НЕ должна считаться
  // дописанной. До починки здесь было `true` — и её брали ведущей.
  expect(PackImage.clean(torn)).toBe(false)
})

test('негодная сторона не роняет открытие, если исправна другая', () => {
  const good = new RamVolume()
  const first = PackImage.create(good, LAND)
  first.seal()

  // Вторая сторона помечена целой, но тело — мусор: метка долетела, данные нет.
  const bad = new RamVolume()
  const junk = bad.grow(64)
  junk.fill(0xff)
  junk[0] = 0x4c // 'L'
  junk[1] = 0x41 // 'A'
  junk[2] = 0x4e // 'N'
  junk[3] = 0x44 // 'D'
  bad.wrote(0, junk.length)

  // Зеркало заводят ровно затем, чтобы одна негодная сторона не была приговором.
  const mirrors = Mirrors.open([good, bad], LAND)
  expect(mirrors.count()).toBe(2)
})
