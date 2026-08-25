import { useRuntimeConfig } from 'nitro/runtime-config';

/**
 * Типизированный доступ к runtimeConfig (`nitro.config.ts`): значения приходят
 * из окружения процесса поверх умолчаний сборки — плоские имена (`SYNC_TOKEN`,
 * `PUBLIC_ORIGIN`, `DATA_DIR`, `CLOUDFLARE_KV_*`), см. `envPrefix` в конфиге.
 */

export interface CloudflareKvConfig {
  readonly accountId: string;
  readonly namespaceId: string;
  readonly apiToken: string;
}

declare module 'nitro/types' {
  interface NitroRuntimeConfig {
    syncToken: string;
    publicOrigin: string;
    dataDir: string;
    cloudflareKv: CloudflareKvConfig;
  }
}

export interface ServerConfig {
  readonly syncToken: string;
  readonly publicOrigin: string;
  readonly dataDir: string;
  readonly cloudflareKv: CloudflareKvConfig;
}

let cached: ServerConfig | null = null;

export function serverConfig(): ServerConfig {
  if (cached !== null) return cached;
  const config = useRuntimeConfig();
  cached = {
    syncToken: config.syncToken,
    // Хвостовой слэш режется: он не часть origin, а конфиг мог его унести
    // (`https://host/` — частая опечатка).
    publicOrigin: config.publicOrigin.replace(/\/+$/, ''),
    dataDir: config.dataDir,
    cloudflareKv: config.cloudflareKv,
  };
  return cached;
}
