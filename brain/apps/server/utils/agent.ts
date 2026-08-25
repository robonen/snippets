/**
 * Ярлык устройства из заголовка `user-agent` — эвристика, не парсер.
 *
 * Контракт регистрации (docs/04-server.md «Аккаунт и вход») отдаёт под
 * attestation-ответ ровно тело WebAuthn-церемонии, без отдельного поля для
 * имени устройства: просить его отдельным полем значило бы удлинять и без того
 * единственный шаг привязки («адрес сервера + токен») ещё одной формой. Ярлык
 * поэтому выводится из того, что и так едет в заголовках, — грубо, но честно:
 * это подпись credential'а для человека («какое устройство это»), не ключ
 * поиска и не часть протокола, ошибиться в паре случаев не страшно.
 */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Macintosh/, 'Mac'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'Chromebook'],
  [/Linux/, 'Linux'],
];

const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  // Порядок важен: и Edge, и Chrome, и большинство остальных несут в строке
  // подпись «Chrome/…», поэтому их узнаваемые собственные токены проверяются
  // раньше общего.
  [/OPR\//, 'Opera'],
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Version\/.+Safari\//, 'Safari'],
];

export function labelFromUserAgent(userAgent: string | undefined | null): string {
  if (userAgent === undefined || userAgent === null || userAgent === '') {
    return 'неизвестное устройство';
  }
  const device = RULES.find(([re]) => re.test(userAgent))?.[1];
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  if (device === undefined && browser === undefined) return 'неизвестное устройство';
  if (device === undefined) return browser as string;
  if (browser === undefined) return device;
  return `${browser} на ${device}`;
}
