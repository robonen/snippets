import {
  diffOf,
  facesFromPack,
  helloPack,
  packDecode,
  packEncode,
  packPart,
} from '@sync/core';
import type { Land, LandId } from '@sync/core';

/**
 * Синхронизация с сервером-релеем (docs/server-sync.md, транспорт §2.3).
 *
 * Протокол тот же, что между вкладками: привет фейсами, дельта в ответ,
 * встречная дельта следом. Транспорт — обычный POST: пачка туда, пачка обратно.
 * Никаких подтверждений — обрыв в любой точке лечится следующим приветом,
 * поэтому расписание тупое и надёжное: старт, возврат вкладки, сеть появилась,
 * таймер. Свои записи уезжают краном ленда сразу, батчем на микрозадачу.
 */

export interface SyncServerOptions {
  readonly land: Land;
  readonly id: LandId;
  /** База сервера. Пустая строка — свой origin: сервер живёт в этом же приложении. */
  readonly url?: string;
  readonly token: string;
  /** Период приветов; по умолчанию 30 с. */
  readonly intervalMs?: number;
  /** Инжект для тестов. */
  readonly fetcher?: typeof fetch;
  readonly report?: (error: unknown) => void;
}

export interface ServerSync {
  /** Привет прямо сейчас — не дожидаясь расписания. */
  nudge(): Promise<void>;
  close(): void;
}

export function syncServer(options: SyncServerOptions): ServerSync {
  const { land, id, token } = options;
  const fetcher = options.fetcher ?? fetch;
  const report = options.report ?? ((error: unknown) => console.warn('[kcal] сервер недоступен:', error));
  const endpoint = `${(options.url ?? '').replace(/\/$/, '')}/sync/${id.str}`;

  let closed = false;

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

  /** Применить ответ сервера; на его фейсы — дослать встречную дельту. */
  async function absorb(reply: Uint8Array | null): Promise<void> {
    if (reply === null) return;
    for (const [pid, part] of packDecode(reply)) {
      if (pid.str !== id.str) continue;
      if (part.units.length > 0) land.apply(part.units, part.balls);
      if (part.faces.length > 0) {
        const delta = diffOf(land.part(), facesFromPack(part.faces));
        if (delta.units.length > 0) {
          await post(packEncode([[id, packPart({ units: delta.units, balls: delta.balls })]]));
        }
      }
    }
  }

  let busy: Promise<void> = Promise.resolve();

  function enqueue(work: () => Promise<void>): Promise<void> {
    // Обмены строго по одному: параллельный привет поверх досылки дал бы серверу
    // читать-сливать-писать вперемешку с самим собой.
    const run = busy.then(work, work).catch((error) => {
      if (!closed) report(error);
    });
    busy = run;
    return run;
  }

  const nudge = (): Promise<void> => enqueue(async () => {
    if (closed) return;
    await absorb(await post(helloPack(land, id)));
  });

  // Свои записи — сразу, как между вкладками. Чужое (из BC или с сервера) кран
  // не отдаёт, поэтому эха сервер↔вкладки нет.
  const untap = land.tap(id, (pack) => {
    void enqueue(async () => {
      if (closed) return;
      await absorb(await post(pack));
    });
  });

  const timer = setInterval(() => void nudge(), options.intervalMs ?? 30_000);
  const wake = () => void nudge();
  const visible = () => {
    if (document.visibilityState === 'visible') void nudge();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visible);
  if (typeof window !== 'undefined') globalThis.addEventListener('online', wake);

  void nudge();

  return {
    nudge,
    close() {
      closed = true;
      untap();
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visible);
      if (typeof window !== 'undefined') globalThis.removeEventListener('online', wake);
    },
  };
}
