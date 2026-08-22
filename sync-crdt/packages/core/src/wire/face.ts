// Фейсы и дельта: «докуда я видел каждого пира» и «что у меня есть сверх этого».
//
// ─── Face — векторные часы с контролем полноты (docs/08 §1) ──────────────────
//
// `time`/`tick` — обычный водяной знак векторных часов: самая свежая метка
// этого пира, которую я видел. `summ` — сколько юнитов этого пира у меня есть,
// и это главная находка baza: часы отвечают на «что нового», но не ловят
// ВЫБОРОЧНУЮ потерю юнита в середине истории. Реплика, у которой юниты пира
// свежее водяного знака собеседника, но их МЕНЬШЕ, чем собеседник насчитал у
// себя, что-то потеряла — и дельта по водяному знаку эту дыру не закроет
// никогда: потерянный юнит старше знака. Ответ — вся история пира целиком.
//
// ─── Почему модуль не трогает Land ───────────────────────────────────────────
//
// Фейсы считаются по выдаче `part()`, а не индексом внутри ленда. Это O(n) на
// вызов — и это правильная цена: фейсы нужны при РУКОПОЖАТИИ (вкладка открылась,
// сокет переподключился), то есть редко. Держать их инкрементально значило бы
// нагрузить каждый приём ради события, которое случается раз в сессию, и
// увеличить сам ленд — а он уже упирается в бюджет размера тем, что он класс и
// не отряхивается.

import type { PackFace, PackPart } from '../binary/pack'
import { Link } from '../binary/link'
import { SandUnit, shotKey, type AnyUnit } from '../binary/unit'

/** Водяной знак одного пира: докуда видел и сколько юнитов насчитал. */
export interface Face {
  readonly time: number
  readonly tick: number
  readonly summ: number
}

/** Ключ карты фейсов — hex восьми байт пира: сохраняет порядок байт (ADR-015). */
export function peerKey(peer: Link): string {
  const bin = peer.bin
  let out = ''
  for (let i = 0; i < 8; i++) out += ((bin[i] as number) | 0x100).toString(16).slice(1)
  return out
}

/**
 * Фейсы по содержимому части: на каждого встреченного пира — самая свежая метка
 * и счётчик его юнитов.
 */
export function facesOf(part: PackPart): Map<string, Face> {
  const out = new Map<string, { time: number; tick: number; summ: number }>()

  for (const unit of part.units) {
    const key = peerKey(unit.peer())
    const face = out.get(key)
    if (face === undefined) {
      out.set(key, { time: unit.time(), tick: unit.tick(), summ: 1 })
      continue
    }
    face.summ += 1
    const time = unit.time()
    if (time > face.time || (time === face.time && unit.tick() > face.tick)) {
      face.time = time
      face.tick = unit.tick()
    }
  }
  return out
}

/** Фейсы в форму пачки: с ними рукопожатие едет тем же форматом, что и данные. */
export function facesToPack(faces: ReadonlyMap<string, Face>): PackFace[] {
  const out: PackFace[] = []
  for (const [key, face] of faces) {
    const bin = new Uint8Array(8)
    for (let i = 0; i < 8; i++) bin[i] = parseInt(key.slice(i * 2, i * 2 + 2), 16)
    out.push({ peer: Link.peer(bin), time: face.time, tick: face.tick, summ: face.summ })
  }
  return out
}

/** Фейсы из принятой пачки. */
export function facesFromPack(faces: readonly PackFace[]): Map<string, Face> {
  const out = new Map<string, Face>()
  for (const face of faces) {
    out.set(peerKey(face.peer), { time: face.time, tick: face.tick, summ: face.summ })
  }
  return out
}

/**
 * Отстаём ли МЫ от собеседника — судя по его фейсам.
 *
 * Истина, когда у него есть пир, которого мы не видели, водяной знак свежее
 * нашего или юнитов пира насчитано больше. Нужна каналу вкладок: получив привет,
 * на который нам нечего послать, мы обязаны хотя бы назваться — иначе собеседник
 * не узнает, что это ЕМУ есть что слать, и направление «вошедший → старожил»
 * умрёт молча.
 */
export function behindOf(mine: ReadonlyMap<string, Face>, theirs: ReadonlyMap<string, Face>): boolean {
  for (const [key, face] of theirs) {
    // Нулевой фейс — «я такой-то пир, видел ноль». Он делает привет пустой
    // вкладки непустым (иначе привет побайтово совпадает с отпиской), но данных
    // за ним нет, и отстать от того, у кого ничего нет, нельзя. Без этой ветки
    // две сошедшиеся вкладки перекидывались бы фейсами вечно: каждая видела бы
    // у другой незнакомый нулевой фейс и считала себя отставшей.
    if (face.summ === 0) continue

    const ours = mine.get(key)
    if (ours === undefined) return true
    if (face.time > ours.time) return true
    if (face.time === ours.time && face.tick > ours.tick) return true
    if (face.summ > ours.summ) return true
  }
  return false
}

/** Дельта: юниты, которых собеседнику не хватает, и их выносные значения. */
export interface Diff {
  readonly units: AnyUnit[]
  readonly balls: Map<string, Uint8Array>
}

/**
 * Что у нас есть сверх фейсов собеседника.
 *
 * Обычный путь — водяной знак: юнит уезжает, если его метка свежее того, докуда
 * собеседник видел его автора, или автор собеседнику вовсе не известен.
 *
 * **Пограничная секунда уезжает целиком, и это цена ADR-017.** Водяной знак
 * индексируется ПИРОМ, а сеансы чеканки расщепляют пира на несколько
 * одновременных писателей: две вкладки офлайн пишут юниты с ОДНОЙ меткой
 * `(time, tick)` — разные `self`, одинаковые часы. Знак и счётчик у обеих
 * совпадают, и дельта по строгому знаку слепа в обе стороны: каждая считает,
 * что собеседник её юнит уже видел. Поэтому знак с сеансами достоверен только
 * СТРОГО ниже своей секунды, а юниты последней секунды пересылаются всегда —
 * повторная доставка идемпотентна, а секунда коротка.
 *
 * Второй путь — `Fail Summ` (docs/08 §1): если юнитов пира, которые собеседник
 * ПО ЕГО СЛОВАМ уже видел, у нас больше, чем он насчитал у себя, — он что-то
 * потерял, и дельта по знаку этого не закроет. Тогда уезжает вся история пира.
 */
export function diffOf(part: PackPart, theirs: ReadonlyMap<string, Face>): Diff {
  const units: AnyUnit[] = []
  const balls = new Map<string, Uint8Array>()

  // Пиры, у которых собеседник потерял середину истории: юнитов, которые он МОГ
  // видеть (не свежее его секунды, ВКЛЮЧАЯ пограничную), у нас больше, чем он
  // насчитал всего. Включительно — потому что его счётчик пограничные тоже
  // считает, и исключив их у себя, мы бы сравнивали разные множества: потеря при
  // равных счётчиках снова стала бы невидимой. Плата — ложное срабатывание,
  // когда НАШИ свежие юниты пограничной секунды ещё не доехали: пересылается
  // история пира целиком. Рукопожатие редкое, доставка идемпотентна.
  const seen = new Map<string, number>()
  for (const unit of part.units) {
    const face = theirs.get(peerKey(unit.peer()))
    if (face === undefined) continue
    if (unit.time() <= face.time) {
      seen.set(peerKey(unit.peer()), (seen.get(peerKey(unit.peer())) ?? 0) + 1)
    }
  }
  const resend = new Set<string>()
  for (const [key, count] of seen) {
    const face = theirs.get(key)
    if (face !== undefined && count > face.summ) resend.add(key)
  }

  for (const unit of part.units) {
    const key = peerKey(unit.peer())
    const face = theirs.get(key)

    // Свежее знака ИЛИ в его пограничной секунде — см. шапку функции.
    const fresh = face === undefined || unit.time() >= face.time

    if (!fresh && !resend.has(key)) continue

    units.push(unit)
    if (unit instanceof SandUnit && unit.big()) {
      const shot = shotKey(unit.shot())
      const ball = part.balls.get(shot)
      if (ball !== undefined) balls.set(shot, ball)
    }
  }

  return { units, balls }
}
