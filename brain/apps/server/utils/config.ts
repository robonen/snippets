import { useRuntimeConfig } from 'nitro/runtime-config';

/**
 * Типизированный доступ к runtimeConfig (`nitro.config.ts`): значения приходят
 * из окружения процесса (`SYNC_TOKEN`, `PUBLIC_ORIGIN`, `DATA_DIR` — плоские
 * имена, см. `envPrefix` в конфиге) поверх умолчаний сборки.
 */
declare module 'nitro/types' {
  interface NitroRuntimeConfig {
    syncToken: string;
    publicOrigin: string;
    dataDir: string;
  }
}

export interface ServerConfig {
  readonly syncToken: string;
  readonly publicOrigin: string;
  readonly dataDir: string;
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
  };
  return cached;
}
