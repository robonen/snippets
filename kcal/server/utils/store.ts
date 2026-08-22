import { Land, Link, landIdOf, packEncode, packPart } from '@sync/core';
import type { Clock, LandId } from '@sync/core';
import { useStorage } from 'nitro/storage';

/**
 * Серверная реплика ленда поверх unstorage.
 *
 * Истина — одна запись `pack:<land>`: пачка байтов целиком (ADR-005 ядра: один
 * формат на провод, диск и дамп). Инстанс поднимает ленд на запрос и сохраняет
 * обратно — цена известна из замеров ядра: разбор пачки 10 000 юнитов ≈ 1 мс,
 * дневник на годы — тысячи юнитов, то есть доли миллисекунды.
 *
 * Сервер ничего не чеканит: у него нет своих правок, поэтому ему не нужны ни
 * сеанс (ADR-017), ни настоящие часы — но часы обязаны идти, чтобы Stamp
 * корректно принимал чужие метки.
 */

const wallClock: Clock = {
  now: () => Math.floor(Date.now() / 1000),
};

/** Пир сервера: фиксированный, от env либо байт «kcal-srv». Сервер им не пишет. */
function serverPeer(): Link {
  const hex = process.env.SYNC_SERVER_PEER;
  if (hex !== undefined && /^[0-9a-f]{16}$/.test(hex)) {
    const bin = new Uint8Array(8);
    for (let i = 0; i < 8; i++) bin[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return Link.peer(bin);
  }
  return Link.peer(new Uint8Array([0x6b, 0x63, 0x61, 0x6c, 0x2d, 0x73, 0x72, 0x76]));
}

export function parseLandId(raw: string | undefined): LandId | null {
  if (raw === undefined || raw === '') return null;
  try {
    return landIdOf(raw);
  }
  catch {
    return null;
  }
}

export async function loadLand(id: LandId): Promise<Land> {
  const land = new Land(serverPeer(), wallClock);
  const bin = await useStorage('lands').getItemRaw<Uint8Array>(`pack:${id.str}`);
  if (bin !== null && bin !== undefined) {
    // Драйверы отдают Buffer либо Uint8Array — ленду важны только байты.
    land.adopt(bin instanceof Uint8Array ? bin : new Uint8Array(bin));
  }
  return land;
}

export async function saveLand(id: LandId, land: Land): Promise<void> {
  await useStorage('lands').setItemRaw(`pack:${id.str}`, packEncode([[id, packPart(land.part())]]));
}

/**
 * Очередь на ленд ВНУТРИ инстанса: два одновременных запроса к одному ленду не
 * имеют права читать-сливать-писать вперемешку — второй потерял бы правки
 * первого (классический lost update).
 *
 * Между инстансами (Vercel) этой защиты нет — там нужен лок в Redis либо
 * Lua-скрипт «прочитай-слей-запиши»; для личного дневника с парой устройств
 * внутриинстансовой очереди достаточно, и это записано в kcal/docs/server-sync.md.
 */
const lanes = new Map<string, Promise<void>>();

export function withLand<R>(id: LandId, work: () => Promise<R>): Promise<R> {
  const key = id.str;
  const tail = lanes.get(key) ?? Promise.resolve();
  const run = tail.then(work, work);
  // В карте живёт «успокоенный» хвост: сравнение с самим собой при подчистке
  // обязано быть тождеством, а `run.catch()` каждый раз рождал бы новый промис.
  const settled = run.then(() => undefined, () => undefined);
  lanes.set(key, settled);
  settled.then(() => {
    if (lanes.get(key) === settled) lanes.delete(key);
  });
  return run;
}
