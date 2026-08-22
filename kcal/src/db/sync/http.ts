import { helloPack } from '@sync/core';
import type { Land, LandId } from '@sync/core';
import { absorbPack } from './protocol';

/**
 * Транспорт 1 — POST (docs/server-sync.md §2.3): пачка туда, пачка обратно.
 *
 * Работает везде и всегда: это страховка под сокетом и единственный путь, когда
 * сокет не поднялся. Подтверждений нет — обрыв в любой точке лечится следующим
 * приветом.
 */

export interface HttpOptions {
  readonly land: Land;
  readonly id: LandId;
  /** База сервера. Пустая строка — свой origin: сервер живёт в этом же приложении. */
  readonly url?: string;
  readonly token: string;
  /** Инжект для тестов. */
  readonly fetcher?: typeof fetch;
}

export interface HttpSync {
  /** Отправить пачку и разобрать ответ (включая досылку встречной дельты). */
  send(bytes: Uint8Array): Promise<void>;
  /** Привет фейсами — «вот моё состояние, дошли недостающее». */
  hello(): Promise<void>;
}

export function httpSync(options: HttpOptions): HttpSync {
  const { land, id, token } = options;
  const fetcher = options.fetcher ?? fetch;
  const endpoint = `${(options.url ?? '').replace(/\/$/, '')}/sync/${id.str}`;

  async function post(bytes: Uint8Array): Promise<Uint8Array | null> {
    const res = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/octet-stream',
      },
      body: bytes as unknown as BodyInit,
    });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`синхронизация: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async function send(bytes: Uint8Array): Promise<void> {
    const reply = await post(bytes);
    if (reply === null) return;
    const answer = absorbPack(land, id, reply);
    if (answer !== null) await post(answer);
  }

  return {
    send,
    hello: () => send(helloPack(land, id)),
  };
}
