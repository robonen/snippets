import { randomBytes } from 'node:crypto';
import { useStorage } from './storage';
import type { Storage } from 'unstorage';

/**
 * Сессии входа — по cookie, а не по токену (план Р2, docs/01-security.md §3).
 *
 * Значение cookie — случайные 32 байта, СЕРВЕР держит запись под этим же
 * ключом: непрозрачный идентификатор строки в хранилище, а не запечатанный
 * токен (`h3`'s `useSession`/`sealSession`), несущий данные сессии в себе.
 *
 * Рассмотрено и отклонено (не потому, что с `useSession` в принципе нельзя
 * получить настоящий logout — можно, но ценой, которая здесь не окупается):
 *
 * 1. `SessionConfig.password` — ОБЯЗАТЕЛЬНЫЙ секрет шифрования печати, которого
 *    нет ни в контракте задачи, ни в списке env (`SYNC_TOKEN`, `DATA_DIR`,
 *    `PORT`, `PUBLIC_ORIGIN`). Заводить его — либо новая переменная окружения
 *    сверх согласованного контракта, либо секрет, выведенный из `SYNC_TOKEN`
 *    (совмещает два разных назначения одним материалом — ровно то, от чего
 *    `packages/auth/src/crypto.ts` уводит через разный HKDF `info`), либо
 *    свежегенерируемый и хранимый в том же `useStorage()` — лишняя сущность
 *    без выигрыша против пары полей в JSON-записи ниже.
 * 2. `SessionConfig.sessionHeader` по умолчанию ВКЛЮЧЁН («Default is
 *    x-h3-session») — сессия по умолчанию принимается ещё и заголовком, не
 *    только cookie. Это ровно тот класс поверхности, которого docs/01-security.md
 *    §3 просил избежать («токен в localStorage не кладём»): забытый явный
 *    `sessionHeader: false` тихо открыл бы его обратно.
 * 3. `SessionConfig.maxAge` — абсолютное истечение от создания; поля вроде
 *    `idleTimeout` в установленной версии нет. «Скользящее» окно (контракт,
 *    §«Аккаунт и вход») пришлось бы всё равно домысливать вручную —
 *    пересобирать и переотдавать печать на каждый запрос.
 * 4. Настоящий logout сама печать НЕ даёт: подписанная cookie остаётся валидной
 *    до истечения срока, даже если сервер «забыл» про сессию. Рабочий обход —
 *    завести на credential `sessionEpoch`, класть его в печать и сверять на
 *    каждой проверке, — тоже стораджевый round-trip (`credentialOf`) на каждый
 *    запрос, тот же порядок работы, что ниже, только через косвенность.
 *
 * Итог: три вычитаемые из «встроенного» строки печати обходятся секретом,
 * которого не было в контракте, поверхностью, которую §3 велит закрыть, и
 * ручной досборкой двух свойств (скольжение, реальный logout), которые здесь
 * и так есть без обхода. Ниже — то же самое, что дал бы `useSession` с
 * epoch-полем, но без печати: `POST /auth/logout` реально гасит доступ, потому
 * что состояние живёт на сервере и удаляется по команде, а не потому, что
 * cookie перестаёт быть валидной сама по себе.
 *
 * Само значение cookie угадать нельзя (256 бит), поэтому поиск по ключу
 * хранилища не нуждается в constant-time сравнении: в отличие от короткого
 * `SYNC_TOKEN` (`utils/auth.ts`), сравнивать здесь по сути нечего — атака
 * подбором на 256-битный секрет не строится вокруг тайминга поиска по ключу.
 */

export const SESSION_COOKIE = 'brain_session';

/** Скользящее окно — «30 дней», docs/04-server.md «Аккаунт и вход». */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Не переписывать запись чаще раза в час: без этой границы каждый HTTP-опрос
 * фолбэка продлевал бы файл сессии — «скользящее» не обязано быть «на каждый
 * байт трафика».
 */
const TOUCH_GRACE_MS = 60 * 60 * 1000;

interface SessionRecord {
  readonly createdAt: number;
  expiresAt: number;
}

function isRecord(value: unknown): value is SessionRecord {
  return typeof value === 'object' && value !== null
    && typeof (value as SessionRecord).createdAt === 'number'
    && typeof (value as SessionRecord).expiresAt === 'number';
}

/**
 * `storage` — необязательный ПОСЛЕДНИЙ параметр во всех трёх функциях, а не
 * скрытый обход через `useStorage()` внутри: маршруты вызывают их как есть и
 * получают синглтон инстанса, а тесты подают свой `unstorage` на памяти и не
 * воюют с одним и тем же файлом на диске (тот же приём, что `fileJournal(storage)`
 * у `journal.ts` — разница только в том, что там это единственная форма, а
 * здесь синглтон остаётся ради односложных вызовов из роутов).
 */
export async function createSession(
  storage: Storage = useStorage(),
): Promise<{ id: string; expiresAt: number; maxAgeSeconds: number }> {
  const id = randomBytes(32).toString('base64url');
  const now = Date.now();
  const record: SessionRecord = { createdAt: now, expiresAt: now + SESSION_TTL_MS };
  await storage.setItem(`session:${id}`, record);
  return { id, expiresAt: record.expiresAt, maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000) };
}

/**
 * Жива ли сессия. Побочный эффект намеренный: истёкшая запись стирается тут
 * же (ленивая уборка, тот же приём, что `sweep` в `journal.ts` — не отдельный
 * cron, а очистка на следующем касании), а живая — продлевается, если давно не
 * трогали.
 */
export async function sessionValid(
  id: string | undefined | null,
  storage: Storage = useStorage(),
): Promise<boolean> {
  if (id === undefined || id === null || id === '') return false;
  const key = `session:${id}`;
  const found: unknown = await storage.getItem(key);
  if (!isRecord(found)) return false;

  const now = Date.now();
  if (now > found.expiresAt) {
    await storage.removeItem(key);
    return false;
  }
  if (found.expiresAt - now < SESSION_TTL_MS - TOUCH_GRACE_MS) {
    await storage.setItem(key, { ...found, expiresAt: now + SESSION_TTL_MS } satisfies SessionRecord);
  }
  return true;
}

export async function destroySession(
  id: string | undefined | null,
  storage: Storage = useStorage(),
): Promise<void> {
  if (id === undefined || id === null || id === '') return;
  await storage.removeItem(`session:${id}`);
}

/**
 * Значение cookie по имени из сырого заголовка `Cookie`.
 *
 * Не `getCookie` из `nitro/h3`: та ждёт `HTTPEvent` (`{ req: TypedServerRequest }`),
 * а на WS-рукопожатии (`routes/sync/index.ts`) в руках только сырой `Request` —
 * структурно он `TypedServerRequest` не удовлетворяет (`json()` возвращает
 * `Promise<unknown>` вместо ожидаемого `Promise<{}>`, проверено `tsc`). Значения
 * наших cookie — base64url (без `;`, `=`-довесков и пробелов), поэтому наивного
 * разбора формата `k=v; k2=v2` достаточно и он не нуждается в библиотеке.
 */
export function cookieFromHeader(header: string | null | undefined, name: string): string | undefined {
  if (header === null || header === undefined) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return part.slice(eq + 1).trim();
  }
  return undefined;
}
