// Обмен пачками для ПИРА-СЕРВЕРА: пачка вошла — пачка вышла.
//
// Канал вкладок (`tabs.ts`) держит свои правила ответов — они доказывают обрыв
// цепочки реплик на ОБЩЕЙ шине, где каждый слышит каждого. У сервера топология
// другая: точка-точка, и правило проще — на привет отвечаем ВСЕГДА, дельтой
// плюс своими фейсами (по ним клиент посчитает встречную дельту и дошлёт своё).
// Петля здесь невозможна по построению: ответ сервера уходит одному клиенту, а
// клиент на пачку с юнитами фейсами не отвечает — только юнитами, если ему есть
// что слать.
//
// Сервер сам ничего не чеканит — у него нет своих правок, только приём и
// пересказ. Поэтому ему не нужен ни сеанс (ADR-017), ни кран.

import { Link } from '../binary/link'
import { packDecode, packEncode, packPart, type LandId } from '../binary/pack'
import type { Land } from '../land/land'
import { diffOf, facesFromPack, facesOf, facesToPack, peerKey } from './face'

/**
 * Привет: наши фейсы, ни одного юнита — «вот моё состояние».
 *
 * Всегда несёт СВОЙ пир, даже нулевым фейсом: привет пустой реплики иначе
 * побайтово совпадает с отпиской (faces ✗ units ✗), и собеседник молчит.
 */
export function helloPack(land: Land, id: LandId): Uint8Array {
  const faces = facesOf(land.part())
  const self = peerKey(land.peer())
  if (!faces.has(self)) faces.set(self, { time: 0, tick: 0, summ: 0 })
  return packEncode([[id, packPart({ faces: facesToPack(faces) })]])
}

export interface Exchange {
  /** Ответ собеседнику. `null` — отвечать нечего (пачка юнитов без фейсов). */
  readonly reply: Uint8Array | null
  /** Сколько юнитов реально изменили состояние — сигнал «пора сохранять и вещать». */
  readonly taken: number
}

/**
 * Принять пачку и собрать ответ.
 *
 * Юниты применяются, фейсы получают дельту. Ответ на фейсы включает наши фейсы
 * всегда: сервер обязан назваться и тогда, когда слать нечего, — иначе клиент,
 * у которого есть непереданное, не узнает об этом (тот же урок, что ветка
 * «назваться» в канале вкладок).
 */
export function exchange(land: Land, id: LandId, bytes: Uint8Array): Exchange {
  let taken = 0
  let reply: Uint8Array | null = null

  for (const [pid, part] of packDecode(bytes)) {
    if (pid.str !== id.str) continue

    if (part.units.length > 0) taken += land.apply(part.units, part.balls)

    if (part.faces.length > 0) {
      const mine = land.part()
      const delta = diffOf(mine, facesFromPack(part.faces))
      const faces = facesOf(mine)
      const self = peerKey(land.peer())
      if (!faces.has(self)) faces.set(self, { time: 0, tick: 0, summ: 0 })
      reply = packEncode([[id, packPart({
        units: delta.units,
        balls: delta.balls,
        faces: facesToPack(faces),
      })]])
    }
  }

  return { reply, taken }
}

/** Идентификатор ленда из текста ссылки — для роутов сервера. */
export function landIdOf(text: string): LandId {
  return Link.parse(text)
}
