import { describe, expect, it, vi } from 'vitest';
import { chunkToWire, decodeFrame, encodeFrame } from '@brain/sync-wire';
import { landId, memoryChest } from '@brain/module-kit';
import { deviceMarks } from './marks';
import { syncEngine } from './engine';
import type { Frame } from '@brain/sync-wire';
import type { Chest } from '@brain/module-kit';
import type { LandId } from '@sync/core';
import type { OpenVault, Sealed, WrappedDek } from '@brain/auth';
import type { SyncEngine, Wire, WireHandlers } from './engine';

/**
 * Машина состояний «коннект → дочитал → дослал» на фейках.
 *
 * Крипта здесь подменена нарочно: движок обязан быть проверяем БЕЗ WebCrypto —
 * он возит куски, а не шифрует их. Настоящий конверт покрыт в `@brain/auth`.
 */

const LAND = landId('notes');

/** Вольт-пустышка: «печать» помечает пачку байтом, «распечатка» его снимает. */
function fakeVault(): OpenVault {
  return {
    sealPack: (_land, pack) => Promise.resolve({ nonce: new Uint8Array(12), cipher: mark(pack) }),
    openPack: (_land, sealed) => Promise.resolve(unmark(sealed.cipher)),
    wrapFor: () => Promise.reject(new Error('не нужно')) as Promise<WrappedDek>,
    lock: () => {},
  };
}

const MARK = 0xA5;

function mark(pack: Uint8Array): Uint8Array {
  const out = new Uint8Array(pack.length + 17);
  out[0] = MARK;
  out.set(pack, 1);
  return out;
}

function unmark(cipher: Uint8Array): Uint8Array {
  if (cipher[0] !== MARK) throw new Error('чужой ключ');
  return cipher.slice(1, -16);
}

const sealed = (text: string): Sealed => ({
  nonce: new Uint8Array(12),
  cipher: mark(new TextEncoder().encode(text)),
});

/** Хранилище счётчиков в памяти — тот же контракт, что у localStorage. */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const map = new Map<string, string>();
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: key => void map.delete(key),
  };
}

interface Harness {
  readonly engine: SyncEngine;
  readonly chest: Chest;
  /** Кадры, ушедшие на сервер, по порядку. */
  readonly sent: Frame[];
  readonly merged: Array<[LandId, string]>;
  /** Поднять связь: движок разошлёт приветы. */
  connect: () => void;
  drop: () => void;
  /** Кадр от сервера. */
  incoming: (frame: Frame) => void;
  /** Дать очередям ленда доехать: разбор кадров асинхронный. */
  settle: () => Promise<void>;
}

function harness(options: { chest?: Chest; storage?: ReturnType<typeof memoryStorage> } = {}): Harness {
  const chest = options.chest ?? memoryChest();
  const sent: Frame[] = [];
  const merged: Array<[LandId, string]> = [];
  let live = false;
  let handlers: WireHandlers | null = null;

  const wire: Wire = {
    send(bytes) {
      if (!live) return false;
      const frame = decodeFrame(bytes);
      if (frame !== null) sent.push(frame);
      return true;
    },
    close() {
      live = false;
    },
  };

  const engine = syncEngine({
    lands: [LAND],
    chest,
    vault: fakeVault(),
    marks: deviceMarks(options.storage ?? memoryStorage()),
    merge: (land, pack) => merged.push([land, new TextDecoder().decode(pack)]),
    wire: (given) => {
      handlers = given;
      return wire;
    },
    report: () => {},
  });

  return {
    engine,
    chest,
    sent,
    merged,
    connect: () => {
      live = true;
      handlers?.open();
    },
    drop: () => {
      live = false;
    },
    incoming: frame => handlers?.frame(encodeFrame(frame)),
    // Граница макрозадачи: очередь ленда разбирает кадры цепочкой промисов, и
    // считать её обороты вручную значило бы переписывать тест на каждый
    // добавленный `await` внутри движка.
    settle: () => new Promise(done => void setTimeout(done, 0)),
  };
}

const land = LAND.str;

describe(syncEngine, () => {
  it('на коннекте здоровается с тем, что видел, и досылает свой хвост', async () => {
    const chest = memoryChest();
    await chest.append(LAND, sealed('раз'));
    await chest.append(LAND, sealed('два'));

    const box = harness({ chest });
    box.connect();
    await box.settle();
    expect(box.sent).toEqual([{ op: 'hello', land, have: 0 }]);

    // Досылка ждёт головы: пока она неизвестна, между компакцией и дописью
    // выбрать нельзя.
    box.incoming({ op: 'head', land, count: 0 });
    await box.settle();

    expect(box.sent.slice(1)).toEqual([
      { op: 'append', land, bytes: chunkToWire(sealed('раз')) },
      { op: 'append', land, bytes: chunkToWire(sealed('два')) },
    ]);
  });

  it('второй коннект не переотправляет уже уехавшее', async () => {
    const storage = memoryStorage();
    const chest = memoryChest();
    await chest.append(LAND, sealed('раз'));
    await chest.append(LAND, sealed('два'));

    const first = harness({ chest, storage });
    first.connect();
    first.incoming({ op: 'head', land, count: 0 });
    await first.settle();
    expect(first.sent).toHaveLength(3);
    first.engine.close();

    // Тот же журнал, та же вкладка после перезагрузки: счётчик отправленного
    // пережил её, и заливать ленд заново незачем.
    const second = harness({ chest, storage });
    second.connect();
    second.incoming({ op: 'head', land, count: 2 });
    await second.settle();

    expect(second.sent).toEqual([{ op: 'hello', land, have: 0 }]);
  });

  it('кэш шифртекста стёрт, счётчики целы — перечитывает журнал с нуля', async () => {
    const storage = memoryStorage();
    // Прошлые сеансы: два куска сервера влиты, два своих отправлены. Потом
    // базу `brain-sealed` стёрли, а localStorage — нет.
    storage.setItem(`brain.sync.seen:${land}`, '2');
    storage.setItem(`brain.sync.sent:${land}`, '2');

    const box = harness({ chest: memoryChest(), storage });
    box.connect();
    await box.settle();

    // Привет обязан идти с нуля: прежний `seen` пропустил бы всё, что сервер
    // уже отдавал, и ленд остался бы пустым навсегда.
    expect(box.sent).toEqual([{ op: 'hello', land, have: 0 }]);

    box.incoming({ op: 'chunk', land, index: 0, bytes: chunkToWire(sealed('спасённое')) });
    box.incoming({ op: 'head', land, count: 1 });
    await box.settle();
    expect(box.merged).toEqual([[LAND, 'спасённое']]);
  });

  it('вливает принятые куски и двигает счётчик увиденного', async () => {
    const box = harness();
    box.connect();
    box.incoming({ op: 'chunk', land, index: 0, bytes: chunkToWire(sealed('чужое')) });
    box.incoming({ op: 'head', land, count: 1 });
    await box.settle();

    expect(box.merged).toEqual([[LAND, 'чужое']]);
    // В приложении влитое доезжает до сундука само: писатель сохраняет
    // услышанное. Здесь писателя нет — дописываем за него, иначе движок
    // справедливо примет пустой сундук за потерянный кэш.
    await box.chest.append(LAND, sealed('чужое'));

    // Второй коннект начинается с того места, где кончился первый.
    box.drop();
    box.sent.length = 0;
    box.connect();
    await box.settle();
    expect(box.sent[0]).toEqual({ op: 'hello', land, have: 1 });
  });

  it('не двигает счётчик через кусок, который не расшифровался', async () => {
    const box = harness();
    box.connect();
    // Первый кусок чужой (не наш ключ), второй — свой.
    box.incoming({ op: 'chunk', land, index: 0, bytes: chunkToWire({ nonce: new Uint8Array(12), cipher: new Uint8Array(30) }) });
    box.incoming({ op: 'chunk', land, index: 1, bytes: chunkToWire(sealed('своё')) });
    box.incoming({ op: 'head', land, count: 2 });
    await box.settle();

    // Влилось то, что смогли, но счётчик стоит на дыре: непрочитанный кусок
    // обязан приехать снова, когда появится нужная обёртка ключа.
    expect(box.merged).toEqual([[LAND, 'своё']]);
    box.drop();
    box.sent.length = 0;
    box.connect();
    await box.settle();
    expect(box.sent[0]).toEqual({ op: 'hello', land, have: 0 });
  });

  it('отправляет свежий кусок краном, пока связь жива', async () => {
    const box = harness();
    box.connect();
    box.incoming({ op: 'head', land, count: 0 });
    await box.settle();
    box.sent.length = 0;

    await box.chest.append(LAND, sealed('свежее'));
    box.engine.tap.onAppend?.(LAND, sealed('свежее'), 0);
    await box.settle();

    expect(box.sent).toEqual([{ op: 'append', land, bytes: chunkToWire(sealed('свежее')) }]);
  });

  it('без связи копит и досылает на следующем коннекте', async () => {
    const box = harness();
    box.connect();
    box.incoming({ op: 'head', land, count: 0 });
    await box.settle();

    box.drop();
    await box.chest.append(LAND, sealed('офлайн'));
    box.engine.tap.onAppend?.(LAND, sealed('офлайн'), 0);
    await box.settle();

    box.sent.length = 0;
    box.connect();
    box.incoming({ op: 'head', land, count: 0 });
    await box.settle();

    expect(box.sent).toEqual([
      { op: 'hello', land, have: 0 },
      { op: 'append', land, bytes: chunkToWire(sealed('офлайн')) },
    ]);
  });

  it('компакция при догнанном сервере уходит REPLACE-ом', async () => {
    const box = harness();
    box.connect();
    box.incoming({ op: 'chunk', land, index: 0, bytes: chunkToWire(sealed('старое')) });
    box.incoming({ op: 'head', land, count: 1 });
    await box.settle();
    box.sent.length = 0;

    await box.chest.replace(LAND, sealed('весь ленд'));
    box.engine.tap.onReplace?.(LAND, sealed('весь ленд'));
    await box.settle();

    expect(box.sent).toEqual([
      { op: 'replace', land, ifHead: 1, bytes: chunkToWire(sealed('весь ленд')) },
    ]);

    // Сервер согласился: его журнал — наш кусок, и перечитывать его незачем.
    box.incoming({ op: 'head', land, count: 1 });
    await box.settle();

    box.drop();
    box.sent.length = 0;
    box.connect();
    box.incoming({ op: 'head', land, count: 1 });
    await box.settle();
    expect(box.sent).toEqual([{ op: 'hello', land, have: 1 }]);
  });

  it('отказ в компакции лечится обычной дописью', async () => {
    const box = harness();
    box.connect();
    box.incoming({ op: 'chunk', land, index: 0, bytes: chunkToWire(sealed('старое')) });
    box.incoming({ op: 'head', land, count: 1 });
    await box.settle();
    box.sent.length = 0;

    await box.chest.replace(LAND, sealed('весь ленд'));
    box.engine.tap.onReplace?.(LAND, sealed('весь ленд'));
    await box.settle();

    // Пока мы шли, сервер ушёл вперёд: соседнее устройство дописало свой кусок.
    box.incoming({ op: 'reject', land, head: 3 });
    await box.settle();

    expect(box.sent.slice(1)).toEqual([
      { op: 'append', land, bytes: chunkToWire(sealed('весь ленд')) },
    ]);
  });

  it('компакция между сессиями: журнал сжался офлайн — уходит один кусок', async () => {
    const storage = memoryStorage();
    const chest = memoryChest();
    await chest.append(LAND, sealed('раз'));
    await chest.append(LAND, sealed('два'));

    const first = harness({ chest, storage });
    first.connect();
    first.incoming({ op: 'head', land, count: 0 });
    await first.settle();
    expect(first.sent).toHaveLength(3); // привет и два куска
    first.engine.close();

    // Вкладку закрыли. Пока её не было, журнал перепечатали одним куском —
    // кран сундука сообщает об этом и без сети.
    await chest.replace(LAND, sealed('весь ленд'));

    const second = harness({ chest, storage });
    second.engine.tap.onReplace?.(LAND, sealed('весь ленд'));
    await second.settle();
    second.connect();
    // Сервер к этому моменту знает два наших куска — ровно те, что мы влили не
    // сами, поэтому `seen` их не считает, и компакция уходит дописью.
    second.incoming({ op: 'head', land, count: 2 });
    await second.settle();

    expect(second.sent).toEqual([
      { op: 'hello', land, have: 0 },
      { op: 'append', land, bytes: chunkToWire(sealed('весь ленд')) },
    ]);
  });

  it('не шлёт кусок с пропуском: дыра в журнале сервера хуже задержки', async () => {
    const box = harness();
    box.connect();
    box.incoming({ op: 'head', land, count: 0 });
    await box.settle();
    box.sent.length = 0;

    // Кран сообщает про кусок №3, а отправлено пока ноль: между ними дыра.
    box.engine.tap.onAppend?.(LAND, sealed('пятый'), 3);
    await box.settle();
    expect(box.sent).toEqual([]);
  });

  it('кадры чужого ленда игнорируются', async () => {
    const box = harness();
    box.connect();
    box.incoming({ op: 'chunk', land: landId('tasks').str, index: 0, bytes: chunkToWire(sealed('чужой ленд')) });
    await box.settle();
    expect(box.merged).toEqual([]);
  });

  it('после close не шлёт ничего', async () => {
    const box = harness();
    box.connect();
    box.incoming({ op: 'head', land, count: 0 });
    await box.settle();
    box.engine.close();
    box.sent.length = 0;

    box.engine.tap.onAppend?.(LAND, sealed('поздно'), 0);
    await box.settle();
    expect(box.sent).toEqual([]);
  });

  it('стирание ленда забывает его счётчики', async () => {
    const storage = memoryStorage();
    const box = harness({ storage });
    box.connect();
    box.incoming({ op: 'chunk', land, index: 0, bytes: chunkToWire(sealed('что-то')) });
    box.incoming({ op: 'head', land, count: 1 });
    await box.settle();
    expect(deviceMarks(storage).seen(land)).toBe(1);

    box.engine.tap.onWipe?.(LAND);
    expect(deviceMarks(storage).seen(land)).toBe(0);
  });

  it('мусор с провода не роняет движок', async () => {
    const box = harness();
    box.connect();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    box.incoming({ op: 'head', land, count: 0 });
    await box.settle();
    expect(box.merged).toEqual([]);
    quiet.mockRestore();
  });
});
