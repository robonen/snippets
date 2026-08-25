import { describe, expect, it } from 'vitest';
import {
  chunkFromWire,
  chunkToWire,
  decodeChunkList,
  decodeFrame,
  encodeChunkList,
  encodeFrame,
  landOk,
} from './frames';
import type { Frame } from './frames';

/** Настоящий адрес: base64url от `kcalkcal` — тот самый ленд дневника. */
const LAND = 'a2NhbGtjYWw';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

describe(landOk, () => {
  it('принимает адрес ленда: 11 символов base64url с нулевым хвостом', () => {
    expect(landOk(LAND)).toBeTruthy();
    expect(landOk('LXJQ5fNmyWY')).toBeTruthy();
  });

  it('отвергает не-адрес: длину, алфавит и ненулевые хвостовые биты', () => {
    expect(landOk('')).toBeFalsy();
    expect(landOk('a2NhbGtjYW')).toBeFalsy(); // 10 символов
    expect(landOk('a2NhbGtjYWw1')).toBeFalsy(); // 12 символов
    expect(landOk('a2NhbGtjYW+')).toBeFalsy(); // `+` — из обычного base64, не url
    expect(landOk('../../../up')).toBeFalsy(); // точки и слэши — путь, не адрес
    // `B` = 1: хвостовые два бита не нулевые — восемь байт так не кодируются.
    expect(landOk('a2NhbGtjYWB')).toBeFalsy();
  });
});

describe(decodeFrame, () => {
  /**
   * Числа во всех кадрах — с РАЗНЫМИ байтами (0x01020304): «7» и «42» проходят
   * туда-обратно даже при перепутанном порядке байтов, и такой обход ничего не
   * доказывал бы. Поймано проверкой теста на покраснение.
   */
  const frames: Frame[] = [
    { op: 'hello', land: LAND, have: 0 },
    { op: 'hello', land: LAND, have: 0xFF_FF_FF_FF },
    { op: 'hello', land: LAND, have: 0x01_02_03_04 },
    { op: 'chunk', land: LAND, index: 0x01_02_03_04, bytes: bytes(1, 2, 3) },
    { op: 'append', land: LAND, bytes: bytes(0xDE, 0xAD) },
    { op: 'head', land: LAND, count: 0x01_02_03_04 },
    { op: 'replace', land: LAND, ifHead: 0x01_02_03_04, bytes: bytes(9) },
    { op: 'reject', land: LAND, head: 0x01_02_03_04 },
  ];

  it.each(frames.map((frame, at) => [`${frame.op} #${at}`, frame] as const))('обходит туда-обратно: %s', (_, frame) => {
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it('кладёт числа старшим байтом вперёд', () => {
    const frame = encodeFrame({ op: 'head', land: LAND, count: 0x01_02_03_04 });
    // Заголовок — op и 11 символов адреса; дальше четыре байта числа.
    expect(Array.from(frame.slice(12))).toEqual([0x01, 0x02, 0x03, 0x04]);
  });

  it('отказывает на обрезанном кадре', () => {
    const whole = encodeFrame({ op: 'hello', land: LAND, have: 5 });
    for (let cut = 0; cut < whole.length; cut++) {
      expect(decodeFrame(whole.slice(0, cut))).toBeNull();
    }
    // Кусковые кадры без единого байта куска — тоже брак.
    const chunk = encodeFrame({ op: 'chunk', land: LAND, index: 0, bytes: bytes(1) });
    expect(decodeFrame(chunk.slice(0, -1))).toBeNull();
  });

  it('отказывает на неизвестном op', () => {
    const frame = encodeFrame({ op: 'hello', land: LAND, have: 5 });
    frame[0] = 0x07;
    expect(decodeFrame(frame)).toBeNull();
    frame[0] = 0x00;
    expect(decodeFrame(frame)).toBeNull();
  });

  it('отказывает на кривом адресе ленда', () => {
    const frame = encodeFrame({ op: 'hello', land: LAND, have: 5 });
    frame[1] = 0x2E; // `.`
    expect(decodeFrame(frame)).toBeNull();
  });

  it('отказывает на лишнем хвосте у кадров точной длины', () => {
    const frame = encodeFrame({ op: 'head', land: LAND, count: 1 });
    const longer = new Uint8Array(frame.length + 1);
    longer.set(frame, 0);
    expect(decodeFrame(longer)).toBeNull();
  });

  it('кодирование бросает на кривом входе — это ошибка кода, не провода', () => {
    expect(() => encodeFrame({ op: 'hello', land: 'мусор', have: 0 })).toThrow();
    expect(() => encodeFrame({ op: 'append', land: LAND, bytes: bytes() })).toThrow();
    expect(() => encodeFrame({ op: 'hello', land: LAND, have: -1 })).toThrow();
    expect(() => encodeFrame({ op: 'hello', land: LAND, have: 2 ** 32 })).toThrow();
  });
});

describe(chunkToWire, () => {
  it('обходит туда-обратно: nonce(12) || cipher', () => {
    const chunk = {
      nonce: new Uint8Array(12).fill(7),
      cipher: new Uint8Array(20).fill(9),
    };
    expect(chunkFromWire(chunkToWire(chunk))).toEqual(chunk);
  });

  it('отказывает на куске короче нонса с меткой GCM', () => {
    expect(chunkFromWire(new Uint8Array(27))).toBeNull();
    expect(chunkFromWire(new Uint8Array(0))).toBeNull();
  });
});

describe(decodeChunkList, () => {
  it('обходит туда-обратно список кусков, включая пустой', () => {
    const chunks = [bytes(1, 2, 3), bytes(4), bytes(5, 6)];
    expect(decodeChunkList(encodeChunkList(chunks))).toEqual(chunks);
    expect(decodeChunkList(encodeChunkList([]))).toEqual([]);
  });

  it('отказывает на оборванном хвосте целиком — часть журнала не журнал', () => {
    const body = encodeChunkList([bytes(1, 2, 3), bytes(4, 5)]);
    expect(decodeChunkList(body.slice(0, -1))).toBeNull();
    expect(decodeChunkList(body.slice(0, 2))).toBeNull();
  });

  it('отказывает на нулевой длине куска', () => {
    expect(decodeChunkList(bytes(0, 0, 0, 0))).toBeNull();
  });
});
