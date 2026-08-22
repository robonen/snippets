import {
  diffOf,
  facesFromPack,
  packDecode,
  packEncode,
  packPart,
} from '@sync/core';
import type { Land, LandId } from '@sync/core';

/**
 * Клиентская сторона обмена — одна на оба транспорта (docs/server-sync.md §2).
 *
 * Пачка вошла: юниты применяем, и если собеседник назвался фейсами — считаем
 * встречную дельту и отдаём её обратно. Своих фейсов клиент НЕ шлёт: сервер
 * отвечает на фейсы всегда, и обмен фейсами в обе стороны крутился бы вечно.
 * Отсюда же беззаботность к дублям — вещание сервера приходит юнитами без
 * фейсов, применение идемпотентно, отвечать не на что.
 */
export function absorbPack(land: Land, id: LandId, bytes: Uint8Array): Uint8Array | null {
  let reply: Uint8Array | null = null;

  for (const [pid, part] of packDecode(bytes)) {
    if (pid.str !== id.str) continue;

    if (part.units.length > 0) land.apply(part.units, part.balls);

    if (part.faces.length > 0) {
      const delta = diffOf(land.part(), facesFromPack(part.faces));
      if (delta.units.length > 0) {
        reply = packEncode([[id, packPart({ units: delta.units, balls: delta.balls })]]);
      }
    }
  }

  return reply;
}
