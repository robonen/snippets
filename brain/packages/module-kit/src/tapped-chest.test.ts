import { describe, expect, it, vi } from 'vitest';
import { memoryChest } from './sealed';
import { tappedChest } from './tapped-chest';
import { landId } from './land';
import type { Sealed } from '@brain/auth';
import type { LandId } from '@sync/core';

const LAND = landId('notes');

const sealed = (byte: number): Sealed => ({
  nonce: new Uint8Array(12).fill(byte),
  cipher: new Uint8Array(20).fill(byte),
});

describe(tappedChest, () => {
  it('сообщает про дописанные куски с их номерами', async () => {
    const seen: Array<[string, number]> = [];
    const chest = tappedChest(memoryChest(), {
      onAppend: (land, chunk, at) => seen.push([`${land.str}:${chunk.nonce[0]}`, at]),
    });

    await chest.append(LAND, sealed(1));
    await chest.append(LAND, sealed(2));

    expect(seen).toEqual([[`${LAND.str}:1`, 0], [`${LAND.str}:2`, 1]]);
  });

  it('продолжает нумерацию от того, что уже лежало в журнале', async () => {
    const inner = memoryChest();
    await inner.append(LAND, sealed(1));
    await inner.append(LAND, sealed(2));

    const seen: number[] = [];
    const chest = tappedChest(inner, { onAppend: (_land, _chunk, at) => seen.push(at) });

    // Так поднимается ленд: `sealedStore.hydrate` читает журнал целиком.
    expect(await chest.read(LAND)).toHaveLength(2);
    await chest.append(LAND, sealed(3));

    expect(seen).toEqual([2]);
  });

  it('компакция — отдельное событие, и нумерация после неё начинается заново', async () => {
    const events: string[] = [];
    const chest = tappedChest(memoryChest(), {
      onAppend: (_land, _chunk, at) => events.push(`append:${at}`),
      onReplace: () => events.push('replace'),
    });

    await chest.append(LAND, sealed(1));
    await chest.append(LAND, sealed(2));
    await chest.replace(LAND, sealed(9));
    await chest.append(LAND, sealed(3));

    expect(events).toEqual(['append:0', 'append:1', 'replace', 'append:1']);
  });

  it('не сообщает про кусок, который носитель не принял', async () => {
    const onAppend = vi.fn();
    const broken = {
      ...memoryChest(),
      append: () => Promise.reject(new Error('диск полон')),
    };
    const chest = tappedChest(broken, { onAppend });

    await expect(chest.append(LAND, sealed(1))).rejects.toThrow('диск полон');
    expect(onAppend).not.toHaveBeenCalled();
  });

  it('отказ слушателя не роняет сохранение', async () => {
    const inner = memoryChest();
    const chest = tappedChest(inner, {
      onAppend: () => {
        throw new Error('сервер недоступен');
      },
    });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(chest.append(LAND, sealed(1))).resolves.toBeUndefined();
    expect(await inner.read(LAND)).toHaveLength(1);
    quiet.mockRestore();
  });

  it('пропускает наружу остальной контракт сундука', async () => {
    const inner = memoryChest();
    const wiped: LandId[] = [];
    const chest = tappedChest(inner, { onWipe: land => wiped.push(land) });

    await chest.append(LAND, sealed(1));
    expect(await chest.lands()).toEqual([LAND]);

    await chest.wipe(LAND);
    expect(wiped).toEqual([LAND]);
    expect(await chest.read(LAND)).toEqual([]);
  });
});
