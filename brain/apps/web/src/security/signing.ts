import {
  RATE,
  TIER,
  createAuditor,
  mintSignerPair,
  openPack,
  packDecode,
  packEncode,
  rankOf,
  sealPack,
  signPack,
  signerOf,
  verifyPack,
} from '@sync/core';
import type { CryptoError, Link, PackPart, PassAlgo, Roster, SecretRing, Signer } from '@sync/core';
import type { Secure } from '@/sync/engine';
import { keepPair } from './device-keys';
import type { KeyKeeping } from './device-keys';

/**
 * Подпись устройства (docs/01-security.md ревизия 3, §7 «подписи»).
 *
 * Личность-подписант — Ed25519/P-256 пара, приватная половина неизвлекаема в
 * IndexedDB (рядом с ECDH-парой пейринга). Её `peer` = SHA-256[0..8) от
 * публичного ключа — И ОН ЖЕ адрес устройства в лендах: санд, печать и паспорт
 * несут один `peer`, поэтому подпись доказуемо покрывает именно эти санды.
 *
 * ─── Корень доверия — ленд `keys` ────────────────────────────────────────────
 *
 * Данные-ленды подписываются и проверяются против РОСТЕРА. Ростер строится из
 * ленда `keys` (какие устройства живы и с каким рангом), а сам `keys` НЕ
 * подписывается: он — корень доверия, защищённый церемонией пейринга (сверка
 * отпечатков + ECDH-обёртки), а не печатями. Курица и яйцо иначе: ленд,
 * задающий ростер, не может требовать ростер для проверки себя.
 *
 * Для личного пространства ранг тривиален: живое устройство — `rule` (владелец
 * может всё), отозванное — вне ростера (deny). Тонкие ранги (read/post/pull)
 * появятся, если пространство станет общим.
 */

let cached: Promise<Signer> | null = null;
let signerKept: KeyKeeping = 'memory';

/** Где живёт подписная пара — экрану «Доступ». */
export function signerKeeping(): KeyKeeping {
  return signerKept;
}

/**
 * Подписант этого устройства. Пара создаётся при первом обращении и переживает
 * запуски (`device-keys.ts`). Кэшируется ПРОМИС, а не результат: два
 * одновременных вызова на первом запуске иначе отчеканили бы две пары, и
 * адрес устройства зависел бы от гонки.
 */
export function deviceSigner(): Promise<Signer> {
  cached ??= (async () => {
    const kept = await keepPair<PassAlgo>({
      key: 'signer/v1',
      mint: mintSignerPair,
      local: {
        algo: 'p256',
        params: { name: 'ECDSA', namedCurve: 'P-256' },
        privateUsages: ['sign'],
        publicUsages: ['verify'],
      },
    });
    signerKept = kept.keeping;
    return signerOf(kept.algo, kept.pair);
  })();
  return cached;
}

/**
 * Собрать крипто-политику провода.
 *
 * @param ring     секреты лендов (шифрование payload);
 * @param signer   подписант этого устройства;
 * @param roster   ФАБРИКА ростера — зовётся один раз на кадр: список устройств
 *                 читается из живого CRDT-ленда `keys`, и дёргать его на каждый
 *                 lookup пира внутри проверки было бы работой ради работы;
 * @param openLand адрес ленда `keys` — корень доверия: не шифруется, не
 *                 подписывается, не проверяется (проходит насквозь).
 */
export function makeSecure(
  ring: SecretRing,
  signer: Signer,
  roster: () => Roster,
  openLand: string,
): Secure {
  // Проверяльщик общий на всё время жизни политики: импорт публичного ключа
  // пира (WebCrypto) случается один раз на сессию, а не на каждый кадр.
  const auditor = createAuditor();

  /**
   * Разнести пачку на корень доверия и данные — они едут разной политикой.
   * Быстрый путь: кадр целиком из одного мира (обычный случай — дельта данных
   * ЛИБО служебный ленд) уходит исходными байтами, без пересборки.
   */
  const split = (bin: Uint8Array): { root: Uint8Array | null; data: Uint8Array | null } => {
    const root: Array<readonly [Link, PackPart]> = [];
    const data: Array<readonly [Link, PackPart]> = [];
    for (const [id, part] of packDecode(bin)) {
      (id.str === openLand ? root : data).push([id, part]);
    }
    if (data.length === 0) return { root: bin, data: null };
    if (root.length === 0) return { root: null, data: bin };
    return { root: packEncode(root), data: packEncode(data) };
  };

  /** Обратная склейка. Одна часть — исходные байты, без перекодирования. */
  const join = (root: Uint8Array | null, data: Uint8Array | null): Uint8Array => {
    if (root === null) return data ?? packEncode([]);
    if (data === null) return root;
    const decoded: Array<readonly [Link, PackPart]> = [];
    for (const entry of packDecode(root)) decoded.push(entry);
    for (const entry of packDecode(data)) decoded.push(entry);
    return packEncode(decoded);
  };

  // Юнит, который не распечатать, ВЫБЫВАЕТ, а не валит кадр: пир без ключа
  // хранит всё подряд, в том числе юниты, запечатанные секретами, которых
  // больше ни у кого нет (устройство успело позаписывать до подключения;
  // прежние секреты после отзыва). Бросок здесь глушил бы каждую дельту
  // сервера целиком — вместе со всеми хорошими юнитами, навсегда.
  const complained = new Set<string>();
  const dropSealed = (error: CryptoError): void => {
    const at = error.at.split(', unit')[0] ?? error.at;
    if (complained.has(at)) return;
    complained.add(at);
    console.warn(
      `[brain] синк: часть юнитов (${at}) запечатана недоступным секретом и пропущена. `
      + 'Для нового устройства это «ещё не подключено» — подключите его фразой или грантом; '
      + 'после смены секретов это безвредный след старых данных на сервере.',
    );
  };

  return {
    async outgoing(pack: Uint8Array): Promise<Uint8Array> {
      const { root, data } = split(pack);
      // Данные: шифр, затем подпись поверх шифртекста (encrypt-then-sign).
      // `cover` — тот же ростер: санды под печатью живого пира не
      // пере-подписываются, санды отозванного получают наше поручительство.
      const secured = data === null
        ? null
        : await signPack(await sealPack(data, ring), signer, { cover: roster() });
      // Корень доверия едет как есть — он открыт и защищён церемонией.
      return join(root, secured);
    },

    async incoming(bytes: Uint8Array): Promise<Uint8Array> {
      const { root, data } = split(bytes);
      // Данные: проверка подписей ПО ШИФРТЕКСТУ, затем расшифровка. Неаутентичное
      // (подделка сервера, чужой пир, недостаточный ранг) отброшено verifyPack.
      const opened = data === null
        ? null
        : await openPack((await verifyPack(data, roster(), auditor)).pack, ring, dropSealed);
      return join(root, opened);
    },
  };
}

/**
 * Ростер из списка живых устройств: каждое — `rule` (владелец пространства).
 * Отозванные сюда не попадают, поэтому их печати не проходят.
 */
export function ownerRoster(livePeers: readonly Link[]): Roster {
  const allow = new Map(livePeers.map(peer => [peer.str, rankOf(TIER.rule, RATE.just)]));
  return { rankOf: peer => allow.get(peer.str) };
}
