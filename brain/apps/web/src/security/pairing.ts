import { Link, atom, identityOf, mintExchangePair, model, parts, t } from '@sync/core';
import { decodeBytes, decodeGrant, encodeBytes } from '@brain/auth';
import type { Doc, ExchangeAlgo, Identity, Space, SubtleKeyPair } from '@sync/core';
import type { Keyring, Sealed, SpaceMaterial, WrappedDek } from '@brain/auth';

/**
 * Подключение устройств: секреты лендов едут ВНУТРИ пространства.
 *
 * Служебный ленд `keys` — единственный ОТКРЫТЫЙ (связка отдаёт для него
 * `null`, и ядро везёт его как есть). В нём два вида записей:
 *
 *   устройство — публичная половина ECDH-пары (X25519/P-256) плюс имя;
 *   обёртка    — связка секретов, зашифрованная ВЗАИМНЫМ ключом пары
 *                «датель ↔ получатель» (AES-GCM поверх ECDH+HKDF).
 *
 * Сервер видит этот ленд целиком — и не видит в нём ничего полезного: публичные
 * ключи публичны, а обёртку открывают только приватные половины двух устройств,
 * которые сервера не покидали никогда. Это тот же довод, что у прежних обёрток
 * в открытом мета-ленде («секрета в них нет»), только теперь он работает и на
 * доставку между устройствами: обёртка едет обычным синком, отдельного
 * `/account/wraps` не существует.
 *
 * Протокольные gift-юниты (`@sync/core` формат) остаются целевой формой на
 * стадии подписей: там та же криптография ляжет в 48 байт юнита. Сегодняшний
 * ленд — то же самое средствами слоя моделей, без правок горячего пути ядра.
 *
 * ─── Поток подключения ───────────────────────────────────────────────────────
 *
 *   новое устройство   объявляется в `keys` (свой pub) и ждёт;
 *   старое устройство  видит запись, человек сверяет отпечатки на обоих
 *                      экранах, жмёт «Доверять» — обёртка уезжает в ленд;
 *   новое устройство   видит обёртку, снимает её взаимным ключом, ЗАМЕНЯЕТ
 *                      свои секреты и данные пространством (см. `claimGrant`).
 *
 * Оба устройства онлайн одновременно — суть, а не недостаток: сервер выдать
 * доступ не может по построению.
 */

export const KEYS_ID = 'keys';

export const DeviceModel = model('keys/device', {
  /** Человеку: «телефон», «рабочий ноутбук». */
  label: atom(t.string),
  algo: atom(t.enum(['x25519', 'p256'] as const).or('x25519')),
  /** base64url сырого публичного ключа ECDH. Он же — id записи. */
  pub: atom(t.string),
  /**
   * Подписной `peer` устройства (канонический текст ссылки, 11 симв.) — SHA-256
   * от его ключа ПОДПИСИ и он же адрес устройства в лендах. Из него строится
   * ростер прав: живое устройство доверено, отозванное — нет.
   */
  signPeer: atom(t.string),
  addedAt: atom(t.number),
  /** Ноль — устройство живо. Метка, а не удаление: отзыв должен быть виден. */
  revokedAt: atom(t.number),
});

export const GrantModel = model('keys/grant', {
  /** Получатель: base64url его публичного ключа. Он же — id записи. */
  to: atom(t.string),
  /** Датель: по его публичному ключу получатель выводит взаимный ключ. */
  from: atom(t.string),
  nonce: atom(t.string),
  cipher: atom(t.string),
  at: atom(t.number),
});

/**
 * Сейф пространства (модель crus: зашифрованный ключ хранится в базе, вход —
 * паролем). Обе записи — шифртекст, в открытом ленде им ничего не грозит:
 *
 *   `salt/nonce/cipher`     — МАСТЕР, завёрнутый KEK'ом фразы восстановления:
 *                             второе устройство подключается одной фразой,
 *                             первое для этого не нужно онлайн;
 *   `ringNonce/ringCipher`  — секреты лендов, запечатанные мастером: связка —
 *                             синхронизируемое состояние пространства, секрет
 *                             нового ленда доезжает до всех устройств сам.
 */
export const VaultModel = model('keys/vault', {
  salt: atom(t.string),
  nonce: atom(t.string),
  cipher: atom(t.string),
  /** Отпечаток мастера под фразовой обёрткой (Keyring.masterId, не секрет). */
  wrapMaster: atom(t.string),
  ringNonce: atom(t.string),
  ringCipher: atom(t.string),
  /** Отпечаток мастера, запечатавшего блоб. Обязан совпадать с wrapMaster. */
  ringMaster: atom(t.string),
  /** Кто опубликовал блоб (pub устройства): спор о сейфе решает старшинство. */
  ringBy: atom(t.string),
  at: atom(t.number),
});

/**
 * Приглашение устройства ссылкой: материал пространства (грант v2), запечатанный
 * одноразовым 16-байтовым кодом. Код живёт ТОЛЬКО в URL-фрагменте ссылки —
 * фрагмент не уходит на сервер, а запись в ленде без кода бесполезна.
 */
export const InviteModel = model('keys/invite', {
  nonce: atom(t.string),
  cipher: atom(t.string),
  at: atom(t.number),
});

export const KeysModel = model('keys/root', {
  devices: parts(t.string, 'keys/device'),
  grants: parts(t.string, 'keys/grant'),
  vault: parts(t.string, 'keys/vault'),
  invites: parts(t.string, 'keys/invite'),
});

declare module '@sync/core' {
  interface Models {
    'keys/device': typeof DeviceModel;
    'keys/grant': typeof GrantModel;
    'keys/vault': typeof VaultModel;
    'keys/invite': typeof InviteModel;
    'keys/root': typeof KeysModel;
  }
}

/** Запись сейфа одна на пространство. */
const VAULT_ID = 'space';
/** Метка фразовой обёртки мастера: AAD `wrapDek` привязывает kind и label. */
export const SPACE_PHRASE_LABEL = 'space';

const GRANT_AAD = 'brain/pair/v1';

/** Запись приглашения одна на пространство: новая гасит старую. */
const INVITE_ID = 'open';
const INVITE_AAD = 'brain/invite/v1';
/** Сколько живёт приглашение. Сутки: хватает переслать себе, мало — злоумышленнику из бэкапа переписки. */
const INVITE_TTL = 24 * 60 * 60 * 1000;

function inviteKey(code: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', code.slice().buffer as ArrayBuffer, 'AES-GCM', false, usage);
}

/**
 * Опубликовать приглашение. Возвращает КОД (base64url) — он показывается один
 * раз в составе ссылки и больше нигде не хранится.
 */
export async function publishInvite(space: Space, ring: Keyring): Promise<string> {
  const code = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const blob = ring.exportForGrant();
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(INVITE_AAD) },
    await inviteKey(code, ['encrypt']),
    blob.slice().buffer as ArrayBuffer,
  ));

  const root = space.root(KeysModel);
  space.edit(() => {
    const doc = root.invites(INVITE_ID);
    doc.nonce(encodeBytes(nonce));
    doc.cipher(encodeBytes(cipher));
    doc.at(Date.now());
  });
  return encodeBytes(code);
}

/** Активно ли приглашение — для карточки. `null` — нет либо погашено. */
export function readInvite(space: Space): { at: number } | null {
  const root = space.root(KeysModel);
  if (!root.invites.has(INVITE_ID)) return null;
  const doc = root.invites(INVITE_ID);
  return doc.cipher() === '' ? null : { at: doc.at() };
}

/** Погасить приглашение: после этого запись — пустышка даже с кодом на руках. */
export function revokeInvite(space: Space): void {
  const root = space.root(KeysModel);
  if (!root.invites.has(INVITE_ID)) return;
  space.edit(() => {
    const doc = root.invites(INVITE_ID);
    doc.nonce('');
    doc.cipher('');
  });
}

/**
 * Принять приглашение кодом из ссылки. `null` — записи ещё нет: она едет
 * обычным синком, вызывающий подождёт и спросит снова.
 */
export async function claimInvite(space: Space, code: string): Promise<SpaceMaterial | null> {
  const root = space.root(KeysModel);
  if (!root.invites.has(INVITE_ID)) return null;
  const doc = root.invites(INVITE_ID);
  if (doc.cipher() === '') return null;
  if (Date.now() - doc.at() > INVITE_TTL) {
    throw new Error('the invite has expired — create a new one on the first device');
  }

  let blob: ArrayBuffer;
  try {
    blob = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: decodeBytes(doc.nonce()).slice().buffer as ArrayBuffer,
        additionalData: new TextEncoder().encode(INVITE_AAD),
      },
      await inviteKey(decodeBytes(code), ['decrypt']),
      decodeBytes(doc.cipher()).slice().buffer as ArrayBuffer,
    );
  }
  catch (cause) {
    throw new Error('the invite code does not match — the link is stale or truncated', { cause });
  }
  return decodeGrant(new Uint8Array(blob));
}

// ── ECDH-пара устройства ─────────────────────────────────────────────────────
//
// Живёт в той же базе, что ключ устройства (`@brain/auth` device.ts): приватная
// половина — неизвлекаемый CryptoKey, структурным клоном в IndexedDB.

const DB_NAME = 'brain-device';
const STORE = 'keys';
const PAIR_KEY = 'exchange/v1';

interface StoredPair {
  readonly algo: ExchangeAlgo;
  readonly pair: SubtleKeyPair;
}

export async function deviceIdentity(): Promise<Identity> {
  const db = await openDb();
  try {
    const found = await ask<StoredPair | null | undefined>(
      db.transaction(STORE, 'readonly').objectStore(STORE).get(PAIR_KEY),
    );
    // WebKit отдаёт null вместо undefined, а битая запись приходит без
    // половины полей: всё, что не похоже на пару, чеканится заново.
    if (found !== undefined && found !== null && found.pair !== undefined && found.pair !== null) {
      return identityOf(found.algo, found.pair);
    }

    const fresh = await mintExchangePair();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ algo: fresh.algo, pair: fresh.pair } satisfies StoredPair, PAIR_KEY);
    await ended(tx);
    return identityOf(fresh.algo, fresh.pair);
  }
  finally {
    db.close();
  }
}

// ── Записи в ленде ───────────────────────────────────────────────────────────

export interface PairedDevice {
  readonly pub: string;
  readonly label: string;
  readonly algo: ExchangeAlgo;
  readonly signPeer: string;
  readonly addedAt: number;
  readonly revoked: boolean;
}

export function listDevices(space: Space): PairedDevice[] {
  const root = space.root(KeysModel);
  return root.devices.keys().map((pub) => {
    const doc = root.devices(pub);
    return {
      pub,
      label: doc.label(),
      algo: doc.algo(),
      signPeer: doc.signPeer(),
      addedAt: doc.addedAt(),
      revoked: doc.revokedAt() > 0,
    };
  }).sort((a, b) => a.addedAt - b.addedAt);
}

/** Живые подписные peer'ы — из них строится ростер прав (см. `security/signing`). */
export function livePeers(space: Space): Link[] {
  const root = space.root(KeysModel);
  const out: Link[] = [];
  for (const pub of root.devices.keys()) {
    const doc = root.devices(pub);
    if (doc.revokedAt() > 0) continue;
    const signPeer = doc.signPeer();
    if (signPeer !== '') out.push(Link.parse(signPeer));
  }
  return out;
}

/**
 * Объявить себя в пространстве. Идемпотентно по ECDH-ключу, но подписной peer
 * дописывается всегда: старые записи (до подписей) его не несли.
 */
export function announceDevice(space: Space, identity: Identity, signPeer: string, label: string): void {
  const pub = encodeBytes(identity.pub);
  const root = space.root(KeysModel);
  space.edit(() => {
    const doc = root.devices(pub);
    if (doc.addedAt() === 0) {
      doc.label(label);
      doc.algo(identity.algo);
      doc.pub(pub);
      doc.addedAt(Date.now());
    }
    if (doc.signPeer() !== signPeer) doc.signPeer(signPeer);
  });
}

/**
 * Снять пометку отзыва с СЕБЯ после честного повторного подключения. Запись
 * устройства хранится по ECDH-ключу, и без этого браузер, однажды отозванный,
 * оставался бы «отозванным» навсегда — даже войдя по свежему приглашению.
 * Право на жест доказывает сам материал пространства: его выдал владелец.
 */
export function reviveDevice(space: Space, pub: string): void {
  const root = space.root(KeysModel);
  if (!root.devices.has(pub)) return;
  const doc = root.devices(pub);
  if (doc.revokedAt() === 0) return;
  space.edit(() => {
    doc.revokedAt(0);
    doc.addedAt(Date.now());
  });
}

/**
 * Отпечаток для сверки на двух экранах: восемь слов не нужно — хватает восьми
 * символов base64url публичного ключа, они и так на обоих устройствах.
 */
export function fingerprint(pub: string): string {
  return `${pub.slice(0, 4)}-${pub.slice(4, 8)}`.toLowerCase();
}

// ── Сейф пространства ────────────────────────────────────────────────────────

/** Опубликовать связку: секреты под мастером. Зовётся после каждого изменения. */
export async function publishRing(space: Space, ring: Keyring, by: string): Promise<void> {
  const sealed = await ring.sealedSecrets();
  const root = space.root(KeysModel);
  space.edit(() => {
    const doc = root.vault(VAULT_ID);
    doc.ringNonce(encodeBytes(sealed.nonce));
    doc.ringCipher(encodeBytes(sealed.cipher));
    doc.ringMaster(ring.masterId());
    doc.ringBy(by);
    doc.at(Date.now());
  });
}

/** Опубликовать мастер под KEK'ом фразы — вход в пространство одной фразой. */
export function publishPhraseWrap(space: Space, wrapped: WrappedDek, masterId: string): void {
  const root = space.root(KeysModel);
  space.edit(() => {
    const doc = root.vault(VAULT_ID);
    doc.salt(encodeBytes(wrapped.salt));
    doc.nonce(encodeBytes(wrapped.nonce));
    doc.cipher(encodeBytes(wrapped.cipher));
    doc.wrapMaster(masterId);
    doc.at(Date.now());
  });
}

/** Стереть фразовую обёртку — после смены мастера она открывала бы пустоту. */
export function clearPhraseWrap(space: Space): void {
  const root = space.root(KeysModel);
  if (!root.vault.has(VAULT_ID)) return;
  space.edit(() => {
    const doc = root.vault(VAULT_ID);
    doc.salt('');
    doc.nonce('');
    doc.cipher('');
    doc.wrapMaster('');
  });
}

export interface SpaceVault {
  /** Мастер под KEK'ом фразы. `null` — фразовый вход не опубликован. */
  readonly phrase: WrappedDek | null;
  /** Секреты под мастером. `null` — связку ещё не публиковали. */
  readonly ring: Sealed | null;
  /** Отпечатки мастеров половин сейфа. Пустая строка — половины ещё нет. */
  readonly wrapMaster: string;
  readonly ringMaster: string;
  /** pub устройства, опубликовавшего блоб. Пусто — блоба нет. */
  readonly ringBy: string;
}

export function readVault(space: Space): SpaceVault {
  const root = space.root(KeysModel);
  if (!root.vault.has(VAULT_ID)) return { phrase: null, ring: null, wrapMaster: '', ringMaster: '', ringBy: '' };
  const doc = root.vault(VAULT_ID);
  const phrase: WrappedDek | null = doc.cipher() === ''
    ? null
    : {
        kind: 'passphrase',
        label: SPACE_PHRASE_LABEL,
        salt: decodeBytes(doc.salt()),
        nonce: decodeBytes(doc.nonce()),
        cipher: decodeBytes(doc.cipher()),
      };
  const ring: Sealed | null = doc.ringCipher() === ''
    ? null
    : { nonce: decodeBytes(doc.ringNonce()), cipher: decodeBytes(doc.ringCipher()) };
  return { phrase, ring, wrapMaster: doc.wrapMaster(), ringMaster: doc.ringMaster(), ringBy: doc.ringBy() };
}

/**
 * Старше ли устройство `mine` устройства `other` — спор о сейфе без фразы.
 * Старшинство — по времени появления в пространстве: устройство, успевшее
 * опубликовать блоб до подключения, всегда моложе тех, кто его приглашал.
 * Отозванное не старше никого; неизвестное — тоже.
 */
export function isSenior(space: Space, mine: string, other: string): boolean {
  const root = space.root(KeysModel);
  if (mine === other || !root.devices.has(mine) || !root.devices.has(other)) return false;
  const me = root.devices(mine);
  const them = root.devices(other);
  if (me.revokedAt() > 0) return false;
  if (them.revokedAt() > 0) return true;
  return me.addedAt() < them.addedAt();
}

/** Доверить устройству пространство: завернуть секреты связки взаимным ключом. */
export async function grantTo(
  space: Space,
  ring: Keyring,
  identity: Identity,
  device: PairedDevice,
): Promise<void> {
  const mutual = await identity.mutualSealed(device.algo, decodeBytes(device.pub));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`${GRANT_AAD}:${device.pub}:${encodeBytes(identity.pub)}`);
  const blob = ring.exportForGrant();
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad },
    mutual,
    blob.slice().buffer as ArrayBuffer,
  ));

  const root = space.root(KeysModel);
  space.edit(() => {
    const doc = root.grants(device.pub);
    doc.to(device.pub);
    doc.from(encodeBytes(identity.pub));
    doc.nonce(encodeBytes(nonce));
    doc.cipher(encodeBytes(cipher));
    doc.at(Date.now());
  });
}

/**
 * Обёртка для НАС уже в ленде? Снять её и вернуть секреты пространства.
 * `null` — ещё не выдана. Замену данных проводит вызывающий (`joinSpace` в
 * `app/boot.ts`): здесь только криптография.
 */
export async function claimGrant(
  space: Space,
  identity: Identity,
): Promise<SpaceMaterial | null> {
  const myPub = encodeBytes(identity.pub);
  const root = space.root(KeysModel);
  if (!root.grants.has(myPub)) return null;

  const doc: Doc<'keys/grant'> = root.grants(myPub);
  // Погашенный (принятый) грант — пустышка.
  if (doc.cipher() === '') return null;
  const fromPub = doc.from();
  const from = root.devices.has(fromPub) ? root.devices(fromPub) : null;
  if (from === null || from.revokedAt() > 0) return null;

  const mutual = await identity.mutualSealed(from.algo(), decodeBytes(fromPub));
  const aad = new TextEncoder().encode(`${GRANT_AAD}:${myPub}:${fromPub}`);
  const blob = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBytes(doc.nonce()).slice().buffer as ArrayBuffer, additionalData: aad },
    mutual,
    decodeBytes(doc.cipher()).slice().buffer as ArrayBuffer,
  );
  return decodeGrant(new Uint8Array(blob));
}

/** Погасить принятый грант: он одноразовый, принимать его дважды незачем. */
export function clearGrant(space: Space, myPub: string): void {
  const root = space.root(KeysModel);
  if (!root.grants.has(myPub)) return;
  space.edit(() => {
    const doc = root.grants(myPub);
    doc.nonce('');
    doc.cipher('');
  });
}

/**
 * Первая половина отзыва: пометить устройство и забрать его обёртку.
 *
 * Перевыпуск секретов, перепечатка лендов и повторные обёртки живым
 * устройствам — у вызывающего (`app/boot.ts`, `revokeDevice`): порядок там
 * несущий, между шагами лежит перезапуск лендов.
 */
export function markRevoked(space: Space, device: PairedDevice): void {
  const root = space.root(KeysModel);
  space.edit(() => {
    root.devices(device.pub).revokedAt(Date.now());
    root.grants.delete(device.pub);
  });
}

/** Вторая половина: выдать ПЕРЕВЫПУЩЕННЫЕ секреты всем живым устройствам заново. */
export async function regrantAll(space: Space, ring: Keyring, identity: Identity): Promise<void> {
  const myPub = encodeBytes(identity.pub);
  for (const peer of listDevices(space)) {
    if (peer.pub === myPub || peer.revoked) continue;
    await grantTo(space, ring, identity, peer);
  }
}

// ── Мелкий IndexedDB-край (тот же, что у @brain/auth device.ts) ──────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (): void => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = (): void => done(request.result);
    request.onerror = (): void => fail(request.error ?? new Error('IndexedDB rejected opening'));
  });
}

function ask<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((done, fail) => {
    request.onsuccess = (): void => done(request.result);
    request.onerror = (): void => fail(request.error ?? new Error('IndexedDB request rejected'));
  });
}

function ended(tx: IDBTransaction): Promise<void> {
  return new Promise((done, fail) => {
    tx.oncomplete = (): void => done();
    tx.onerror = (): void => fail(tx.error ?? new Error('IndexedDB transaction rejected'));
    tx.onabort = (): void => fail(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}
