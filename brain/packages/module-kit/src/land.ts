import { Link } from '@sync/core';
import type { Clock } from '@sync/core';

/**
 * Чеканка адреса ленда по идентификатору модуля.
 *
 * Ленд — единица синка, прав и шифрования, и границы лендов совпадают с
 * границами модулей (план, Р2). Адрес обязан быть ДЕТЕРМИНИРОВАННЫМ: он один и
 * тот же на всех устройствах и во всех запусках, иначе устройства не сойдутся.
 *
 * Схема — ASCII-байты идентификатора, повторённые по кругу до восьми. Не хэш, и
 * это выбрано намеренно: `kcal` даёт ровно `6b 63 61 6c 6b 63 61 6c` — тот
 * самый адрес, с которым дневник уже живёт. Хэш дал бы другие байты, и переезд
 * kcal превратился бы в переливку данных вместо простого открытия того же ленда.
 *
 * Цена схемы — столкновения на периодах: `ab`, `abab` и `abababab` чеканят один
 * адрес. Ловится не здесь, а в реестре (`createRegistry`), где виден весь набор
 * модулей сразу: проверка одного имени в отрыве от остальных ничего не значит.
 */

/** Хвост адреса ленда. Нули: ленд — корневой, у него нет родителя. */
const LAND_TAIL = new Uint8Array(8);

const PEER_BYTES = 8;

export function landBytes(moduleId: string): Uint8Array {
  if (moduleId.length === 0) {
    throw new Error('module identifier is empty: no land address can be minted from it');
  }
  const out = new Uint8Array(PEER_BYTES);
  for (let i = 0; i < PEER_BYTES; i++) {
    const code = moduleId.charCodeAt(i % moduleId.length);
    if (code > 0x7F) {
      throw new Error(
        `module identifier «${moduleId}» is not ASCII: the land address is minted from the name's bytes, `
        + 'and non-ASCII would depend on the encoding',
      );
    }
    out[i] = code;
  }
  return out;
}

/** Адрес ленда модуля. Один и тот же на всех устройствах — это и есть точка сходимости. */
export function landId(moduleId: string): Link {
  return Link.land(Link.peer(landBytes(moduleId)), LAND_TAIL);
}

// ── Идентичность устройства ──────────────────────────────────────────────────

const PEER_KEY = 'brain.peer';

/**
 * Пир — идентичность УСТРОЙСТВА, одна на все ленды: до появления ключей (S6)
 * это восемь случайных байт в localStorage.
 *
 * Не путать с сеансом: сеанс свой у каждого одновременно живого ленда
 * (ADR-017), иначе два ленда одного устройства чеканили бы одинаковые id.
 */
export function devicePeer(storage: Pick<Storage, 'getItem' | 'setItem'>): Link {
  const stored = storage.getItem(PEER_KEY);
  if (stored !== null) {
    try {
      return Link.parse(stored);
    }
    catch {
      // Битое значение — перечеканиваем: пир не данные, терять нечего.
    }
  }
  const bin = new Uint8Array(PEER_BYTES);
  crypto.getRandomValues(bin);
  const link = Link.peer(bin);
  storage.setItem(PEER_KEY, link.str);
  return link;
}

/** Часы приложения: секунды эпохи. Ядро время само не берёт — его дают снаружи. */
export const wallClock: Clock = {
  now: () => Math.floor(Date.now() / 1000),
};
