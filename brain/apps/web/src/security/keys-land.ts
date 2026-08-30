import { Link, atom, model, parts, t } from '@sync/core';
import { encodeBytes } from '@brain/auth';
import type { ExchangeAlgo, Identity, Space } from '@sync/core';

/**
 * Ленд `keys` — корень доверия пространства и единственный ОТКРЫТЫЙ ленд:
 * связка отдаёт для него `null`, ядро везёт его как есть, подписи на него не
 * ставятся (ленд, задающий ростер, не может требовать ростер для себя).
 *
 * Что в нём лежит и чем защищено:
 *
 *   устройства   — публичные ECDH-ключи, имена, подписные peer'ы, отзыв.
 *                  Секретов нет; из живых записей строится ростер прав;
 *   сейф         — связка секретов под мастером и мастер под фразой (`vault.ts`);
 *   приглашения  — материал пространства под одноразовым кодом (`invites.ts`);
 *   гранты       — материал под взаимным ключом двух устройств (`grants.ts`).
 *
 * Всё, что здесь шифртекст, безопасно лежит в открытом ленде по построению;
 * сервер видит записи целиком и не может ни одну из них открыть.
 */

export const KEYS_ID = 'keys';

export const DeviceModel = model('keys/device', {
  /** Человеку: «телефон», «рабочий ноутбук». */
  label: atom(t.string),
  algo: atom(t.enum(['x25519', 'p256'] as const).or('x25519')),
  /** base64url сырого публичного ключа ECDH. Он же — id записи. */
  pub: atom(t.string),
  /**
   * Подписной `peer` устройства (канонический текст ссылки) — SHA-256 от его
   * ключа ПОДПИСИ и он же адрес устройства в лендах. Из него строится ростер
   * прав: живое устройство доверено, отозванное — нет.
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

export const VaultModel = model('keys/vault', {
  /** Мастер, завёрнутый KEK'ом фразы восстановления. */
  salt: atom(t.string),
  nonce: atom(t.string),
  cipher: atom(t.string),
  /** Отпечаток мастера под фразовой обёрткой (`Keyring.masterId`, не секрет). */
  wrapMaster: atom(t.string),
  /** Секреты лендов, запечатанные мастером. */
  ringNonce: atom(t.string),
  ringCipher: atom(t.string),
  /** Отпечаток мастера, запечатавшего блоб. Обязан совпадать с `wrapMaster`. */
  ringMaster: atom(t.string),
  /** Кто опубликовал блоб (pub устройства): спор о сейфе решает старшинство. */
  ringBy: atom(t.string),
  at: atom(t.number),
});

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

// ── Устройства ───────────────────────────────────────────────────────────────

export interface PairedDevice {
  readonly pub: string;
  readonly label: string;
  readonly algo: ExchangeAlgo;
  readonly signPeer: string;
  readonly addedAt: number;
  readonly revoked: boolean;
}

/** Все записи устройств, старшие первыми. */
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

/** Живые подписные peer'ы — из них строится ростер прав (`signing.ts`). */
export function livePeers(space: Space): Link[] {
  const out: Link[] = [];
  for (const device of listDevices(space)) {
    if (!device.revoked && device.signPeer !== '') out.push(Link.parse(device.signPeer));
  }
  return out;
}

/**
 * Объявить себя в пространстве. Идемпотентно по ECDH-ключу; подписной peer
 * дописывается всегда — он может смениться вместе с ключом подписи.
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
 * хранится по ECDH-ключу, и без этого однажды отозванный браузер оставался бы
 * «отозванным» навсегда — даже войдя по свежему приглашению. Право на жест
 * доказывает сам материал пространства: его выдал владелец.
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
 * Первая половина отзыва: пометить устройство и забрать его грант. Перевыпуск
 * секретов и перепечатка лендов — у оркестровки (`space.ts`): порядок там
 * несущий, между шагами лежит перезапуск лендов.
 */
export function markRevoked(space: Space, device: PairedDevice): void {
  const root = space.root(KeysModel);
  space.edit(() => {
    root.devices(device.pub).revokedAt(Date.now());
    root.grants.delete(device.pub);
  });
}

/** Отпечаток для глаза: восемь символов публичного ключа хватает, чтобы различить устройства. */
export function fingerprint(pub: string): string {
  return `${pub.slice(0, 4)}-${pub.slice(4, 8)}`.toLowerCase();
}

/**
 * Старше ли устройство `mine` публикатора `other` — спор о сейфе без фразы.
 * Старшинство — по времени появления в пространстве: устройство, успевшее
 * опубликовать блоб до подключения, всегда моложе тех, кто его приглашал.
 * Отозванное не старше никого. Публикатор без записи, отозванный или не
 * назвавшийся вовсе старшинства не имеет: спор выигрывает старейшее живое
 * устройство — оно одно, и потому перепубликует ровно одно.
 */
export function isSenior(space: Space, mine: string, other: string): boolean {
  const root = space.root(KeysModel);
  if (mine === other || !root.devices.has(mine)) return false;
  if (root.devices(mine).revokedAt() > 0) return false;
  if (other !== '' && root.devices.has(other) && root.devices(other).revokedAt() === 0) {
    return root.devices(mine).addedAt() < root.devices(other).addedAt();
  }
  return eldest(space) === mine;
}

/** Старейшее живое устройство — единственный арбитр бесхозного сейфа. */
function eldest(space: Space): string {
  const alive = listDevices(space).find(device => !device.revoked);
  return alive?.pub ?? '';
}
