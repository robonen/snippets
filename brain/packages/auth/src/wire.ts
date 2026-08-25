import type { WrappedDek } from './crypto';

/**
 * Провод для `PUT`/`GET /account/wraps` (docs/04-server.md «Аккаунт и вход»).
 *
 * Контракт эндпоинта — `{ label, kind, blob: base64url }`: у сервера ровно ОДНО
 * поле под содержимое обёртки, а `WrappedDek` несёт ТРИ (`salt`, `nonce`,
 * `cipher`) — сервер слеп к обёрткам (план Р5), значит паковку и распаковку
 * этой тройки в один блоб обязан делать клиент, а не сервер.
 *
 * Формат — длина-значение на переменные поля, а не жёстко зашитые смещения
 * (`16 + 12 + остальное`): те же числа уже жёстко заданы константами в
 * `crypto.ts` (`SALT_BYTES`, `NONCE_BYTES`), но провод и криптография меняются
 * порознь — смена одной не обязана молча портить формат другой. Тот же приём,
 * что у `chunkToWire`/`chunkFromWire` в `packages/sync-wire`.
 */

function put8(out: Uint8Array, at: number, value: Uint8Array): number {
  if (value.length > 0xFF) {
    throw new Error(`поле длиной ${value.length} байт не помещается в проводной формат обёртки (лимит 255)`);
  }
  out[at] = value.length;
  out.set(value, at + 1);
  return at + 1 + value.length;
}

export function packWrap(wrap: Pick<WrappedDek, 'salt' | 'nonce' | 'cipher'>): Uint8Array {
  const out = new Uint8Array(1 + wrap.salt.length + 1 + wrap.nonce.length + wrap.cipher.length);
  const afterSalt = put8(out, 0, wrap.salt);
  const afterNonce = put8(out, afterSalt, wrap.nonce);
  out.set(wrap.cipher, afterNonce);
  return out;
}

/**
 * Разобрать блоб обратно. Бросает на обрубленных или подделанных байтах —
 * малформленный блоб от сервера (битый диск, чужой формат) не имеет права
 * тихо превратиться в обёртку с мусорной солью или пустым шифртекстом: она бы
 * просто не открылась дальше, но ошибка на этом шаге яснее.
 */
export function unpackWrap(meta: Pick<WrappedDek, 'kind' | 'label'>, blob: Uint8Array): WrappedDek {
  if (blob.length < 1) throw new Error('обёртка обрублена: нет даже длины соли');
  const saltLen = blob[0] as number;
  let at = 1;
  if (blob.length < at + saltLen + 1) throw new Error('обёртка обрублена: не хватает соли или длины нонса');
  const salt = blob.slice(at, at + saltLen);
  at += saltLen;

  const nonceLen = blob[at] as number;
  at += 1;
  if (blob.length < at + nonceLen) throw new Error('обёртка обрублена: не хватает нонса');
  const nonce = blob.slice(at, at + nonceLen);
  at += nonceLen;

  const cipher = blob.slice(at);
  if (cipher.length === 0) throw new Error('обёртка без шифртекста');

  return { kind: meta.kind, label: meta.label, salt, nonce, cipher };
}
