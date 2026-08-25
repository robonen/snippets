/**
 * `@brain/sync-wire` — проводной формат синка.
 *
 * Общая граница клиента (`apps/web/src/sync`) и сервера (`server/`): кадры
 * WebSocket, куски журнала и их кодирование в HTTP-фолбэке. Пакет нарочно без
 * зависимостей — ни крипты, ни CRDT: обе стороны видят здесь только байты.
 */

export {
  CHUNK_NONCE,
  LAND_CHARS,
  chunkFromWire,
  chunkToWire,
  decodeChunkList,
  decodeFrame,
  encodeChunkList,
  encodeFrame,
  landOk,
} from './frames';
export type { Frame, WireChunk } from './frames';
