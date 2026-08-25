import { createStorage } from 'unstorage';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountUserHandle, bumpCounter, credentialOf, saveCredential } from './credentials';
import type { StoredCredential } from './credentials';
import type { Storage } from 'unstorage';

let storage: Storage;

beforeEach(() => {
  storage = createStorage();
});

const credential = (patch: Partial<StoredCredential> = {}): StoredCredential => ({
  id: 'cred-1',
  publicKey: 'cG9zaXRpdmU', // произвольные base64url-байты, содержимое сервер не читает
  counter: 0,
  transports: ['internal'],
  userHandle: 'dXNlcg',
  label: 'Chrome на Mac',
  createdAt: 1000,
  ...patch,
});

describe(accountUserHandle, () => {
  it('заводится один раз и переживает повторные вызовы — тот же аккаунт', async () => {
    const first = await accountUserHandle(storage);
    const second = await accountUserHandle(storage);
    expect(second).toEqual(first);
  });

  it('16 байт — как и заводит', async () => {
    const handle = await accountUserHandle(storage);
    expect(handle).toHaveLength(16);
  });
});

describe(saveCredential, () => {
  it('сохранённый credential читается обратно тем же по значению', async () => {
    await saveCredential(credential(), storage);
    expect(await credentialOf('cred-1', storage)).toEqual(credential());
  });
});

describe(credentialOf, () => {
  it('незнакомый id — null, не отказ', async () => {
    expect(await credentialOf('нет-такого', storage)).toBeNull();
  });

  it('битая запись в хранилище — null', async () => {
    await storage.setItem('credential:кривой', { id: 'кривой' }); // без остальных обязательных полей
    expect(await credentialOf('кривой', storage)).toBeNull();
  });
});

describe(bumpCounter, () => {
  it('переписывает СЧЁТЧИК, остальные поля остаются как были', async () => {
    await saveCredential(credential({ counter: 5 }), storage);
    await bumpCounter('cred-1', 42, storage);
    expect(await credentialOf('cred-1', storage)).toEqual(credential({ counter: 42 }));
  });

  it('незнакомый credential — тихий no-op, не создаёт запись из ничего', async () => {
    await bumpCounter('призрак', 1, storage);
    expect(await credentialOf('призрак', storage)).toBeNull();
  });
});
