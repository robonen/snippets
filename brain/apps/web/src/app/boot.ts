import { packDecode, packEncode } from '@sync/core';
import { createRegistry, landId, openSpaces } from '@brain/module-kit';
import type { LandId, Roster, SecretRing, Signer } from '@sync/core';
import type { Registry, Spaces } from '@brain/module-kit';
import type { Keyring } from '@brain/auth';
import { loadModules } from '@/app/modules';
import { INBOX_ID } from '@/db/inbox';
import { armLock, currentKeyring } from '@/security/lock';
import {
  KEYS_ID,
  announceDevice,
  claimGrant,
  deviceIdentity,
  grantTo,
  livePeers,
  markRevoked,
  regrantAll,
} from '@/security/pairing';
import type { PairedDevice } from '@/security/pairing';
import { deviceSigner, makeSecure, ownerRoster } from '@/security/signing';
import { loadSyncSettings, startSync, stopSync } from '@/sync';

/**
 * Порядок запуска.
 *
 * Прост как до шифрования — потому что шифрование уехало в ядро:
 *
 *   1. состояние замка по обёрткам из localStorage (ленды НЕ нужны);
 *   2. заперто — оболочка показывает экран замка;
 *      не настроено — связка открывается ключом устройства прямо здесь;
 *   3. связка получена → все ленды поднимаются одним заходом → синк.
 *
 * Открытого мета-ленда, переезда «до подъёма» и двух баз больше нет; старые
 * установки переезжают внутри разблокировки (`security/migrate-legacy.ts`).
 */

/** Ленды с данными пользователя. Служебный `keys` — отдельно: он открытый. */
let dataLands: string[] = [];
let spacesRef: Spaces | null = null;
let signerRef: Signer | null = null;

export async function bootBrain(): Promise<{ spaces: Spaces; registry: Registry }> {
  const modules = await loadModules();
  const registry = createRegistry(modules);
  dataLands = [INBOX_ID, ...modules.map(module => module.id)];

  // Подписант — ДО сборки пространств: его `peer` (хэш ключа подписи) становится
  // адресом устройства в лендах, иначе печати не докажут авторство сандов.
  const signer = await deviceSigner();
  signerRef = signer;

  const spaces = openSpaces({
    modules,
    shell: [{ id: INBOX_ID }, { id: KEYS_ID }],
    peer: signer.peer,
  });
  spacesRef = spaces;

  await armLock({
    reveal: async (ring) => {
      // Секреты — ДО подъёма: sealedStore спрашивает связку на первом же load.
      for (const name of dataLands) await ring.ensure(landId(name).str);
      await spaces.unseal(secretsOf(ring));

      // Устройство объявляется в пространстве: ECDH-ключ для пейринга и подписной
      // peer для ростера. Без этого его не подключить, не отозвать и не доверять
      // его печатям.
      const identity = await deviceIdentity();
      announceDevice(spaces.space(KEYS_ID), identity, signer.peer.str, deviceLabel());

      startSync({ spaces, secure: secureOf(ring, signer), lands: [KEYS_ID, ...dataLands] });
    },
    conceal: async () => {
      // Сначала снять синк, потом закрыть ленды: пришедшая пачка иначе успела
      // бы влиться в ленд, который уже закрывают.
      stopSync();
      await spaces.seal();
    },
  });

  return { spaces, registry };
}

/** Связка → SecretRing ядра. `keys` — единственный открытый ленд. */
function secretsOf(ring: Keyring): SecretRing {
  const keysLand = landId(KEYS_ID).str;
  return {
    secretOf(land: LandId): CryptoKey | null {
      if (land.str === keysLand) return null;
      const key = ring.secretOf(land.str);
      // Бросок, а не `null`: `null` означал бы «вези открытым», и опечатка в
      // имени ленда молча сложила бы данные текстом.
      if (key === null) throw new Error(`нет секрета ленда «${land.str}» — связка неполна`);
      return key;
    },
  };
}

/** Крипто-политика провода: шифр по связке + подпись, ростер живой из ленда `keys`. */
function secureOf(ring: Keyring, signer: Signer): ReturnType<typeof makeSecure> {
  const keysLand = landId(KEYS_ID).str;
  // Фабрика ростера: зовётся один раз на кадр (контракт makeSecure), поэтому
  // «доверил устройство или отозвал» проверка видит без перезапуска синка, а
  // список устройств из CRDT не перечитывается на каждый lookup пира.
  const roster = (): Roster => ownerRoster(livePeers(need().space(KEYS_ID)));
  return makeSecure(secretsOf(ring), signer, roster, keysLand);
}

function deviceLabel(): string {
  const ua = globalThis.navigator?.userAgent ?? '';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad/i.test(ua)) return 'iPhone/iPad';
  if (/mac/i.test(ua)) return 'Mac';
  if (/windows/i.test(ua)) return 'Windows';
  return 'устройство';
}

// ── Оркестровка подключения и отзыва ─────────────────────────────────────────
//
// Живёт здесь, а не в `security/pairing.ts`, потому что порядок шагов держится
// на лендах и синке, которые собирает именно boot. Криптография — там.

/**
 * Принять выданную нам обёртку: ЗАМЕНИТЬ локальные данные пространством.
 *
 * Локальные ленды к этому моменту — свежепосеянные заготовки нового устройства;
 * их честно стереть и дать серверу налить настоящие данные. UI обязан
 * предупредить об этом до вызова.
 */
export async function joinSpace(): Promise<void> {
  const spaces = need();
  const ring = ringNow();
  const identity = await deviceIdentity();

  const secrets = await claimGrant(spaces.space(KEYS_ID), identity);
  if (secrets === null) throw new Error('обёртка для этого устройства ещё не выдана');

  stopSync();
  await spaces.seal();
  await spaces.wipe(dataLands);
  await ring.replaceAll(secrets);
  // Ленды, которых у дателя нет (новый модуль этой сборки), получают свои.
  for (const name of dataLands) await ring.ensure(landId(name).str);

  await spaces.unseal(secretsOf(ring));
  startSync({ spaces, secure: secureOf(ring, signerNow()), lands: [KEYS_ID, ...dataLands] });
}

/**
 * Отозвать устройство. Порядок несущий:
 *
 *   1. пометить отзыв и забрать обёртку (ещё под старыми секретами — уедет);
 *   2. снять данные в память ОТКРЫТЫМИ, погасить синк, дописать хвосты;
 *   3. стереть носитель, перевыпустить секреты;
 *   4. поднять ленды заново — те же данные запечатываются новыми секретами;
 *   5. выдать новые секреты живым устройствам; серверные копии стереть —
 *      следующий привет зальёт перепечатанное с нуля.
 *
 * Отозванное устройство сохраняет то, что УСПЕЛО прочитать, — отобрать
 * прочитанное не может никакая криптография. Новые правки ему недоступны.
 */
export async function revokeDevice(device: PairedDevice): Promise<void> {
  const spaces = need();
  const ring = ringNow();
  const identity = await deviceIdentity();

  markRevoked(spaces.space(KEYS_ID), device);

  const kept = new Map<string, { pack: Uint8Array }>();
  for (const name of dataLands) {
    const land = spaces.landOf(name);
    const part = land.part();
    kept.set(name, { pack: packEncode([[landId(name), part]]) });
  }

  stopSync();
  await spaces.seal();
  await spaces.wipe(dataLands);
  await ring.rotate(dataLands.map(name => landId(name).str));

  await spaces.unseal(secretsOf(ring));
  for (const [name, { pack }] of kept) {
    const land = spaces.landOf(name);
    for (const [, part] of packDecode(pack)) {
      if (part.units.length > 0) land.apply(part.units, part.balls);
    }
  }

  await regrantAll(spaces.space(KEYS_ID), ring, identity);
  await wipeServerLands();
  startSync({ spaces, secure: secureOf(ring, signerNow()), lands: [KEYS_ID, ...dataLands] });
}

/** Стереть серверные копии лендов данных — перед перезаливкой перепечатанного. */
async function wipeServerLands(): Promise<void> {
  const settings = loadSyncSettings();
  if (settings.url === '') return;
  for (const name of dataLands) {
    const at = `${settings.url}/lands/${landId(name).str}`;
    const response = await fetch(at, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${settings.token}` },
    });
    if (!response.ok) {
      throw new Error(`сервер не стёр ленд «${name}»: ${response.status} — отзыв не завершён, повторите`);
    }
  }
}

/** Доверить устройству пространство: человек сверил отпечатки и нажал кнопку. */
export async function trustDevice(device: PairedDevice): Promise<void> {
  const spaces = need();
  await grantTo(spaces.space(KEYS_ID), ringNow(), await deviceIdentity(), device);
}

/** Ждёт ли НАС обёртка в ленде — «можно присоединяться». */
export async function pendingGrant(): Promise<boolean> {
  const spaces = spacesRef;
  if (spaces === null || !spaces.open) return false;
  try {
    return await claimGrant(spaces.space(KEYS_ID), await deviceIdentity()) !== null;
  }
  catch {
    return false;
  }
}

function need(): Spaces {
  if (spacesRef === null) throw new Error('приложение ещё не собрано');
  return spacesRef;
}

function ringNow(): Keyring {
  const ring = currentKeyring();
  if (ring === null) throw new Error('связка заперта');
  return ring;
}

function signerNow(): Signer {
  if (signerRef === null) throw new Error('подписант не готов');
  return signerRef;
}
