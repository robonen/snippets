/**
 * Конверт: DEK шифрует данные, KEK шифрует DEK.
 *
 * Всё здесь — чистые функции над WebCrypto, без DOM и без WebAuthn. Так
 * сделано намеренно: криптографию можно прогнать в Node и покрыть тестами, а
 * платформенный край (`passkey.ts`) остаётся тонким и непроверяемым отдельно.
 *
 * Разбор решений — docs/01-security.md §4.
 */

const DEK_BYTES = 32;
const NONCE_BYTES = 12;
const SALT_BYTES = 16;

/** Итерации PBKDF2 для фразы восстановления. Подобраны под бюджет 250 мс–1 с. */
const PASSPHRASE_ITERATIONS = 600_000;

/**
 * Назначение ключа зашивается в его вывод. Один и тот же материал, пущенный на
 * две разные задачи, связал бы их между собой; разный `info` разводит выводы,
 * даже если вход совпал.
 */
const INFO_PASSKEY = 'brain/kek/passkey/v1';
const INFO_PASSPHRASE = 'brain/kek/passphrase/v1';

/** Шифртекст вместе со всем, что нужно для расшифровки, кроме ключа. */
export interface Sealed {
  readonly nonce: Uint8Array;
  readonly cipher: Uint8Array;
}

/** Обёрнутая копия DEK: по одной на каждый способ доступа. */
export interface WrappedDek extends Sealed {
  /**
   * Как получить KEK: passkey конкретного устройства, фраза или ключ устройства.
   *
   * `device` — самый слабый из трёх и заведён ровно под первый запуск
   * (docs/01-security.md §5.1): пока способа доступа нет, данные обязаны уже
   * лежать шифртекстом, иначе дыра остаётся там, где её труднее заметить.
   */
  readonly kind: 'passkey' | 'passphrase' | 'device';
  /** Метка способа доступа — id credential'а или имя устройства. Не секрет. */
  readonly label: string;
  /** Соль KDF. Для passkey — соль PRF, для фразы — соль PBKDF2. */
  readonly salt: Uint8Array;
}

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

/** Новый ключ данных. Один на всё пространство, живёт в памяти разблокированного приложения. */
export function createDek(): Uint8Array {
  return randomBytes(DEK_BYTES);
}

export function createSalt(): Uint8Array {
  return randomBytes(SALT_BYTES);
}

// ── AES-GCM ──────────────────────────────────────────────────────────────────

/**
 * Ключ AES-GCM из байт или уже готовый.
 *
 * Второй случай существует ради ключа устройства: он НЕИЗВЛЕКАЕМЫЙ, байт у него
 * нет и быть не должно — иначе весь смысл теряется. Всё остальное — вывод
 * нонса, AAD, проверка целостности — у обоих случаев одно.
 */
async function aesKey(key: Uint8Array | CryptoKey, usage: KeyUsage[]): Promise<CryptoKey> {
  if (!(key instanceof Uint8Array)) return key;
  return crypto.subtle.importKey('raw', bytes(key), 'AES-GCM', false, usage);
}

/**
 * Зашифровать. Nonce — свежие 96 бит на КАЖДЫЙ вызов: повтор пары (ключ, nonce)
 * в GCM ломает не только сообщение, но и сам ключ аутентификации.
 *
 * `aad` не шифруется, но подписывается: в него кладётся адрес ленда, чтобы
 * шифртекст одного ленда нельзя было подсунуть под видом другого.
 */
export async function seal(
  key: Uint8Array | CryptoKey,
  plain: Uint8Array,
  aad?: Uint8Array,
): Promise<Sealed> {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bytes(nonce), ...(aad !== undefined && { additionalData: bytes(aad) }) },
    await aesKey(key, ['encrypt']),
    bytes(plain),
  );
  return { nonce, cipher: new Uint8Array(cipher) };
}

/**
 * Расшифровать. Бросает, если ключ, nonce, шифртекст или AAD не те: GCM
 * проверяет целостность, и «расшифровалось во что-то» здесь невозможно.
 */
export async function open(
  key: Uint8Array | CryptoKey,
  sealed: Sealed,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: bytes(sealed.nonce),
      ...(aad !== undefined && { additionalData: bytes(aad) }),
    },
    await aesKey(key, ['decrypt']),
    bytes(sealed.cipher),
  );
  return new Uint8Array(plain);
}

// ── Вывод KEK ────────────────────────────────────────────────────────────────

/**
 * KEK из вывода WebAuthn PRF.
 *
 * Вывод PRF не берётся ключом напрямую: он идёт входом в HKDF. Это стоит один
 * дешёвый вызов и даёт разделение назначений — тот же вывод, понадобившийся
 * когда-нибудь для другой задачи, даст другой ключ.
 */
export async function kekFromPrf(prfOutput: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', bytes(prfOutput), 'HKDF', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: bytes(salt), info: bytes(text(INFO_PASSKEY)) },
    material,
    DEK_BYTES * 8,
  );
  return new Uint8Array(derived);
}

/**
 * KEK из фразы восстановления.
 *
 * Здесь KDF обязан быть ДОРОГИМ: фраза, в отличие от вывода PRF, имеет
 * ограниченную энтропию, и дешёвый вывод превратил бы перебор в реальную атаку
 * на украденную обёртку.
 *
 * PBKDF2 выбран потому, что он есть в WebCrypto без единой зависимости.
 * Argon2id устойчивее к перебору на GPU, но тянет WASM; переход на него —
 * замена этой функции и `kind: 'passphrase-argon2'` в обёртке, данные не
 * затрагиваются.
 */
export async function kekFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = PASSPHRASE_ITERATIONS,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    'raw',
    bytes(text(passphrase.normalize('NFKD'))),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations },
    material,
    DEK_BYTES * 8,
  );
  const hk = await crypto.subtle.importKey('raw', derived, 'HKDF', false, ['deriveBits']);
  const kek = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: bytes(salt), info: bytes(text(INFO_PASSPHRASE)) },
    hk,
    DEK_BYTES * 8,
  );
  return new Uint8Array(kek);
}

// ── Обёртки DEK ──────────────────────────────────────────────────────────────

export async function wrapDek(
  dek: Uint8Array,
  kek: Uint8Array | CryptoKey,
  meta: { kind: WrappedDek['kind']; label: string; salt: Uint8Array },
): Promise<WrappedDek> {
  // Ключ здесь KEK, а открытый текст — DEK: конверт заворачивает ключ данных.
  // Метка и вид подписываются вместе с ним — подменённая метка иначе позволила
  // бы выдать обёртку одного способа доступа за другой.
  const sealed = await seal(kek, dek, text(`${meta.kind}:${meta.label}`));
  return { ...meta, nonce: sealed.nonce, cipher: sealed.cipher };
}

export async function unwrapDek(wrapped: WrappedDek, kek: Uint8Array | CryptoKey): Promise<Uint8Array> {
  return open(kek, wrapped, text(`${wrapped.kind}:${wrapped.label}`));
}

/**
 * Ключ устройства: AES-256-GCM, который НЕЛЬЗЯ экспортировать.
 *
 * `extractable: false` — единственное, ради чего он существует. Ключ хранится в
 * IndexedDB объектом `CryptoKey`, то есть браузер возит его между запусками, но
 * байт не отдаёт никому: ни нашему коду, ни чужому скрипту, ни выгрузке базы.
 * Им можно только шифровать и расшифровывать, пока страница жива.
 *
 * Что это даёт и чего не даёт — docs/01-security.md §5.1. Коротко: данные на
 * диске перестают быть текстом до всякой настройки, но код, исполняемый в этом
 * origin, ключ ПОЗОВЁТ. Заменять им passkey нельзя, и он и не заменяет.
 */
export function createDeviceKek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: DEK_BYTES * 8 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

// ── Сериализация ─────────────────────────────────────────────────────────────

/**
 * Байты в base64url и обратно. Обёртки и соли хранятся в атомах ленда, а атом
 * держит строку; base64url выбран вместо обычного base64 потому, что те же
 * значения ходят в URL и в заголовках, и `+/=` там пришлось бы экранировать.
 */
export function encodeBytes(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function decodeBytes(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ── Мелочи ───────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function text(value: string): Uint8Array {
  return encoder.encode(value);
}

/**
 * WebCrypto принимает `BufferSource`. Приведение нужно из-за `ArrayBufferLike`:
 * `Uint8Array` над `SharedArrayBuffer` типом допустим, а WebCrypto его не берёт.
 */
function bytes(value: Uint8Array): ArrayBuffer {
  // Копия — только когда вид смотрит на кусок буфера. Пачки ленда бывают
  // мегабайтными, и копировать их на каждом шифровании было бы обидно.
  if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) {
    return value.buffer as ArrayBuffer;
  }
  return value.slice().buffer as ArrayBuffer;
}
