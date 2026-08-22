import { describe, expect, test } from 'vitest'
import { Link } from '../../../binary/link'
import { varyDecode, varyEncode } from '../../../binary/vary'
import { fixedClock } from '../../../land/clock'
import { Land } from '../../../land/land'
import { ROOT, type LocalId } from '../../../land/view'
import { createSpace, type Issue } from '../../index'
import { Note } from '../blog'

/**
 * Регрессия из упавшего прогона `model.tamper.prop`: «expected +0 to deeply
 * equal -0».
 *
 * ЧТО СЛУЧИЛОСЬ. `fast-check` подсунул в числовое поле `-0`. Ожидание в
 * property считалось от ЛИТЕРАЛА (`lens.decode(raw)`), а чтение — от того, что
 * доехало через байты; формат же каноничен (ADR-008) и `-0` от `+0` не
 * отличает. Упало ожидание, а не код.
 *
 * ПОЧЕМУ ЭТО СТОИТ ТЕСТА, А НЕ ПРОСТО ПРАВКИ ОЖИДАНИЯ. Граница «что формат
 * несёт, а что нет» — часть контракта слоя: `-0` не является отдельным
 * значением НИГДЕ, и попытка когда-нибудь «починить» это в кодеке обязана
 * покраснеть здесь, а не всплыть расхождением реплик.
 */
describe('регрессия: -0 не отдельное значение', () => {
  function peerOf(byte: number): Link {
    const bin = new Uint8Array(8)
    bin[0] = byte
    return Link.peer(bin)
  }

  test('кодек сводит -0 к +0, и модель читает +0 без единой жалобы', () => {
    expect(Object.is(varyDecode(varyEncode(-0)), 0)).toBe(true)

    const land = new Land(peerOf(0x11), fixedClock(1000))
    const issues: Issue[] = []
    const space = createSpace({ land, salt: new Uint8Array([1]), report: issue => issues.push(issue) })
    const note = space.root(Note)

    note.views(1)
    const slot = land.order(ROOT)[0]?.self as LocalId
    const node = land.nodes(slot)[0] as LocalId

    const other = new Land(peerOf(0x99), fixedClock(2000))
    other.write(other.nodeOf(land.idOf(slot)), ROOT, other.nodeOf(land.idOf(node)), -0, 'term')
    land.apply(other.units())

    // Не `blank` по совпадению, а именно прочитанный ноль: `-0` — законное целое.
    expect(Object.is(note.views(), 0)).toBe(true)
    expect(issues).toHaveLength(0)
  })

  test('своя запись -0 идемпотентна против последующего 0', () => {
    const land = new Land(peerOf(0x11), fixedClock(1000))
    const space = createSpace({ land, salt: new Uint8Array([1]), report: () => {} })
    const note = space.root(Note)

    note.views(-0)
    const written = land.size()
    // Юнит уже есть и байты те же — второй записи быть не должно.
    note.views(0)
    expect(land.size()).toBe(written)
  })
})
