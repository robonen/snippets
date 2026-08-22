# Синхронизация между устройствами: сервер на Nitro + Vercel

Как добавить дневнику синхронизацию через сервер — профиля и всего остального.
Написано по состоянию платформ на август 2026: Nitro v3 beta, WebSocket на
Vercel Functions (поддержка появилась в июне 2026).

---

## 0. Главное, из чего всё следует

**Протокол уже существует и работает.** Между вкладками дневник синхронизируется
пачками формата `docs/03` ядра: привет фейсами (`faces ✓ units ✗`), ответ
дельтой (`faces ✓ units ✓`), поток нового (`faces ✗ units ✓`). `Fail Summ`
ловит выборочные потери, повторная доставка идемпотентна, подтверждений нет —
обрыв в любой точке лечится следующим приветом. Всё это уже экспортировано из
`@sync/core`: `facesOf`, `diffOf`, `facesToPack`, `packEncode`/`packDecode`.

**Сервер — не арбитр, а такой же пир** (docs/08 §5 ядра): всегда онлайн и с
диском. Он не понимает «профиль» и «запись дневника» — он хранит и пересылает
пачки байтов. Когда в ядре появится шифрование (S6), сервер станет полностью
слепым без единой правки протокола.

**Транспорт взаимозаменяем.** Тот же обмен работает и по WebSocket, и обычным
HTTP запрос-ответом: пачка туда — пачка обратно. Это спасает от всех
serverless-ограничений разом.

**Что именно синхронизируется.** Ленд целиком — профиль внутри него вместе с
дневником: ленд и есть единица синхронизации. Если когда-нибудь понадобится
синхронизировать *только* профиль (дневник — приватно-локальный), профиль
выносится в отдельный ленд со своим `LandId` — механизм тот же, меняется только
адрес.

---

## 1. Реальность платформ (проверено, не по памяти)

### Vercel

- **WebSocket в функциях поддерживается нативно** — «Vercel Functions natively
  support WebSocket connections» (появилось ~июнь 2026).
- **Соединение живёт не дольше `maxDuration` функции** — «активные подключения
  остаются привязаны к функции в течение её maximum duration». Поднимается через
  `vercel.functionRules` (в примерах — до 800 с). То есть **раз в N минут
  соединение умирает штатно** — это не сбой, это модель платформы.
- **Новые соединения попадают на другие инстансы** — «Future connections are not
  guaranteed to connect to the same Function». Два устройства могут висеть на
  разных инстансах, и `peer.publish` одного инстанса второй не услышит.
- Для состояния между инстансами Vercel рекомендует **Redis из Marketplace**.

### Nitro v3 (beta)

- WebSocket: `defineWebSocketHandler({ upgrade, open, message, close, error })`
  в обычном файле роута (`routes/sync/[land].ts` → путь `/sync/:land`), включается
  `features: { websocket: true }`.
- Встроенный pub/sub: `peer.subscribe(topic)` / `peer.publish(topic, data)` —
  **внутри одного инстанса**.
- Заявленные платформы WS: Node.js, Bun, Deno, Cloudflare Workers.
  **Vercel-пресет поддержку WS не заявляет** — платформа уже умеет, обвязка
  пресета может отставать. Это надо проверить одним деплоем; план ниже не
  ломается в любом исходе.

**Вывод, который всё упрощает:** на Vercel переподключение — норма жизни. Наш
протокол к этому готов по построению: hello-фейсы на каждом коннекте закрывают
любой пропуск. Значит, дизайн не «WebSocket с страховками», а **один протокол на
двух транспортах**: HTTP запрос-ответ как базовый (работает на чём угодно) и
WS как ускоритель доставки, где он доступен.

---

## 2. Архитектура

```
устройство A ──┐                       ┌── устройство B
  вкладки ⇄ BC │   POST /sync/:land    │ вкладки ⇄ BC
  IndexedDB    ├──⇄ Nitro (пир) ⇄──────┤ IndexedDB
               │        │              │
               └────────┼──────────────┘
                     Redis:
                     - пачка ленда (байты)  ← UnitStore
                     - pub/sub `land:<id>`  ← fan-out между инстансами
```

### 2.1 Сервер — ленд поверх Redis

Серверное состояние — **одна запись в Redis: пачка байтов ленда**. Наш контракт
`UnitStore` (`load`/`save` пачки) ложится на `GET`/`SET` буфера один в один.
Инстанс функции восстанавливает ленд на запрос и сохраняет обратно — цена
известна из замеров ядра: разбор пачки 10 000 юнитов ≈ 1 мс, приём ≈ 3 мс;
дневник на годы — это тысячи юнитов, то есть доли миллисекунды.

```ts
// server/utils/land.ts
import { Land, Link, packEncode, packPart } from '@sync/core';
import type { LandId } from '@sync/core';

const SERVER_PEER = Link.peer(/* 8 байт из env: пир сервера */);

/** Поднять серверную реплику ленда из Redis. Пусто — свежий ленд. */
export async function landOf(id: LandId, redis: Redis): Promise<Land> {
  const land = new Land(SERVER_PEER, { now: () => Math.floor(Date.now() / 1000) });
  const bin = await redis.getBuffer(`land:${id.str}`);
  if (bin !== null) land.adopt(new Uint8Array(bin));
  return land;
}

export async function saveLand(id: LandId, land: Land, redis: Redis): Promise<void> {
  const part = land.part();
  await redis.set(`land:${id.str}`, Buffer.from(
    packEncode([[id, packPart(part)]]),
  ));
}
```

Сервер **ничего не чеканит сам** (не пишет своих юнитов) — сеанс чеканки ему не
нужен, конфликтов инстансов по `self` нет. Гонка двух инстансов на `SET` —
классический lost-update; лечится `WATCH`/Lua-скриптом «прочитай-слей-запиши»
либо честным `SETNX`-локом на ленд на время запроса. Для одного пользователя с
двумя устройствами хватает лока; дальше — Lua.

### 2.2 Обмен — тот же, что между вкладками

Логика одного входящего сообщения — дословно ветка из `wire/tabs.ts` ядра:

```ts
// server/utils/exchange.ts
import { diffOf, facesFromPack, facesOf, facesToPack, packDecode, packEncode, packPart } from '@sync/core';

/** Пачка вошла — пачка вышла (или null, если отвечать нечего). */
export function exchange(land: Land, id: LandId, bytes: Uint8Array): Uint8Array | null {
  for (const [pid, part] of packDecode(bytes)) {
    if (pid.str !== id.str) continue;

    if (part.units.length > 0) land.apply(part.units, part.balls);

    if (part.faces.length > 0) {
      const mine = land.part();
      const delta = diffOf(mine, facesFromPack(part.faces));
      // Сервер на привет отвечает всегда: дельта (пусть пустая) + свои фейсы —
      // по ним клиент посчитает встречную и дошлёт своё.
      return packEncode([[id, packPart({
        units: delta.units,
        balls: delta.balls,
        faces: facesToPack(facesOf(mine)),
      })]]);
    }
  }
  return null;
}
```

### 2.3 Транспорт 1 — HTTP запрос-ответ (базовый, работает везде)

```ts
// routes/sync/[land].post.ts
export default defineEventHandler(async (event) => {
  const user = await authorize(event);                  // §4
  const id = landIdOf(getRouterParam(event, 'land'), user);

  const bytes = new Uint8Array(await readRawBody(event, false));
  const redis = useRedis();

  await withLandLock(redis, id, async () => {
    const land = await landOf(id, redis);
    const before = land.size();
    const reply = exchange(land, id, bytes);
    if (land.size() !== before) {
      await saveLand(id, land, redis);
      // Толчок подписчикам живого транспорта (§2.4) — через Redis, не память.
      await redis.publish(`land:${id.str}`, 'fresh');
    }
    if (reply !== null) {
      setHeader(event, 'content-type', 'application/octet-stream');
      return reply;
    }
    setResponseStatus(event, 204);
  });
});
```

Клиент шлёт **привет** (фейсы) при старте, по `visibilitychange`, по таймеру
(раз в 30–60 с) и **пачку крана** после локальной записи — кран `Land.tap` уже
батчит на микрозадаче, то есть транзакция правок уезжает одним POST. Ответ
применяется `land.apply`. Всё — синхронизация между устройствами работает,
задержка = интервал опроса.

### 2.4 Транспорт 2 — WebSocket (живая доставка)

```ts
// nitro.config.ts
export default defineConfig({ features: { websocket: true } });

// routes/sync/[land].ts
export default defineWebSocketHandler({
  async upgrade(request) { await authorize(request); },
  async open(peer) {
    const id = landIdOfPeer(peer);
    peer.subscribe(`land:${id.str}`);                    // fan-out в инстансе
    subscribeRedis(peer, id);                            // fan-out между инстансами
  },
  async message(peer, message) {
    const id = landIdOfPeer(peer);
    const redis = useRedis();
    await withLandLock(redis, id, async () => {
      const land = await landOf(id, redis);
      const before = land.size();
      const reply = exchange(land, id, message.uint8Array());
      if (land.size() !== before) {
        await saveLand(id, land, redis);
        // Свежие юниты — всем остальным устройствам этого ленда.
        peer.publish(`land:${id.str}`, lastIncoming);    // в своём инстансе
        await redis.publish(`land:${id.str}:bin`, ...);  // в чужие инстансы
      }
      if (reply !== null) peer.send(reply);
    });
  },
});
```

Клиентский порт — реализация того же интерфейса `Port` из ядра, что у
`BroadcastChannel`: `wsPort(url)` с реконнектом (экспоненциальный backoff) и
**приветом на каждом коннекте**. Разрыв раз в `maxDuration` на Vercel при этом
неотличим от любого другого разрыва — и уже вылечен протоколом.

Порядок включения: сначала §2.3 (гарантированно работает на Vercel сегодня),
затем WS. Если Vercel-пресет Nitro ещё не прокидывает WS (платформа умеет,
пресет не заявляет) — WS-часть без единой правки уезжает на любой Node-хост
(Railway/Fly/свой VPS), а фронт остаётся на Vercel; либо ждёт пресета, а
устройства живут на §2.3.

---

## 3. Клиентская часть в kcal

`src/db/space.ts` дополняется третьей строкой обвязки:

```ts
const tabs = syncTabs({ land, id: LAND_ID });            // уже есть
const server = syncServer({ land, id: LAND_ID, url, token }); // новое
```

`syncServer` — это `syncTabs` с другим портом плюс расписание приветов. Общую
обработку пачки стоит вынести в ядро (`wire/exchange.ts`) — она сегодня
дублируется между `tabs.ts` и сервером. Важная деталь: юниты, пришедшие с
сервера, попадают в журнал хранилища (писатель сохраняет услышанное) и **не
попадают в кран** — эха между сервером и каналом вкладок нет по построению:
кран отдаёт только собственные записи этой вкладки.

---

## 4. Авторизация и границы

- До S6 (подписи юнитов) сервер обязан хотя бы знать, **чей это ленд**: токен →
  пользователь → разрешённые `LandId`. Для личного дневника достаточно одного
  секрета в env и заголовка `authorization` — это час работы, не система.
- `LandId` клиента сегодня фиксированный (`kcalkcal`) — для сервера он должен
  стать производным от пользователя (`Link.land(userPeer, area)`), иначе два
  пользователя сольются в один ленд. Это правка одной константы в `space.ts`.
- CORS: пачки — `application/octet-stream`, preflight настраивается на роуте.
- Тело POST — сырые байты; `readRawBody(event, false)` в Nitro отдаёт Buffer.

---

## 5. Чего НЕ делать

- **Не REST по сущностям** («PUT /profile», «POST /entries») — это возврат к
  предметной области vue-sync-engine, которую ADR-018 закрыл: появятся версии,
  конфликты, откаты. Пачка уже решает всё это на уровне юнитов.
- **Не мерж на сервере руками** — сервер не разбирает значения; `apply` ленда и
  есть мерж.
- **Не хранить на сервере распакованное** (JSON в Postgres по полям) — пачка
  байтов и есть каноническое хранение; распаковка сломает слепоту к содержимому
  и подписи S6.
- **Не полагаться на память инстанса** — на Vercel каждый запрос может прийти в
  свежий инстанс; истина в Redis, память — кэш с проверкой поколения.

## 6. Порядок работ — состояние

| шаг | что | статус |
|---|---|---|
| 1 | `wire/exchange.ts` в ядре: `helloPack` + `exchange` (сервер отвечает на привет всегда) | ✅ + 4 теста |
| 2 | Nitro-проект `kcal/server`: POST-роут, unstorage-хранилище (fs в dev, Redis по `REDIS_URL`), очередь на ленд в инстансе | ✅ дым по HTTP прошёл |
| 3 | клиентский `syncServer` в `src/db/server.ts`: кран + расписание приветов (старт, `visibilitychange`, `online`, таймер) | ✅ 3 теста против настоящего `exchange` |
| 4 | токен (`SYNC_TOKEN` на сервере, `VITE_SYNC_URL`/`VITE_SYNC_TOKEN` в приложении); без env дневник полностью локален | ✅ |
| 5 | сборка под Vercel-пресет | ✅ `NITRO_PRESET=vercel nitro build` собирает функции |
| 6 | WS-роут + вещание `peer.publish` в инстансе | ✅ дым по WS прошёл; Redis pub/sub между инстансами — не сделан |

**Уточнения, всплывшие при реализации (Nitro v3 beta):**

- **v3 живёт Vite-плагином**: `plugins: [nitro()]` из `nitro/vite`, весь конфиг
  nitro — ключом `nitro` прямо в `vite.config.ts`, скрипты — `vite dev` /
  `vite build`; отдельного `nitro.config.ts` нет;
- корень серверных исходников по умолчанию `server/` — наш проект и есть сервер,
  поэтому `nitro.serverDir: '.'`;
- `tsconfig.json` наследует штатный экспорт `nitro/tsconfig` — свой шаблон
  prepare не пишет, а битый extends роняет резолвер rolldown;
- автоимпортов в v3 нет — h3-утилиты явными импортами из `nitro/h3`,
  `useStorage` — из `nitro/storage`;
- симлинк `@sync/core` лежит за корнем проекта — dev-серверу нужен
  `server.fs.allow` на каталог ядра;
- **токен для WS — в query** (`/sync/:land?token=…`): браузерный WebSocket не
  умеет ставить свои заголовки на рукопожатие; HTTP-роут остаётся на
  `authorization: Bearer`.

**Деплой:** `pnpm build` (пресет vercel включается сам по env `VERCEL`), env —
`SYNC_TOKEN` для функций, `VITE_SYNC_TOKEN` тем же значением для клиента (он
вшивается НА СБОРКЕ — после добавления нужен новый деплой) и `REDIS_URL` из
Marketplace: файловый драйвер на Vercel бесполезен, ФС функции эфемерна.
Драйвер redis из unstorage тянет пакет `ioredis` — он в зависимостях, без него
сборка падает на рендере чанков. Дымовые скрипты — `server/smoke.mjs` (HTTP) и
`server/ws-smoke.mjs` (WS): `SYNC_TOKEN=… pnpm dev` и
`SYNC_TOKEN=… node server/smoke.mjs http://localhost:3000`.

## 7. PWA рядом с nitro — четыре грабли

Сервис-воркер и nitro делят одну статику, и все ошибки здесь тихие: сборка
зелёная, а офлайн мёртв. Порядок, который работает (закреплён
`scripts/check-pwa.mjs`, он роняет сборку):

1. **Писать sw.js сразу в статику nitro** (`outDir: STATIC_DIR`). Nitro
   индексирует public на сборке; файл, доложенный после, он отдаёт рендерером с
   `text/html`, и браузер отказывается регистрировать такой воркер.
2. **Плагин PWA — только в клиентском окружении** (`applyToEnvironment`). Иначе
   он пишет sw.js дважды, индексация проходит между записями, и сервер отдаёт
   файл обрезанным по устаревшей длине — воркер падает на выполнении.
3. **`globDirectory` — статика nitro, а не `dist`** (на Vercel это
   `.vercel/output/static`, и пресет там определяется по env `VERCEL`, а не по
   `NITRO_PRESET`). Иначе манифест прекеша пуст.
4. **`index.html` попадает в прекеш только на клиентской фазе**, пока файл ещё
   лежит в статике: дальше nitro забирает его как шаблон рендерера. Добавлять
   его руками через `additionalManifestEntries` нельзя — выйдет дубль с разными
   ревизиями, а это отказ установки. Без него `navigateFallback` роняет воркер
   ошибкой `non-precached-url`.

---

Источники по платформам: [Vercel KB: WebSocket в функциях](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections),
[Nitro: WebSocket](https://nitro.build/raw/docs/websocket.md),
[Nitro: деплой на Vercel](https://nitro.build/raw/deploy/providers/vercel.md),
[обсуждение поддержки WS на Vercel](https://community.vercel.com/t/does-vercel-support-websockets-now-that-we-have-fluid-compute/27205).
