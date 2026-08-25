import { createStorage } from 'unstorage';
import { beforeEach, describe, expect, it } from 'vitest';
import { isWrapKind, listWraps, replaceWraps } from './wraps';
import type { StoredWrap } from './wraps';
import type { Storage } from 'unstorage';

let storage: Storage;

beforeEach(() => {
  storage = createStorage();
});

const wrap = (patch: Partial<StoredWrap> = {}): StoredWrap => ({
  label: 'passkey',
  kind: 'passkey',
  blob: 'YmFzZTY0dXJs',
  ...patch,
});

describe(isWrapKind, () => {
  it('passkey и passphrase — годятся', () => {
    expect(isWrapKind('passkey')).toBeTruthy();
    expect(isWrapKind('passphrase')).toBeTruthy();
  });

  it('device и что угодно ещё — не годятся: ключ устройства не покидает устройство', () => {
    expect(isWrapKind('device')).toBeFalsy();
    expect(isWrapKind('')).toBeFalsy();
    expect(isWrapKind(undefined)).toBeFalsy();
    expect(isWrapKind(42)).toBeFalsy();
  });
});

describe(listWraps, () => {
  it('пусто, пока ничего не положили', async () => {
    expect(await listWraps(storage)).toEqual([]);
  });

  it('отдаёт положенные обёртки как есть', async () => {
    await replaceWraps([wrap({ label: 'a' }), wrap({ label: 'b', kind: 'passphrase' })], storage);
    const listed = await listWraps(storage);
    expect(listed).toHaveLength(2);
    expect(listed.map(w => w.label).sort()).toEqual(['a', 'b']);
  });

  it('не путает свой префикс с чужими ключами того же хранилища', async () => {
    await storage.setItem('session:постороннее', { x: 1 });
    await replaceWraps([wrap()], storage);
    expect(await listWraps(storage)).toEqual([wrap()]);
  });
});

describe(replaceWraps, () => {
  it('замещает набор ЦЕЛИКОМ: старое, не попавшее в новый список, исчезает', async () => {
    await replaceWraps([wrap({ label: 'старый' })], storage);
    await replaceWraps([wrap({ label: 'новый' })], storage);
    const listed = await listWraps(storage);
    expect(listed.map(w => w.label)).toEqual(['новый']);
  });

  it('пустой список — стирает все обёртки', async () => {
    await replaceWraps([wrap()], storage);
    await replaceWraps([], storage);
    expect(await listWraps(storage)).toEqual([]);
  });

  it('одна и та же метка в новом наборе — заменяет значение, а не дублирует', async () => {
    await replaceWraps([wrap({ label: 'x', blob: 'старое' })], storage);
    await replaceWraps([wrap({ label: 'x', blob: 'новое' })], storage);
    const listed = await listWraps(storage);
    expect(listed).toEqual([wrap({ label: 'x', blob: 'новое' })]);
  });
});
