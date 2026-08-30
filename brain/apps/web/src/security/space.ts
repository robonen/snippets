import { packDecode, packEncode } from '@sync/core';
import { landId } from '@brain/module-kit';
import { useIntervalFn } from '@robonen/vue';
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
import type { LandId, Roster, SecretRing, Signer } from '@sync/core';
import type { Spaces } from '@brain/module-kit';
import type { Keyring, SpaceMaterial, WrappedDek } from '@brain/auth';
import { loadSyncSettings, startSync, stopSync, syncConfigured } from '@/sync';
import { DEVICE_LABEL, currentKeyring, refreshWraps, swapRing } from './lock';
import { dropWrap, listWraps, saveWrap } from './keys';
import { deviceIdentity, deviceLabel } from './identity';
import { KEYS_ID, announceDevice, isSenior, livePeers, markRevoked, reviveDevice } from './keys-land';
import type { PairedDevice } from './keys-land';
import { SPACE_PHRASE_LABEL, clearPhraseWrap, publishPhraseWrap, publishRing, readVault } from './vault';
import { claimInvite, publishInvite, revokeInvite } from './invites';
import { claimGrant, clearGrant, regrantAll } from './grants';
import { makeSecure, ownerRoster } from './signing';

/**
 * Оркестровка пространства: единственное место, где криптография соседних
 * модулей (сейф, приглашения, гранты) встречается с лендами и синком.
 *
 * Порядок шагов здесь несущий — между «пометить отзыв» и «раздать новые
 * секреты» лежит перезапуск лендов, между «принять материал» и «объявиться» —
 * замена связки. Поэтому модули ниже по стеку (`vault.ts`, `invites.ts`,
 * `grants.ts`) правил не знают: каждый делает одну криптографическую вещь, а
 * последовательность собирается тут.
 *
 * Сборка (`app/boot.ts`) один раз отдаёт ленды и подписанта через
 * `assembleSpace` и дальше только транслирует сигналы замка.
 */

interface Assembly {
  readonly spaces: Spaces;
  readonly signer: Signer;
  /** Ленды с данными пользователя. Служебный `keys` — отдельно: он открытый. */
  readonly dataLands: readonly string[];
}

let assembly: Assembly | null = null;

/** Принять собранные ленды и подписанта. Зовётся один раз на запуск. */
export function assembleSpace(next: Assembly): void {
  assembly = next;
}

// ── Сигналы замка ────────────────────────────────────────────────────────────

/**
 * Связка получена: поднять ленды и занять своё место в пространстве.
 *
 * Устройство НЕ объявляет себя и не публикует связку, пока не выяснит, что оно
 * в пространстве: до первого ответа сервера локальный ленд пуст, и «сейфа
 * нет — я основатель» перетирало бы чужой сейф свежим мастером, а запись
 * устройства плодила бы зомби в чужом списке. До ответа синхронизируется
 * только `keys` — ленд приглашений и сейфа: чужие данные устройству вне
 * пространства ни к чему, а свои заготовки — серверу.
 */
export async function revealSpace(ring: Keyring): Promise<void> {
  const { spaces, signer, dataLands } = need();
  // Секреты — ДО подъёма: sealedStore спрашивает связку на первом же load.
  for (const name of dataLands) await ring.ensure(landId(name).str);
  await spaces.unseal(secretsOf(ring));

  if (syncConfigured(loadSyncSettings())) {
    startSync({
      spaces,
      secure: secureOf(ring, signer),
      lands: [KEYS_ID],
      settled: () => {
        settleSpace(ring).catch((error: unknown) => console.warn('[brain] vault sync failed', error));
      },
    });
  }
  else {
    // Без сервера спорить не с кем: устройство — само себе пространство.
    await settleSpace(ring);
  }
  grantWatch.resume();
}

/** Замок закрывается: убрать открытое из памяти вкладки. */
export async function concealSpace(): Promise<void> {
  grantWatch.pause();
  // Сначала снять синк, потом закрыть ленды: пришедшая пачка иначе успела бы
  // влиться в ленд, который уже закрывают.
  stopSync();
  await need().spaces.seal();
}

/**
 * Фраза только что открыла данные — KEK в руках: если фразового входа в сейфе
 * нет (стёрт отзывом), вернуть его без лишнего вопроса.
 */
export async function healPhraseEntry(kek: Uint8Array, salt: Uint8Array): Promise<void> {
  const space = need().spaces.space(KEYS_ID);
  const ring = ringNow();
  if (readVault(space).phrase !== null) return;
  publishPhraseWrap(space, await ring.wrapFor(kek, { kind: 'passphrase', label: SPACE_PHRASE_LABEL, salt }), ring.masterId());
}

// ── Крипто-политика ──────────────────────────────────────────────────────────

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
  // Фабрика ростера: зовётся один раз на кадр (контракт makeSecure), поэтому
  // «доверил устройство или отозвал» проверка видит без перезапуска синка, а
  // список устройств из CRDT не перечитывается на каждый lookup пира.
  const roster = (): Roster => ownerRoster(livePeers(need().spaces.space(KEYS_ID)));
  return makeSecure(secretsOf(ring), signer, roster, landId(KEYS_ID).str);
}

// ── Место в пространстве ─────────────────────────────────────────────────────

/**
 * Занять своё место — после первого ответа сервера (или сразу, если сервера
 * нет). Три исхода:
 *
 *   основатель  — сейфа нет: объявиться, опубликовать связку;
 *   член        — блоб открывается нашим мастером (или наш мастер под фразой,
 *                 или мы старше публикатора чужого блоба): объявиться, слить
 *                 связку, при нужде перепубликовать;
 *   чужой       — ни записи, ни публикации: устройство ждёт приглашения и
 *                 синхронизирует только `keys`.
 *
 * Только член поднимает синк лендов данных: чужие юниты устройству вне
 * пространства не открыть, а свои заготовки серверу не нужны.
 */
async function settleSpace(ring: Keyring): Promise<void> {
  const { spaces, signer, dataLands } = need();
  const space = spaces.space(KEYS_ID);
  const vault = readVault(space);
  const fp = ring.masterId();
  const identity = await deviceIdentity();
  const me = encodeBytes(identity.pub);

  const owner = vault.phrase === null ? null : vault.wrapMaster === fp;
  if (owner === false) return;

  const join = async (): Promise<void> => {
    announceDevice(space, identity, signer.peer.str, deviceLabel());
    startSync({ spaces, secure: secureOf(ring, signer), lands: [KEYS_ID, ...dataLands] });
  };

  if (vault.ring === null) {
    // Основатель. Сначала запись устройства: старшинство считается по ней.
    await join();
    await publishRing(space, ring, me);
    return;
  }

  let published: Map<string, Uint8Array>;
  try {
    published = await ring.openBlob(vault.ring);
  }
  catch {
    if (owner === true || isSenior(space, me, vault.ringBy)) {
      // Наш сейф с чужим блобом (успела старая сборка или неподключённое
      // устройство): владелец или старший перепубликует — сейф возвращается.
      await join();
      await publishRing(space, ring, me);
      return;
    }
    console.warn('[brain] это устройство не в пространстве: сейф запечатан другим мастером — подключитесь по приглашению');
    return;
  }

  await join();
  await ring.adopt(published);
  const covered = ring.lands().every(land => published.has(land));
  if (!covered) await publishRing(space, ring, me);
}

/** Отпечаток нашего мастера — экрану, чтобы отличить «своё пространство» от чужого сейфа. */
export function myMasterId(): string {
  return ringNow().masterId();
}

// ── Подключение ──────────────────────────────────────────────────────────────

/** Пригласить устройство: опубликовать приглашение, вернуть одноразовый код. */
export async function createInvite(): Promise<string> {
  return publishInvite(need().spaces.space(KEYS_ID), ringNow());
}

/** Погасить действующее приглашение. */
export function dropInvite(): void {
  revokeInvite(need().spaces.space(KEYS_ID));
}

/**
 * Принять приглашение из ссылки. Запись едет обычным синком — пока не
 * доехала, честно возвращаем false, вызывающий подождёт и спросит снова.
 */
export async function joinByInvite(code: string): Promise<boolean> {
  const spaces = need().spaces;
  const material = await claimInvite(spaces.space(KEYS_ID), code);
  if (material === null) return false;
  await adoptSpace(material);
  // Приглашение одноразовое: приняли — погасили. Мы уже полноправное
  // устройство пространства и вправе писать в ленд `keys`.
  revokeInvite(spaces.space(KEYS_ID));
  return true;
}

/**
 * Подключиться к пространству ОДНОЙ фразой — модель crus: мастер, завёрнутый
 * KEK'ом фразы, и блоб секретов лежат в сейфе ленда `keys`; другое устройство
 * для этого не нужно онлайн. Требуется настроенный синк: сейф приезжает
 * обычной синхронизацией открытого ленда.
 */
export async function joinByPhrase(phrase: string): Promise<void> {
  assertKnownPhrase(phrase);
  const vault = readVault(need().spaces.space(KEYS_ID));
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
 * создания фразы: KEK ещё в руках, второй раз фразу не спрашиваем.
 */
export async function publishPhraseAccess(kek: Uint8Array, salt: Uint8Array): Promise<void> {
  const ring = ringNow();
  const wrapped = await ring.wrapFor(kek, { kind: 'passphrase', label: SPACE_PHRASE_LABEL, salt });
  publishPhraseWrap(need().spaces.space(KEYS_ID), wrapped, ring.masterId());
}

/**
 * Принять материал пространства (приглашение, грант после отзыва, фраза):
 * ЗАМЕНИТЬ локальные заготовки — связку, обёртки и данные. UI обязан
 * предупредить об этом до вызова.
 */
async function adoptSpace(material: SpaceMaterial): Promise<void> {
  const { spaces, signer, dataLands } = need();

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
  announceDevice(spaces.space(KEYS_ID), identity, signer.peer.str, deviceLabel());
  // Отозванный когда-то браузер, вернувшийся по приглашению, снова доверен:
  // материал пространства ему выдал владелец, пометка отзыва снимается.
  reviveDevice(spaces.space(KEYS_ID), encodeBytes(identity.pub));
  await publishRing(spaces.space(KEYS_ID), ring, encodeBytes(identity.pub));
  startSync({ spaces, secure: secureOf(ring, signer), lands: [KEYS_ID, ...dataLands] });
}

// ── Гранты после отзыва ──────────────────────────────────────────────────────
//
// Кнопок «Доверять» и «Присоединиться» нет: устройства подключаются ссылкой
// или фразой. Гранты остались для одного случая — после отзыва владелец
// раздаёт живым устройствам НОВЫЙ материал, и каждое принимает его само:
// обёртка адресована нашему ключу и выдана устройством, которому мы доверяем.

const grantWatch = useIntervalFn(() => {
  void adoptPendingGrant();
}, 10_000, { immediate: false });

async function adoptPendingGrant(): Promise<void> {
  const spaces = assembly?.spaces;
  if (spaces === undefined || !spaces.open) return;
  try {
    const identity = await deviceIdentity();
    const material = await claimGrant(spaces.space(KEYS_ID), identity);
    if (material === null) return;
    await adoptSpace(material);
    // Грант одноразовый: приняли — погасили, иначе наблюдатель принимал бы его снова.
    clearGrant(need().spaces.space(KEYS_ID), encodeBytes(identity.pub));
  }
  catch (error) {
    console.warn('[brain] grant claim failed, will retry', error);
  }
}

// ── Отзыв ────────────────────────────────────────────────────────────────────

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
 * издевательством. Порядок несущий:
 *
 *   1. пометить отзыв и забрать обёртки (ещё под старыми секретами — уедут);
 *   2. снять данные в память ОТКРЫТЫМИ, погасить синк;
 *   3. стереть носитель, перевыпустить секреты и мастер;
 *   4. поднять ленды заново — те же данные запечатываются новыми секретами;
 *   5. выдать новые секреты живым устройствам; серверные копии стереть —
 *      следующий привет зальёт перепечатанное с нуля.
 *
 * Отозванное устройство сохраняет то, что УСПЕЛО прочитать, — отобрать
 * прочитанное не может никакая криптография. Новые правки ему недоступны.
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
  const { spaces, signer, dataLands } = need();
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
  startSync({ spaces, secure: secureOf(ring, signer), lands: [KEYS_ID, ...dataLands] });
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
  for (const name of need().dataLands) {
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

// ── Служебное ────────────────────────────────────────────────────────────────

function need(): Assembly {
  if (assembly === null) throw new Error('app is not assembled yet');
  return assembly;
}

function ringNow(): Keyring {
  const ring = currentKeyring();
  if (ring === null) throw new Error('keyring is locked');
  return ring;
}
