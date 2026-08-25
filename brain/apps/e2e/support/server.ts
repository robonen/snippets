import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { type ChildProcess, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Поднять СОБРАННЫЙ сервер (`node .output/server/index.mjs`) на своём порту, со
 * своим `DATA_DIR` и своим `SYNC_TOKEN` — живая проверка гоняется на РЕАЛЬНОМ
 * билде, не на `nitro dev`: единый origin (план Р1), `publicAssets` и
 * SPA-фолбэк собираются только билдом, а зона роста dev-режима — прокси Vite —
 * здесь и не нужна (сервер сам отдаёт PWA).
 *
 * НЕ собирает сам: билд — забота гейта (`pnpm build && pnpm --filter
 * @brain/server build`, тот же порядок, что в docs/04-server.md), а не e2e —
 * иначе тест молча перестраивал бы приложение и путал причину падения с
 * причиной пересборки.
 */

export interface LiveServer {
  readonly url: string;
  readonly token: string;
  readonly dataDir: string;
  stop: () => Promise<void>;
}

const SERVER_ENTRY = fileURLToPath(new URL('../../server/.output/server/index.mjs', import.meta.url));

export async function startServer(port: number): Promise<LiveServer> {
  const dataDir = await mkdtemp(join(tmpdir(), 'brain-e2e-'));
  const token = randomBytes(16).toString('base64url');
  const url = `http://localhost:${port}`;

  let child: ChildProcess;
  try {
    child = spawn('node', [SERVER_ENTRY], {
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: dataDir,
        SYNC_TOKEN: token,
        PUBLIC_ORIGIN: url,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  catch (error) {
    await rm(dataDir, { recursive: true, force: true });
    throw new Error(
      `не удалось запустить собранный сервер (${SERVER_ENTRY}): ${String(error)}. `
      + 'Собран ли он — `pnpm build && pnpm --filter @brain/server build` из корня brain?',
    );
  }

  const crashed = new Promise<never>((_, reject) => {
    child.once('exit', (code) => {
      reject(new Error(`сервер завершился раньше готовности (код ${code}) — смотри вывод nitro build`));
    });
    child.once('error', reject);
  });

  await Promise.race([waitForReady(url), crashed]);

  return {
    url,
    token,
    dataDir,
    async stop() {
      child.kill();
      await new Promise<void>((done) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          done();
          return;
        }
        child.once('exit', () => done());
      });
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** Опрос `/auth/session` (публичный, не требует cookie) — сервер отвечает 200, когда готов. */
async function waitForReady(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/auth/session`);
      if (res.ok) return;
      lastError = new Error(`неожиданный статус ${res.status}`);
    }
    catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`сервер не ответил за ${timeoutMs} мс: ${String(lastError)}`);
}
