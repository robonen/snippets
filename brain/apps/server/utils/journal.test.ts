import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStorage } from 'unstorage';
import fsDriver from 'unstorage/drivers/fs';
import { fileJournal, withLand } from './journal';
import type { Journal } from './journal';
import type { Storage } from 'unstorage';

/**
 * Журнал проверяется на НАСТОЯЩЕЙ файловой системе, а не на памяти.
 *
 * Атомарность компакции — свойство раскладки на диске (поколения плюс голова),
 * и на карте в памяти оно выполнялось бы само собой, ничего не доказывая.
 */

const LAND = 'a2NhbGtjYWw';
const OTHER = 'LXJQ5fNmyWY';

const chunk = (...values: number[]): Uint8Array => new Uint8Array(values);

let dir: string;
let storage: Storage;
let journal: Journal;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'brain-journal-'));
  storage = createStorage({ driver: fsDriver({ base: dir }) });
  journal = fileJournal(storage);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe(fileJournal, () => {
  it('незнакомый ленд — пустой журнал, а не отказ', async () => {
    expect(await journal.head(LAND)).toBe(0);
    expect(await journal.read(LAND, 0)).toEqual([]);
  });

  it('дописывает в хвост и отдаёт куски в порядке записи', async () => {
    expect(await journal.append(LAND, chunk(1))).toBe(1);
    expect(await journal.append(LAND, chunk(2))).toBe(2);
    expect(await journal.append(LAND, chunk(3))).toBe(3);

    expect(await journal.head(LAND)).toBe(3);
    expect(await journal.read(LAND, 0)).toEqual([chunk(1), chunk(2), chunk(3)]);
    // Хвост с середины — то, чем клиент догоняет по счётчику `seen`.
    expect(await journal.read(LAND, 2)).toEqual([chunk(3)]);
    expect(await journal.read(LAND, 3)).toEqual([]);
  });

  it('ленды не смешиваются', async () => {
    await journal.append(LAND, chunk(1));
    await journal.append(OTHER, chunk(2));

    expect(await journal.read(LAND, 0)).toEqual([chunk(1)]);
    expect(await journal.read(OTHER, 0)).toEqual([chunk(2)]);
  });

  it('replace на актуальной голове сжимает журнал до одного куска', async () => {
    await journal.append(LAND, chunk(1));
    await journal.append(LAND, chunk(2));

    expect(await journal.replace(LAND, 2, chunk(9))).toEqual({ ok: true, head: 1 });
    expect(await journal.head(LAND)).toBe(1);
    expect(await journal.read(LAND, 0)).toEqual([chunk(9)]);
  });

  it('replace с устаревшим ifHead отвергается и НИЧЕГО не портит', async () => {
    await journal.append(LAND, chunk(1));
    await journal.append(LAND, chunk(2));
    await journal.append(LAND, chunk(3));

    // Клиент компактил, видя два куска; пока он шёл, приехал третий.
    expect(await journal.replace(LAND, 2, chunk(9))).toEqual({ ok: false, head: 3 });
    expect(await journal.read(LAND, 0)).toEqual([chunk(1), chunk(2), chunk(3)]);
    // И журнал остаётся рабочим: дописать после отказа можно.
    expect(await journal.append(LAND, chunk(4))).toBe(4);
  });

  it('после компакции журнал растёт дальше с новой головы', async () => {
    await journal.append(LAND, chunk(1));
    await journal.replace(LAND, 1, chunk(9));
    expect(await journal.append(LAND, chunk(2))).toBe(2);
    expect(await journal.read(LAND, 0)).toEqual([chunk(9), chunk(2)]);
  });

  it('уносит с диска куски прежнего поколения', async () => {
    await journal.append(LAND, chunk(1));
    await journal.append(LAND, chunk(2));
    await journal.replace(LAND, 2, chunk(9));

    const keys = await storage.getKeys(`chunk:${LAND}`);
    expect(keys).toHaveLength(1);
  });

  it('переживает обрыв компакции: новое поколение записано, старое не убрано', async () => {
    await journal.append(LAND, chunk(1));
    await journal.append(LAND, chunk(2));

    // Симуляция обрыва ПОСЛЕ точки фиксации: новый кусок и новая голова уже на
    // диске, куски прежнего поколения ещё лежат.
    await storage.setItemRaw(`chunk:${LAND}:1:0`, chunk(9));
    await storage.setItem(`head:${LAND}`, '1:1');

    // Свежий процесс: чужие поколения выметает `sweep` при первом касании.
    const restarted = fileJournal(storage);
    expect(await restarted.head(LAND)).toBe(1);
    expect(await restarted.read(LAND, 0)).toEqual([chunk(9)]);
    expect(await storage.getKeys(`chunk:${LAND}`)).toHaveLength(1);
  });

  it('переживает обрыв компакции ДО точки фиксации: журнал прежний', async () => {
    await journal.append(LAND, chunk(1));
    await journal.append(LAND, chunk(2));

    // Новый кусок записан, голова — нет. Журнал обязан остаться старым.
    await storage.setItemRaw(`chunk:${LAND}:1:0`, chunk(9));

    const restarted = fileJournal(storage);
    expect(await restarted.head(LAND)).toBe(2);
    expect(await restarted.read(LAND, 0)).toEqual([chunk(1), chunk(2)]);
  });

  it('битая голова — громкий отказ, а не молчаливо пустой журнал', async () => {
    await journal.append(LAND, chunk(1));
    await storage.setItem(`head:${LAND}`, 'мусор');

    const restarted = fileJournal(storage);
    await expect(restarted.head(LAND)).rejects.toThrow(/не разбирается/);
  });

  it('wipe забывает ленд целиком и не трогает соседний', async () => {
    await journal.append(LAND, chunk(1));
    await journal.append(OTHER, chunk(2));

    await journal.wipe(LAND);
    expect(await journal.head(LAND)).toBe(0);
    expect(await readdir(dir).then(names => names.some(name => name.includes(LAND)))).toBeFalsy();
    expect(await journal.read(OTHER, 0)).toEqual([chunk(2)]);
  });
});

describe(withLand, () => {
  it('не теряет дописанное при одновременных запросах (lost update)', async () => {
    // Без очереди оба чтения головы увидели бы ноль, и второй `append` лёг бы
    // на место первого — классический lost update.
    const writes = Array.from({ length: 8 }, (_, i) =>
      withLand(LAND, () => journal.append(LAND, chunk(i + 1))));
    await Promise.all(writes);

    expect(await journal.head(LAND)).toBe(8);
    expect(await journal.read(LAND, 0)).toHaveLength(8);
  });

  it('отказ одной операции не отравляет очередь ленда', async () => {
    const failed = withLand(LAND, () => Promise.reject(new Error('нет')));
    await expect(failed).rejects.toThrow('нет');
    await expect(withLand(LAND, () => journal.append(LAND, chunk(1)))).resolves.toBe(1);
  });
});
