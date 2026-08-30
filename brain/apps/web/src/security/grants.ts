import { decodeBytes, decodeGrant, encodeBytes } from '@brain/auth';
import type { Identity, Space } from '@sync/core';
import type { Keyring, SpaceMaterial } from '@brain/auth';
import { KeysModel, listDevices } from './keys-land';
import type { PairedDevice } from './keys-land';

/**
 * Гранты — внутренний механизм, не путь для человека.
 *
 * После отзыва владелец раздаёт живым устройствам НОВЫЙ материал обёрткой под
 * взаимным ключом пары «датель ↔ получатель» (ECDH → HKDF → AES-GCM), и каждое
 * принимает его само: обёртка адресована его ключу и выдана устройством,
 * которому оно уже доверяет. Сервер видит обёртку и не может её открыть —
 * приватные половины обеих пар его не покидали.
 */

const GRANT_AAD = 'brain/pair/v1';

/** Выдать устройству материал пространства под взаимным ключом. */
export async function grantTo(space: Space, ring: Keyring, identity: Identity, device: PairedDevice): Promise<void> {
  const mutual = await identity.mutualSealed(device.algo, decodeBytes(device.pub));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`${GRANT_AAD}:${device.pub}:${encodeBytes(identity.pub)}`);
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad },
    mutual,
    ring.exportForGrant().slice().buffer as ArrayBuffer,
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

/** Грант для НАС в ленде? Снять его и вернуть материал. `null` — не выдан или погашен. */
export async function claimGrant(space: Space, identity: Identity): Promise<SpaceMaterial | null> {
  const myPub = encodeBytes(identity.pub);
  const root = space.root(KeysModel);
  if (!root.grants.has(myPub)) return null;

  const doc = root.grants(myPub);
  if (doc.cipher() === '') return null;
  const fromPub = doc.from();
  if (!root.devices.has(fromPub) || root.devices(fromPub).revokedAt() > 0) return null;

  const mutual = await identity.mutualSealed(root.devices(fromPub).algo(), decodeBytes(fromPub));
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

/** Выдать ПЕРЕВЫПУЩЕННЫЙ материал всем живым устройствам, кроме себя. */
export async function regrantAll(space: Space, ring: Keyring, identity: Identity): Promise<void> {
  const myPub = encodeBytes(identity.pub);
  for (const device of listDevices(space)) {
    if (device.pub !== myPub && !device.revoked) await grantTo(space, ring, identity, device);
  }
}
