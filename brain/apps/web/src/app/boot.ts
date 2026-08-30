import { packDecode, packEncode } from '@sync/core';
import { createRegistry, landId, openSpaces } from '@brain/module-kit';
import type { LandId, Roster, SecretRing, Signer } from '@sync/core';
import type { Registry, Spaces } from '@brain/module-kit';
import type { Keyring, SpaceMaterial, WrappedDek } from '@brain/auth';
import { loadModules } from '@/app/modules';
import { INBOX_ID } from '@/db/inbox';
import {
  assertKnownPhrase,
  deviceKek,
  encodeBytes,
  kekFromPassphrase,
  keyringFromMaterial,
  normalizePhrase,
  openSpaceVault,
  unlockKeyring,
} from '@brain/auth';
import { DEVICE_LABEL, armLock, currentKeyring, refreshWraps, swapRing } from '@/security/lock';
import { dropWrap, listWraps, saveWrap } from '@/security/keys';
import {
  KEYS_ID,
  SPACE_PHRASE_LABEL,
  announceDevice,
  claimGrant,
  claimInvite,
  clearGrant,
  clearPhraseWrap,
  deviceIdentity,
  isSenior,
  livePeers,
  markRevoked,
  publishInvite,
  publishPhraseWrap,
  publishRing,
  readVault,
  regrantAll,
  reviveDevice,
  revokeInvite,
} from '@/security/pairing';
import type { PairedDevice } from '@/security/pairing';
import { deviceSigner, makeSecure, ownerRoster } from '@/security/signing';
import { loadSyncSettings, startSync, stopSync, syncConfigured } from '@/sync';

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
 *
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

      // Связка — синхронизируемое состояние пространства, но сливать её с
      // сейфом можно только УВИДЕВ сервер: до первого ответа локальный ленд
      // пуст, и «сейфа нет — опубликую свой» перетирало бы чужой сейф
      // свежим мастером неподключённого устройства.
      const lands = [KEYS_ID, ...dataLands];
      if (syncConfigured(loadSyncSettings())) {
        startSync({
          spaces,
          secure: secureOf(ring, signer),
          lands,
          settled: () => {
            syncSpaceRing(ring).catch((error: unknown) => console.warn('[brain] vault sync failed', error));
          },
        });
      }
      else {
        await syncSpaceRing(ring);
        startSync({ spaces, secure: secureOf(ring, signer), lands });
      }
      watchGrants();
    },
    conceal: async () => {
      stopGrantWatch();
      // Сначала снять синк, потом закрыть ленды: пришедшая пачка иначе успела
      // бы влиться в ленд, который уже закрывают.
      stopSync();
      await spaces.seal();
    },
    phraseUnlocked: async (kek, salt) => {
      // Фраза только что открыла данные — KEK в руках: если фразового входа
      // в сейфе нет (стёрт отзывом), вернуть его без лишнего вопроса.
      const space = spaces.space(KEYS_ID);
      const ring = ringNow();
      if (readVault(space).phrase !== null) return;
      publishPhraseWrap(space, await ring.wrapFor(kek, { kind: 'passphrase', label: SPACE_PHRASE_LABEL, salt }), ring.masterId());
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
      if (key === null) throw new Error(`no secret for land "${land.str}" — keyring is incomplete`);
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
  const identity = await deviceIdentity();
  const material = await claimGrant(spaces.space(KEYS_ID), identity);
  if (material === null) throw new Error('no grant issued for this device yet');
  await adoptSpace(material);
  // Грант одноразовый: приняли — погасили, иначе наблюдатель принимал бы его снова.
  clearGrant(need().space(KEYS_ID), encodeBytes(identity.pub));
}

/** Отпечаток нашего мастера — экрану, чтобы отличить «своё пространство» от чужого сейфа. */
export function myMasterId(): string {
  return ringNow().masterId();
}

// ── Гранты — внутренний механизм ─────────────────────────────────────────────
//
// Кнопок «Доверять» и «Присоединиться» больше нет: устройства подключаются
// ссылкой-приглашением или фразой. ECDH-гранты остались для одного случая —
// после отзыва владелец раздаёт живым устройствам НОВЫЙ материал (regrantAll),
// и каждое принимает его само: обёртка адресована нашему ключу и выдана живым
// устройством пространства, которому мы и так доверяем.

let grantWatch: ReturnType<typeof setInterval> | null = null;

function watchGrants(): void {
  stopGrantWatch();
  grantWatch = setInterval(() => {
    void (async () => {
      try {
        if (await pendingGrant()) await joinSpace();
      }
      catch (error) {
        console.warn('[brain] grant claim failed, will retry', error);
      }
    })();
  }, 10_000);
}

function stopGrantWatch(): void {
  if (grantWatch === null) return;
  clearInterval(grantWatch);
  grantWatch = null;
}

/**
 * Подключиться к пространству ОДНОЙ фразой — модель crus: мастер, завёрнутый
 * KEK'ом фразы, и блоб секретов лежат в сейфе ленда `keys`; другое устройство
 * для этого не нужно онлайн. Требуется настроенный синк: сейф приезжает
 * обычной синхронизацией открытого ленда.
 */
export async function joinByPhrase(phrase: string): Promise<void> {
  assertKnownPhrase(phrase);
  const spaces = need();
  const vault = readVault(spaces.space(KEYS_ID));
  if (vault.ring === null) {
    throw new Error('the space vault has not arrived yet — check the sync address and token in Settings');
  }
  if (vault.phrase === null) {
    throw new Error('the vault has no phrase entry — unlock the first device with its phrase once, or re-create the phrase there');
  }
  if (vault.wrapMaster !== vault.ringMaster) {
    throw new Error('the vault halves disagree: the secrets blob was sealed by a different master — open the first device once, it will republish the vault');
  }

  const kek = await kekFromPassphrase(normalizePhrase(phrase), vault.phrase.salt);
  // Неверная фраза честно бьётся об GCM внутри.
  const material = await openSpaceVault(vault.phrase, kek, vault.ring);
  await adoptSpace(material);
}

/**
 * Опубликовать фразовый вход в сейф пространства. Зовётся сразу после
 * создания фразы (`SecurityScreen`): KEK ещё в руках, второй раз фразу не
 * спрашиваем.
 */
export async function publishPhraseAccess(kek: Uint8Array, salt: Uint8Array): Promise<void> {
  const ring = ringNow();
  const wrapped = await ring.wrapFor(kek, { kind: 'passphrase', label: SPACE_PHRASE_LABEL, salt });
  publishPhraseWrap(need().space(KEYS_ID), wrapped, ring.masterId());
}

/** Пригласить устройство: опубликовать приглашение, вернуть одноразовый код. */
export async function createInvite(): Promise<string> {
  return publishInvite(need().space(KEYS_ID), ringNow());
}

/** Погасить действующее приглашение. */
export function dropInvite(): void {
  revokeInvite(need().space(KEYS_ID));
}

/**
 * Принять приглашение из ссылки. Запись едет обычным синком — пока не
 * доехала, честно возвращаем false, вызывающий подождёт и спросит снова.
 */
export async function joinByInvite(code: string): Promise<boolean> {
  const spaces = need();
  const material = await claimInvite(spaces.space(KEYS_ID), code);
  if (material === null) return false;
  await adoptSpace(material);
  // Приглашение одноразовое: приняли — погасили. Мы уже полноправное
  // устройство пространства и вправе писать в ленд `keys`.
  revokeInvite(spaces.space(KEYS_ID));
  return true;
}

/**
 * Принять материал пространства (приглашение, грант после отзыва, фраза):
 * ЗАМЕНИТЬ локальные заготовки — связку, обёртки и данные.
 */
async function adoptSpace(material: SpaceMaterial): Promise<void> {
  const spaces = need();

  stopSync();
  await spaces.seal();
  await spaces.wipe(dataLands);

  const ring = await keyringFromMaterial(material, localStorage);
  // Прежний мастер этой связки больше ничего не значит: локальные обёртки
  // протухли, заворачиваем НОВЫЙ мастер ключом устройства. Passkey и фразу
  // человек добавит заново — честнее, чем молча оставить обёртки-пустышки.
  for (const wrap of listWraps()) dropWrap(wrap.label);
  const kek = await deviceKek();
  if (kek !== null) {
    saveWrap(await ring.wrapFor(kek, { kind: 'device', label: DEVICE_LABEL, salt: new Uint8Array(0) }));
  }
  refreshWraps();
  swapRing(ring);

  // Ленды, которых у пространства ещё нет (новый модуль этой сборки).
  for (const name of dataLands) await ring.ensure(landId(name).str);

  await spaces.unseal(secretsOf(ring));
  const identity = await deviceIdentity();
  announceDevice(spaces.space(KEYS_ID), identity, signerNow().peer.str, deviceLabel());
  // Отозванный когда-то браузер, вернувшийся по приглашению, снова доверен:
  // материал пространства ему выдал владелец, пометка отзыва снимается.
  reviveDevice(spaces.space(KEYS_ID), encodeBytes(identity.pub));
  await publishRing(spaces.space(KEYS_ID), ring, encodeBytes(identity.pub));
  startSync({ spaces, secure: secureOf(ring, signerNow()), lands: [KEYS_ID, ...dataLands] });
}

/**
 * Слить связку с сейфом пространства (зовётся после первого ответа сервера).
 *
 * Кто вправе публиковать блоб: владелец фразы (её мастер — наш) либо, пока
 * фразы нет, СТАРШЕЕ устройство. Устройство, успевшее опубликовать свой блоб
 * до подключения, всегда моложе приглашавших — старший перепубликует и
 * возвращает сейф. Чужое пространство (фраза под чужим мастером, или блоб
 * старшего) не трогаем: ждём приглашения. Отозванные не публикуют вовсе.
 */
async function syncSpaceRing(ring: Keyring): Promise<void> {
  const space = need().space(KEYS_ID);
  const vault = readVault(space);
  const fp = ring.masterId();
  const me = encodeBytes((await deviceIdentity()).pub);

  const owner = vault.phrase === null ? null : vault.wrapMaster === fp;
  if (owner === false) return;

  if (vault.ring === null) {
    await publishRing(space, ring, me);
    return;
  }

  let published: Map<string, Uint8Array>;
  try {
    published = await ring.openBlob(vault.ring);
  }
  catch {
    if (owner === true || isSenior(space, me, vault.ringBy)) {
      await publishRing(space, ring, me);
      return;
    }
    console.warn('[brain] сейф пространства запечатан другим мастером — подключитесь по приглашению');
    return;
  }

  await ring.adopt(published);
  const covered = ring.lands().every(land => published.has(land));
  if (!covered) await publishRing(space, ring, me);
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
export interface RevokeConfirm {
  /** KEK способа доступа, подтверждённого прямо в диалоге отзыва. */
  readonly kek: Uint8Array;
  readonly meta: { kind: WrappedDek['kind']; label: string; salt: Uint8Array };
  /** Нормализованная фраза, если подтверждали ею, — чтобы перевыпустить сейф. */
  readonly phrase?: string;
}

/** Итог отзыва: серверные копии стёрты или остались (тогда — безвредным шифртекстом). */
export interface Revoked {
  readonly serverWiped: boolean;
}

/**
 * Отозвать устройства — одно или сразу несколько ОДНОЙ ротацией: зомби после
 * переустановок копятся пачками, и крутить секреты на каждое было бы
 * издевательством.
 */
export async function revokeDevices(devices: readonly PairedDevice[], confirm?: RevokeConfirm): Promise<Revoked> {
  // Подтверждение проверяется ДО разрушающих шагов: неверная фраза не должна
  // ни ротировать секреты, ни завернуть новый мастер в невоспроизводимый ключ.
  if (confirm !== undefined) {
    const proof = listWraps().find(wrap => wrap.kind === confirm.meta.kind);
    if (proof !== undefined) {
      try {
        (await unlockKeyring(proof, confirm.kek, localStorage)).lock();
      }
      catch {
        throw new Error('the confirmation does not open the master key — check the phrase');
      }
    }
  }
  const spaces = need();
  const ring = ringNow();
  const identity = await deviceIdentity();

  for (const device of devices) markRevoked(spaces.space(KEYS_ID), device);

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
  // Мастер тоже ротируется: отозванный знает старый и открыл бы новый сейф.
  await ring.rotateMaster();
  await rewrapAfterMasterChange(ring, confirm);

  await spaces.unseal(secretsOf(ring));
  for (const [name, { pack }] of kept) {
    const land = spaces.landOf(name);
    for (const [, part] of packDecode(pack)) {
      if (part.units.length > 0) land.apply(part.units, part.balls);
    }
  }

  await regrantAll(spaces.space(KEYS_ID), ring, identity);
  await publishRing(spaces.space(KEYS_ID), ring, encodeBytes(identity.pub));
  // Фразовая обёртка мастера в сейфе — под СТАРЫМ мастером: либо перевыпуск
  // той же фразой (подтверждена в диалоге), либо честное «пересоздайте фразу».
  if (confirm?.phrase !== undefined) {
    const vault = readVault(spaces.space(KEYS_ID));
    const salt = vault.phrase?.salt ?? confirm.meta.salt;
    const kek = await kekFromPassphrase(confirm.phrase, salt);
    await publishPhraseAccess(kek, salt);
  }
  else {
    clearPhraseWrap(spaces.space(KEYS_ID));
  }
  // Серверные копии под старыми секретами — мусор, который все пиры и так
  // пропускают (openPack с onDrop). Не стёрлись — отзыв всё равно состоялся:
  // синк обязан подняться, иначе даже пометка отзыва не уедет с устройства.
  let serverWiped = true;
  try {
    await wipeServerLands();
  }
  catch (error) {
    serverWiped = false;
    console.warn('[brain] server copies were not wiped after revocation', error);
  }
  startSync({ spaces, secure: secureOf(ring, signerNow()), lands: [KEYS_ID, ...dataLands] });
  return { serverWiped };
}

/**
 * После смены мастера все локальные обёртки протухли. Молча пересоздать можно
 * только обёртку ключа устройства; способ, который спрашивает человека,
 * обязан быть подтверждён в диалоге отзыва (`confirm`).
 */
async function rewrapAfterMasterChange(ring: Keyring, confirm?: RevokeConfirm): Promise<void> {
  const wraps = listWraps();
  const keyed = wraps.some(wrap => wrap.kind !== 'device');
  const hadDevice = wraps.some(wrap => wrap.kind === 'device');
  // Подтверждение нужно только с включённым замком: без тихого ключа новый
  // мастер иначе не завернуть ничем. С выключенным — мастер уезжает под ключ
  // устройства, а протухшие passkey/фразу человек заводит заново.
  if (keyed && confirm === undefined && !hadDevice) {
    throw new Error('confirm an access method to re-wrap the new master key');
  }
  for (const wrap of wraps) dropWrap(wrap.label);
  if (confirm !== undefined) saveWrap(await ring.wrapFor(confirm.kek, confirm.meta));
  // Тихий путь сохраняется таким, каким был: замок — отдельный выбор
  // (`setGuarded`), и отзыв чужого устройства его не трогает.
  if (hadDevice || confirm === undefined) {
    const kek = await deviceKek();
    if (kek === null && confirm === undefined) {
      throw new Error('device key is unavailable: cannot re-wrap the master key');
    }
    if (kek !== null) {
      saveWrap(await ring.wrapFor(kek, { kind: 'device', label: DEVICE_LABEL, salt: new Uint8Array(0) }));
    }
  }
  refreshWraps();
}

/** Стереть серверные копии лендов данных — перед перезаливкой перепечатанного. */
async function wipeServerLands(): Promise<void> {
  const settings = loadSyncSettings();
  // Выключатель синка — токен; пустой адрес означает «этот же origin», и
  // относительный URL ниже как раз туда и пойдёт.
  if (!syncConfigured(settings)) return;
  for (const name of dataLands) {
    const at = `${settings.url}/lands/${landId(name).str}`;
    const response = await fetch(at, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${settings.token}` },
    });
    if (!response.ok) {
      throw new Error(`server did not wipe land "${name}": ${response.status} — revocation incomplete, retry`);
    }
  }
}

/** Ждёт ли нас грант в ленде (материал после отзыва). */
async function pendingGrant(): Promise<boolean> {
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
  if (spacesRef === null) throw new Error('app is not assembled yet');
  return spacesRef;
}

function ringNow(): Keyring {
  const ring = currentKeyring();
  if (ring === null) throw new Error('keyring is locked');
  return ring;
}

function signerNow(): Signer {
  if (signerRef === null) throw new Error('signer is not ready');
  return signerRef;
}
