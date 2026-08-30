import { identityOf, mintExchangePair } from '@sync/core';
import type { ExchangeAlgo, Identity } from '@sync/core';
import { keepPair } from './device-keys';
import type { KeyKeeping } from './device-keys';

/**
 * Личность устройства для подключения: ECDH-пара (X25519, при недоступности
 * P-256). Публичная половина — id записи устройства в ленде `keys`; приватной
 * открываются гранты, адресованные этому устройству.
 */

let cached: Promise<Identity> | null = null;
let kept: KeyKeeping = 'memory';

/** Где живёт пара — экрану «Доступ»: запомнит ли браузер это устройство. */
export function identityKeeping(): KeyKeeping {
  return kept;
}

/**
 * Чеканится ОДИН раз — кэшируется промис: два одновременных вызова на первом
 * запуске иначе отчеканили бы две личности, и в пространстве появилось бы два
 * устройства вместо одного. Как пара переживает запуски — `device-keys.ts`.
 */
export function deviceIdentity(): Promise<Identity> {
  cached ??= (async () => {
    const pair = await keepPair<ExchangeAlgo>({
      key: 'exchange/v1',
      mint: mintExchangePair,
      local: {
        algo: 'p256',
        params: { name: 'ECDH', namedCurve: 'P-256' },
        privateUsages: ['deriveBits'],
        publicUsages: [],
      },
    });
    kept = pair.keeping;
    return identityOf(pair.algo, pair.pair);
  })();
  return cached;
}

/** Имя устройства для списка — по платформе; точнее браузер не скажет. */
export function deviceLabel(): string {
  const ua = globalThis.navigator?.userAgent ?? '';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad/i.test(ua)) return 'iPhone/iPad';
  if (/mac/i.test(ua)) return 'Mac';
  if (/windows/i.test(ua)) return 'Windows';
  return 'устройство';
}
