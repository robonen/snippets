import { decodeBytes, decodeGrant, encodeBytes } from '@brain/auth';
import type { Space } from '@sync/core';
import type { Keyring, SpaceMaterial } from '@brain/auth';
import { KeysModel } from './keys-land';

/**
 * Приглашение устройства ссылкой — единственный путь подключения для человека.
 *
 * В ленде лежит материал пространства (мастер и секреты), запечатанный
 * одноразовым 16-байтовым кодом. Код и токен синка едут в URL-фрагменте
 * ссылки: фрагмент не покидает браузер, а запись без кода — шум. Новое
 * устройство открывает ссылку, настраивает синк, дожидается записи и входит
 * в одно подтверждение. Приглашение живёт сутки и гаснет после первого входа.
 */

/** Запись приглашения одна на пространство: новая гасит старую. */
const INVITE_ID = 'open';
const INVITE_AAD = 'brain/invite/v1';
/** Сутки: хватает переслать себе, мало — злоумышленнику из бэкапа переписки. */
const INVITE_TTL = 24 * 60 * 60 * 1000;

const HASH_CODE = 'invite';
const HASH_TOKEN = 'sync';

export interface Invite {
  readonly at: number;
  readonly expiresAt: number;
}

export interface InviteLink {
  readonly code: string;
  /** Токен синка. Пусто — ссылка без него: получатель настроит синк сам. */
  readonly token: string;
}

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
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(INVITE_AAD) },
    await inviteKey(code, ['encrypt']),
    ring.exportForGrant().slice().buffer as ArrayBuffer,
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

/** Действующее приглашение — для карточки. `null` — нет либо погашено. */
export function readInvite(space: Space): Invite | null {
  const root = space.root(KeysModel);
  if (!root.invites.has(INVITE_ID)) return null;
  const doc = root.invites(INVITE_ID);
  if (doc.cipher() === '') return null;
  const at = doc.at();
  return { at, expiresAt: at + INVITE_TTL };
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

// ── Ссылка ───────────────────────────────────────────────────────────────────

/** Собрать ссылку-приглашение: экран доступа этого origin плюс фрагмент. */
export function inviteLink(origin: string, link: InviteLink): string {
  const hash = new URLSearchParams({ [HASH_CODE]: link.code });
  if (link.token !== '') hash.set(HASH_TOKEN, link.token);
  return `${origin}/settings/security#${hash.toString()}`;
}

/** Разобрать фрагмент адреса. `null` — это не ссылка-приглашение. */
export function parseInviteHash(hash: string): InviteLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const code = params.get(HASH_CODE);
  if (code === null || code === '') return null;
  return { code, token: params.get(HASH_TOKEN) ?? '' };
}
