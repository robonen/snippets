import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `origin.ts` кеширует разбор `PUBLIC_ORIGIN` в модульной переменной (один
 * процесс — один сервер, значение не меняется на лету). Поэтому каждый тест
 * сбрасывает РЕЕСТР МОДУЛЕЙ и импортирует файл заново — иначе второй тест
 * увидел бы значение, разобранное для первого.
 */

const saved = process.env.PUBLIC_ORIGIN;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (saved === undefined) delete process.env.PUBLIC_ORIGIN;
  else process.env.PUBLIC_ORIGIN = saved;
});

describe('publicOrigin/rpId', () => {
  it('без PUBLIC_ORIGIN — дев-умолчание localhost:4877', async () => {
    delete process.env.PUBLIC_ORIGIN;
    const { publicOrigin, rpId } = await import('./origin');
    expect(publicOrigin()).toBe('http://localhost:4877');
    expect(rpId()).toBe('localhost');
  });

  it('rpId — домен БЕЗ схемы и порта, как того требует WebAuthn', async () => {
    process.env.PUBLIC_ORIGIN = 'https://brain.example.com:8443';
    const { publicOrigin, rpId } = await import('./origin');
    expect(publicOrigin()).toBe('https://brain.example.com:8443');
    expect(rpId()).toBe('brain.example.com');
  });

  it('хвостовой слэш срезается — «сохранил один адрес, вижу другой» не должно случаться', async () => {
    process.env.PUBLIC_ORIGIN = 'https://brain.example.com/';
    const { publicOrigin } = await import('./origin');
    expect(publicOrigin()).toBe('https://brain.example.com');
  });

  it('значение кешируется на процесс: смена env после первого вызова не видна', async () => {
    process.env.PUBLIC_ORIGIN = 'https://first.example.com';
    const { publicOrigin } = await import('./origin');
    expect(publicOrigin()).toBe('https://first.example.com');

    process.env.PUBLIC_ORIGIN = 'https://second.example.com';
    // Тот же модульный инстанс (без повторного resetModules) — старое значение.
    expect(publicOrigin()).toBe('https://first.example.com');
  });
});
