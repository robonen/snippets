/**
 * Origin сервера — из `PUBLIC_ORIGIN`, НЕ из заголовка `Host`.
 *
 * `Host` подделывается запросом, а origin здесь — это то, против чего WebAuthn
 * проверяет подпись (`expectedOrigin`/`expectedRPID`) и то, с чем сверяется
 * заголовок `Origin` на WS-рукопожатии (docs/01-security.md §3, план Р1). Если
 * взять его из запроса, подделанный заголовок подделает и проверку — весь смысл
 * теряется. Источник истины ровно один: переменная окружения, та же на все
 * запросы одного процесса.
 *
 * По умолчанию — `http://localhost:4877`: адрес dev-сервера (план Р1). В проде
 * `PUBLIC_ORIGIN` обязателен по факту (без него passkey будет привязан к
 * `localhost`, а реальный браузер придёт с другого origin, и подпись не
 * сойдётся) — но не проверяется отдельно: WebAuthn это и так поймает первой же
 * попыткой входа, специальный отказ на старте добавил бы код ради диагностики,
 * которую и так не пропустить.
 */
const DEFAULT_ORIGIN = 'http://localhost:4877';

let cached: { origin: string; rpId: string } | null = null;

function parsed(): { origin: string; rpId: string } {
  if (cached !== null) return cached;
  const raw = process.env.PUBLIC_ORIGIN ?? DEFAULT_ORIGIN;
  // Хвостовой слэш режется: он не часть origin, а конфиг мог его унести
  // (`https://host/` — частая опечатка).
  const origin = raw.replace(/\/+$/, '');
  const rpId = new URL(origin).hostname;
  cached = { origin, rpId };
  return cached;
}

/** Origin сервера целиком — для `expectedOrigin` и сверки заголовка `Origin`. */
export function publicOrigin(): string {
  return parsed().origin;
}

/** RP ID WebAuthn — домен без схемы и порта (спека требует именно так). */
export function rpId(): string {
  return parsed().rpId;
}
