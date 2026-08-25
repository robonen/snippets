import { describe, expect, test } from 'vitest'
import { Link } from '../../binary/link'
import { fixedClock } from '../../land/clock'
import { Land } from '../../land/land'
import { ROOT } from '../../land/view'
import { Mirrors } from '../mirrors'
import { RamVolume } from '../memory'
import type { Volume } from '../store'

/**
 * `store.kill9` — гейт корректности стадии S5 (docs/11 §3).
 *
 * Запись обрывается на 1000 позициях, и после каждой проверяется ТРИ вещи:
 *
 *   1. хранилище открывается — то есть хотя бы одно зеркало дописано;
 *   2. состояние равно либо «до батча», либо «после батча», и никогда не смеси;
 *   3. подтверждённые раньше юниты на месте.
 *
 * ПОЧЕМУ ОБРЫВ МОДЕЛИРУЕТСЯ ТАК. У тома два буфера: рабочий, который видит
 * образ, и «носитель», куда байты доезжают через {@link Volume.wrote}. Обрыв
 * гасит доставку, а не запись в память, — то есть переживает ровно то, что
 * успело доехать. Модель СТРОЖЕ настоящего файла: у настоящего долетевшим
 * считается только то, что было до `fsync`, и достижимых оборванных состояний у
 * него МЕНЬШЕ. Проверка, которая может молча не сработать, хуже её отсутствия,
 * поэтому ниже отдельным тестом ломается сам обрыв — без него весь файл был бы
 * тысячей зелёных прогонов ни о чём.
 */

const LAND = Link.land(Link.peer(new Uint8Array(8).fill(0xa1)), new Uint8Array(8))

class Aborted extends Error {}

/**
 * Запас на всю систему, а не на том.
 *
 * Умирает ПРОЦЕСС, а не файл: обрыв обязан застать оба зеркала в один и тот же
 * момент общего потока байт. Отдельный счётчик на том давал бы каждой стороне
 * свой полный запас — то есть состояние, недостижимое ни при каком падении.
 */
class Budget {
  left: number
  done: number

  constructor(left: number) {
    this.left = left
    this.done = 0
  }
}

/** Том, у которого запись обрывается, когда общий запас исчерпан. */
class TornVolume implements Volume {
  #work: Uint8Array
  #disk: Uint8Array
  readonly #budget: Budget
  #done: number

  constructor(disk: Uint8Array, budget: Budget) {
    this.#work = disk.slice()
    this.#disk = disk.slice()
    this.#budget = budget
    this.#done = 0
  }

  bin(): Uint8Array {
    return this.#work
  }

  grow(size: number): Uint8Array {
    if (size <= this.#work.length) return this.#work
    const work = new Uint8Array(size)
    work.set(this.#work)
    this.#work = work
    const disk = new Uint8Array(size)
    disk.set(this.#disk)
    this.#disk = disk
    return work
  }

  wrote(at: number, size: number): void {
    const sent = Math.min(size, Math.max(this.#budget.left, 0))
    this.#disk.set(this.#work.subarray(at, at + sent), at)
    this.#budget.left -= sent
    this.#budget.done += sent
    this.#done += sent
    if (sent < size) throw new Aborted(`interruption: ${this.#budget.done} B delivered`)
  }

  flush(): void {
    // Носитель у этой модели устойчив сразу: см. разбор в шапке файла.
  }

  /** Что осталось на носителе после обрыва. */
  disk(): Uint8Array {
    return this.#disk
  }

  /** Сколько байт успело доехать — счётчик для раскладки позиций обрыва. */
  done(): number {
    return this.#done
  }
}

function peerOf(byte: number): Link {
  return Link.peer(new Uint8Array(8).fill(byte))
}

function landOf(byte = 0x11): Land {
  const land = new Land(peerOf(byte), fixedClock(1000))
  land.track()
  return land
}

/** Значения ленда, поднятого из этих байт, — отсортированные, для сравнения множеств. */
function revived(bin: Uint8Array): string[] {
  const land = new Land(peerOf(0x99), fixedClock(2000))
  land.adopt(bin)
  return land.order(ROOT).map(view => String(view.value)).sort()
}

/** Батч: столько-то новых значений и перезапись одного старого. */
function batchOf(land: Land, mark: string, count: number): Uint8Array {
  let lead = ROOT
  for (let i = 0; i < count; i++) {
    // Длины намеренно разные: короткие сидят внутри юнита, длинные уезжают в
    // `ball`. Обрыв обязан быть безопасен и посреди выносного значения.
    const value = i % 3 === 2 ? `${mark}-${i}-${'я'.repeat(80)}` : `${mark}-${i}`
    lead = land.post(ROOT, lead, value).self
  }
  return land.flush(LAND)
}

describe('a write interruption does not corrupt data', () => {
  test('1000 interruption positions: the state is either before the batch or after', () => {
    // Основа: ленд, уже сохранённый и подтверждённый.
    const land = landOf()
    const first = batchOf(land, 'основа', 12)
    const before = revived(first)

    const base = [new RamVolume(), new RamVolume()]
    Mirrors.open(base, LAND).save(first)
    const disks = base.map(volume => volume.bin().slice())

    // Второй батч — тот, который будет рваться.
    const second = batchOf(land, 'батч', 12)
    const after = revived(cat(first, second))

    // Сколько всего байт доезжает до носителя за целое сохранение: позиции
    // обрыва раскладываются по этому отрезку.
    const whole = new Budget(Number.MAX_SAFE_INTEGER)
    const probe = disks.map(disk => new TornVolume(disk, whole))
    Mirrors.open(probe, LAND).save(second)
    const total = whole.done
    expect(total).toBeGreaterThan(1000)

    const CUTS = 1000
    let kept = 0
    let lost = 0

    for (let i = 0; i < CUTS; i++) {
      const budget = Math.floor((total * i) / CUTS)
      // ОДИН запас на обе стороны, а не по запасу каждой. Первая редакция звала
      // `new Budget(budget)` ВНУТРИ `map`, то есть выдавала каждому тому полный
      // запас: как только его хватало одной стороне целиком (позиция 1416 из
      // 2832), сохранение доходило до конца и обрыва не случалось вовсе. Тест
      // краснел на собственной модели — ровно так, как и должен: умирает
      // процесс, а не файл.
      const shared = new Budget(budget)
      const torn = disks.map(disk => new TornVolume(disk, shared))

      let broke = false
      try {
        Mirrors.open(torn, LAND).save(second)
      } catch (error) {
        if (!(error instanceof Aborted)) throw error
        broke = true
      }
      expect(broke, `position ${budget}: the interruption must have happened`).toBe(true)

      // Перезапуск после обрыва: тома те, что остались на носителе.
      const revive = torn.map(volume => new RamVolume(volume.disk()))
      const mirrors = Mirrors.open(revive, LAND)
      const state = revived(mirrors.pack())

      if (state.length === after.length) {
        expect(state, `position ${budget}: the «after» state is corrupted`).toEqual(after)
        kept += 1
      } else {
        expect(state, `position ${budget}: the «before» state is corrupted`).toEqual(before)
        lost += 1
      }

      // Подтверждённое раньше не теряется НИ В ОДНОМ исходе — это и есть
      // обещание «обрыв не портит данные».
      for (const value of before) expect(state).toContain(value)
    }

    // Обе половины обязаны встретиться: если бы все прогоны давали «до», тест
    // проверял бы, что запись просто не доходит.
    expect(lost).toBeGreaterThan(0)
    expect(kept).toBeGreaterThan(0)
  })

  test('an interruption on the ONLY mirror loses the land — and says so', () => {
    // Сторож самой модели: если бы «оборванная сторона» отличалась от целой
    // ничем, тест выше был бы тысячей зелёных прогонов ни о чём. Одно зеркало
    // отказывается от устойчивости к обрыву, и отказ обязан быть громким.
    const land = landOf()
    const pack = batchOf(land, 'одно', 8)

    // Сначала успешное сохранение — образ размечен и дописан.
    const disk = new RamVolume()
    Mirrors.open([disk], LAND).save(pack)

    // Теперь второй батч, обрыв через восемь байт: метку успели стереть
    // (`soil`), вернуть (`seal`) не успели.
    const torn = new TornVolume(disk.bin().slice(), new Budget(8))
    expect(() => Mirrors.open([torn], LAND).save(batchOf(land, 'ещё', 4))).toThrow(Aborted)

    const revive = new RamVolume(torn.disk())
    expect(() => Mirrors.open([revive], LAND)).toThrow(/no mirror was fully written/)
  })

  test('an interruption AFTER the first mirror leaves the batch intact', () => {
    // Именно та строка таблицы из шапки `mirrors.ts`, ради которой роли зеркал
    // сделаны постоянными: сторона 0 дописана и новая, сторона 1 ещё старая.
    const land = landOf()
    const first = batchOf(land, 'основа', 4)
    const base = [new RamVolume(), new RamVolume()]
    Mirrors.open(base, LAND).save(first)
    const disks = base.map(volume => volume.bin().slice())

    const second = batchOf(land, 'батч', 4)
    const whole = new Budget(Number.MAX_SAFE_INTEGER)
    const probe = disks.map(disk => new TornVolume(disk, whole))
    Mirrors.open(probe, LAND).save(second)
    const side0 = probe[0]?.done() as number

    // Ровно столько, сколько нужно первой стороне, и ни байтом больше. Запас
    // общий на обе стороны — см. разбор у {@link Budget}.
    const shared = new Budget(side0)
    const torn = disks.map(disk => new TornVolume(disk, shared))
    expect(() => Mirrors.open(torn, LAND).save(second)).toThrow(Aborted)

    const revive = torn.map(volume => new RamVolume(volume.disk()))
    expect(revived(Mirrors.open(revive, LAND).pack())).toEqual(revived(cat(first, second)))
  })
})

/** Две пачки подряд — валидный пакет: заголовки одного ленда сливаются при разборе. */
function cat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}
