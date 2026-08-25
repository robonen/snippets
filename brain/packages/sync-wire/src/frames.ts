/**
 * Кадры протокола синка: клиент и сервер разговаривают ровно этим (docs/04-server.md).
 *
 * Один WebSocket мультиплексирует все ленды, поэтому адрес ленда лежит в КАЖДОМ
 * кадре, а не в URL соединения. Формат бинарный и плоский:
 *
 *   [op:1][land:11 ascii base64url][payload]
 *
 * Ни JSON, ни base64: полезная нагрузка — шифртекст кусков журнала, и текстовая
 * обёртка раздула бы её на треть, ничего не добавив (тот же довод, что у
 * бинарных кадров kcal).
 *
 * Кодек ОБЯЗАН быть глухим к мусору: провод — чужая территория, и обрезанный
 * кадр, незнакомый op или кривой адрес — это данные, а не исключительная
 * ситуация. Разбор отвечает `null`, бросает только кодирование — там кривой
 * кадр означает ошибку в нашем же коде.
 */

/** Коды операций. Клиент шлёт нечётные роли (просьбы), сервер — ответы. */
const HELLO = 0x01;
const CHUNK = 0x02;
const APPEND = 0x03;
const HEAD = 0x04;
const REPLACE = 0x05;
const REJECT = 0x06;

/** Адрес ленда на проводе: base64url восьми байт — всегда 11 символов. */
export const LAND_CHARS = 11;

export type Frame
  /** Клиент → сервер: «я видел `have` кусков — дошли остальные». */
  = | { readonly op: 'hello'; readonly land: string; readonly have: number }
  /** Сервер → клиент: кусок журнала под своим номером. */
    | { readonly op: 'chunk'; readonly land: string; readonly index: number; readonly bytes: Uint8Array }
  /** Клиент → сервер: дописать кусок в хвост журнала. */
    | { readonly op: 'append'; readonly land: string; readonly bytes: Uint8Array }
  /** Сервер → клиент: сколько кусков в журнале. Ответ на hello, append и replace. */
    | { readonly op: 'head'; readonly land: string; readonly count: number }
  /** Клиент → сервер: если в журнале ровно `ifHead` кусков — заменить его этим одним. */
    | { readonly op: 'replace'; readonly land: string; readonly ifHead: number; readonly bytes: Uint8Array }
  /** Сервер → клиент: замена не состоялась, в журнале `head` кусков. */
    | { readonly op: 'reject'; readonly land: string; readonly head: number };

/** Алфавит base64url (RFC 4648 §5) — тот же, что у `Link.str` ядра. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const LAND_RE = /^[\w-]{11}$/;

/**
 * Похож ли текст на адрес ленда.
 *
 * Восемь байт — 64 бита; одиннадцатый символ несёт биты 60..65, и два хвостовых
 * обязаны быть нулями — значит, значение последнего символа кратно четырём.
 * Проверка не косметика: адрес уходит в ключи хранилища на сервере, и алфавит
 * без точек и слэшей — это ещё и закрытый путь наружу из каталога данных.
 */
export function landOk(text: string): boolean {
  if (!LAND_RE.test(text)) return false;
  const last = ALPHABET.indexOf(text[LAND_CHARS - 1] as string);
  return last % 4 === 0;
}

/** Заголовок кадра: op + адрес. Дальше — payload операции. */
const HEADER = 1 + LAND_CHARS;

export function encodeFrame(frame: Frame): Uint8Array {
  if (!landOk(frame.land)) {
    throw new Error(`адрес ленда «${frame.land}» не годится для кадра: это ошибка вызывающего, не провода`);
  }

  switch (frame.op) {
    case 'hello':
      return fixed(HELLO, frame.land, frame.have);
    case 'head':
      return fixed(HEAD, frame.land, frame.count);
    case 'reject':
      return fixed(REJECT, frame.land, frame.head);
    case 'append':
      return carrying(APPEND, frame.land, null, frame.bytes);
    case 'chunk':
      return carrying(CHUNK, frame.land, frame.index, frame.bytes);
    case 'replace':
      return carrying(REPLACE, frame.land, frame.ifHead, frame.bytes);
  }
}

/** Разобрать кадр. Любой брак — `null`: мусор с провода не имеет права бросать. */
export function decodeFrame(bytes: Uint8Array): Frame | null {
  if (bytes.length < HEADER) return null;

  const land = landOf(bytes);
  if (land === null) return null;

  const op = bytes[0];
  const size = bytes.length - HEADER;

  switch (op) {
    // У кадров с одним числом длина ТОЧНАЯ: лишний хвост — рассинхрон кадров,
    // и молча его отбросить значило бы читать провод со сдвигом.
    case HELLO:
      return size === 4 ? { op: 'hello', land, have: u32At(bytes, HEADER) } : null;
    case HEAD:
      return size === 4 ? { op: 'head', land, count: u32At(bytes, HEADER) } : null;
    case REJECT:
      return size === 4 ? { op: 'reject', land, head: u32At(bytes, HEADER) } : null;
    // Пустой кусок — брак: каждый кусок журнала обязан быть валидной пачкой,
    // а пустых пачек не бывает.
    case APPEND:
      return size >= 1 ? { op: 'append', land, bytes: bytes.slice(HEADER) } : null;
    case CHUNK:
      return size >= 5 ? { op: 'chunk', land, index: u32At(bytes, HEADER), bytes: bytes.slice(HEADER + 4) } : null;
    case REPLACE:
      return size >= 5 ? { op: 'replace', land, ifHead: u32At(bytes, HEADER), bytes: bytes.slice(HEADER + 4) } : null;
    default:
      return null;
  }
}

function fixed(op: number, land: string, value: number): Uint8Array {
  const out = new Uint8Array(HEADER + 4);
  out[0] = op;
  putLand(out, land);
  putU32(out, HEADER, value);
  return out;
}

function carrying(op: number, land: string, value: number | null, bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0) {
    throw new Error('пустой кусок не кодируется: каждый кусок журнала — валидная пачка');
  }
  const at = value === null ? HEADER : HEADER + 4;
  const out = new Uint8Array(at + bytes.length);
  out[0] = op;
  putLand(out, land);
  if (value !== null) putU32(out, HEADER, value);
  out.set(bytes, at);
  return out;
}

function putLand(out: Uint8Array, land: string): void {
  for (let i = 0; i < LAND_CHARS; i++) out[1 + i] = land.charCodeAt(i);
}

function landOf(bytes: Uint8Array): string | null {
  let land = '';
  for (let i = 0; i < LAND_CHARS; i++) land += String.fromCharCode(bytes[1 + i] as number);
  return landOk(land) ? land : null;
}

function putU32(out: Uint8Array, at: number, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xFF_FF_FF_FF) {
    throw new Error(`число ${value} не помещается в u32 кадра`);
  }
  out[at] = (value >>> 24) & 0xFF;
  out[at + 1] = (value >>> 16) & 0xFF;
  out[at + 2] = (value >>> 8) & 0xFF;
  out[at + 3] = value & 0xFF;
}

function u32At(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] as number) << 24)
    | ((bytes[at + 1] as number) << 16)
    | ((bytes[at + 2] as number) << 8)
    | (bytes[at + 3] as number)
  ) >>> 0;
}

// ── Кусок журнала на проводе ─────────────────────────────────────────────────

/**
 * Нонс AES-GCM: 96 бит. Число продублировано из `@brain/auth` намеренно — это
 * часть ПРОВОДНОГО формата куска, и менять его можно только вместе с версией
 * протокола, а не вместе с криптографией.
 */
export const CHUNK_NONCE = 12;

/** Метка целостности GCM: короче нонса с меткой кусок не бывает. */
const CHUNK_LEAST = CHUNK_NONCE + 16;

export interface WireChunk {
  readonly nonce: Uint8Array;
  readonly cipher: Uint8Array;
}

/** Кусок на провод: `nonce(12) || cipher`. Сервер видит его как непрозрачные байты. */
export function chunkToWire(chunk: WireChunk): Uint8Array {
  const out = new Uint8Array(chunk.nonce.length + chunk.cipher.length);
  out.set(chunk.nonce, 0);
  out.set(chunk.cipher, chunk.nonce.length);
  return out;
}

export function chunkFromWire(bytes: Uint8Array): WireChunk | null {
  if (bytes.length < CHUNK_LEAST) return null;
  return { nonce: bytes.slice(0, CHUNK_NONCE), cipher: bytes.slice(CHUNK_NONCE) };
}

// ── Куски в теле HTTP-фолбэка ────────────────────────────────────────────────

/**
 * Тело `GET /sync/:land`: повторяющиеся `[len:u32be][chunk]`. Длина перед
 * каждым куском, потому что границы кусков — смысловые (кусок = одна печать
 * GCM), и склеенные без длин байты обратно не разрезать.
 */
export function encodeChunkList(chunks: readonly Uint8Array[]): Uint8Array {
  let size = 0;
  for (const chunk of chunks) size += 4 + chunk.length;
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    putU32(out, at, chunk.length);
    out.set(chunk, at + 4);
    at += 4 + chunk.length;
  }
  return out;
}

/** Разрезать тело обратно. Оборванный хвост — брак целиком: часть журнала не журнал. */
export function decodeChunkList(bytes: Uint8Array): readonly Uint8Array[] | null {
  const out: Uint8Array[] = [];
  let at = 0;
  while (at < bytes.length) {
    if (at + 4 > bytes.length) return null;
    const size = u32At(bytes, at);
    if (size === 0 || at + 4 + size > bytes.length) return null;
    out.push(bytes.slice(at + 4, at + 4 + size));
    at += 4 + size;
  }
  return out;
}
