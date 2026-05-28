# vue-sync-engine

Маленький движок «состояния + кэша + синхронизации» для Vue 3, по духу близкий
к TanStack Query, но устроенный иначе:

- **нормализованный** entity‑кэш (как в Apollo / RTK Query), а не хранение
  «сырых» ответов на запросы;
- единый источник истины в одном `Mirror`, на котором сидят все компоненты;
- транспорт между «клиентом» (вкладкой) и «сервером» (QueryGraph) абстрагирован
  — можно поднять движок как `SharedWorker` для синхронизации между вкладками,
  либо запустить inline в той же вкладке;
- опциональная персистентность в IndexedDB на уровне отдельных сущностей и/или
  всего движка;
- авто‑дискавери определений (`*.defs.ts`) через Vite‑плагин;
- Pinia‑подобная панель в Vue DevTools со всеми подписками, сущностями,
  мутациями, кэш‑метаданными и списком подключённых табов.

> Этот репозиторий — одновременно библиотека (`src/engine`) и демо‑приложение
> поверх JSONPlaceholder. Здесь есть всё, чтобы понять, как это работает.

## Содержание

- [Быстрый старт](#быстрый-старт)
- [Архитектура](#архитектура)
- [Определения: entity / query / mutation](#определения-entity--query--mutation)
- [Композиции для Vue](#композиции-для-vue)
- [Два режима работы движка](#два-режима-работы-движка)
- [Кэш и время жизни](#кэш-и-время-жизни)
- [Persistence: storage‑адаптеры](#persistence-storage-адаптеры)
- [Vite‑плагин и авто‑дискавери](#vite-плагин-и-авто-дискавери)
- [Vue DevTools](#vue-devtools)
- [Тестирование](#тестирование)
- [Структура проекта](#структура-проекта)
- [API кратко](#api-кратко)

## Быстрый старт

Установка зависимостей и запуск демо:

```bash
pnpm install
pnpm dev      # vite, дефолтный порт 6006
pnpm test     # vitest, 14 unit‑тестов
pnpm build    # vue-tsc + vite build
```

Демо открывает список пользователей и постов с JSONPlaceholder, кэширует
всё в IndexedDB и поддерживает infinite scroll + optimistic update заголовка
поста.

## Архитектура

```
   ┌───────────────────────────────────────────────────────────────────┐
   │                          Vкладка (UI)                             │
   │                                                                   │
   │   <Component>                                                     │
   │       │  useQuery / useMutation / useInfiniteQuery / useEntity    │
   │       ▼                                                           │
   │   ┌─────────────┐    Subscribe / Mutate            ┌───────────┐  │
   │   │  TabRuntime ├─────────────────────────────────►│ Transport │  │
   │   │  (mirror,   │◄─── QueryPatch / EntityPatch ────┤           │  │
   │   │  subs map)  │      / MutateResult              └─────┬─────┘  │
   │   └─────┬───────┘                                        │        │
   │         ▼                                                │        │
   │   ┌──────────┐  shallowRefs                              │        │
   │   │  Mirror  │  ◄── компоненты подписаны на              │        │
   │   │ entities │      typeVersion / queryState             │        │
   │   │ queries  │                                           │        │
   │   └──────────┘                                           │        │
   └──────────────────────────────────────────────────────────┼────────┘
                                                              │
                                                              ▼
                            ┌─────────────────────────────────────────┐
                            │  SharedWorker  (или тот же тред в Inline) │
                            │                                         │
                            │     QueryGraph                          │
                            │     ┌──────────────┐                    │
                            │     │ QueryNode    │  staleTime/gcTime  │
                            │     │  result,     │  inflight, abort   │
                            │     │  status,     │  entityRefs,       │
                            │     │  updatedAt,  │  subscribers       │
                            │     │  gcTimer     │                    │
                            │     └──────┬───────┘                    │
                            │            │                            │
                            │            ▼                            │
                            │     ┌──────────────────┐                │
                            │     │ StorageAdapter   │                │
                            │     │  queries  (KV)   │ ◄── per‑entity │
                            │     │  mutations(KV)   │     KeyedStore │
                            │     └──────────────────┘                │
                            └─────────────────────────────────────────┘
```

Ключевые сущности:

- **`EntityDef`** — описание нормализуемой сущности. Поставляет функцию `id(entity)`
  и опциональный `storage` (per‑entity).
- **`QueryDef` / `InfiniteQueryDef`** — описание запроса: как формировать ключ
  кэша из аргументов, как фетчить, как нормализовать ответ в сущности,
  плюс `staleTime` / `gcTime` / `tags`.
- **`MutationDef`** — мутация: `fetch`, опциональный `optimistic` (мгновенная
  правка `Mirror`), `onSuccess` (правка после успеха), `invalidate` (инвалидация
  запросов по тегам или дефам), `maxRetries`.
- **`Mirror`** — реактивный «снимок» на стороне вкладки. Хранит сущности по типам
  и текущие состояния запросов (`status / data / error`) через `ShallowRef`. Это
  единый источник истины для UI.
- **`Transport`** — двунаправленный канал сообщений между вкладкой и QueryGraph.
  Реализации: `InlineTransport` (in‑process, через `queueMicrotask`) и
  `SharedWorkerTransport` (через `MessagePort` поверх `SharedWorker`).
- **`QueryGraph`** — «серверная» часть в воркере / том же треде. Дедуплицирует
  fetch‑и, хранит `QueryNode` (с `updatedAt`, `inflight`, `entityRefs`,
  `subscribers`, `gcTimer`), хайдрейтит из стораджа, обрабатывает мутации,
  рассылает патчи всем подписчикам.
- **`StorageAdapter`** — пара KV‑сторов на уровне движка: один для
  `QuerySnapshot` (кэш ответов), второй для `QueuedMutation` (отложенные/висящие
  мутации). Дополнительно у каждого `EntityDef` может быть свой `KeyedStore`
  для самих сущностей.

## Определения: entity / query / mutation

Определения декларативные и заморожены через `Object.freeze`. Кладите их в файлы
с суффиксом `.defs.ts`, чтобы их подобрал [Vite‑плагин](#vite-плагин-и-авто-дискавери).

### Entity

```ts
// post.defs.ts
import { defineEntity, idbStore } from 'vue-sync-engine'

export interface Post { id: number; title: string; body: string; userId: number }

export const PostEntity = defineEntity<Post>({
  name: 'post',
  id: (p) => p.id,
  // Опционально: персистить сущности в IndexedDB.
  // Без storage сущность живёт только в памяти и теряется при перезагрузке.
  storage: idbStore({ dbName: 'my-app' }),
})
```

### Query (одна страница)

```ts
import { defineQuery } from 'vue-sync-engine'

export const usersQuery = defineQuery<void, User[], { ids: number[] }>({
  name: 'users.list',
  key: () => ['users'],
  fetch: (_, ctx) => fetch('/api/users', { signal: ctx.signal }).then((r) => r.json()),
  // Нормализация: что записать в entity‑кэш, что вернуть как result.
  normalize: (items) => ({
    entities: { user: items },
    result: { ids: items.map((u) => u.id) },
  }),
  staleTime: 60_000,   // 1 мин: пока свежий, fetch не дёргается
  gcTime: 300_000,     // 5 мин: держим в кэше после отписки последнего подписчика
  tags: () => ['users'], // для invalidate в мутациях
})
```

### InfiniteQuery (пагинация / бесконечный скролл)

```ts
import { defineInfiniteQuery } from 'vue-sync-engine'

export const postsInfinite = defineInfiniteQuery<
  { userId?: number },
  Post[],
  number,
  { ids: number[]; nextPage: number | null }
>({
  name: 'posts.infinite',
  key: (args) => ['posts', args.userId ?? 'all'],
  initialPageParam: 1,
  getNextPageParam: (last) => last.nextPage,
  fetch: (args, ctx) =>
    fetch(`/api/posts?page=${ctx.pageParam}` + (args.userId ? `&userId=${args.userId}` : ''))
      .then((r) => r.json()),
  normalize: (items, _args, pageParam) => ({
    entities: { post: items },
    result: {
      ids: items.map((p) => p.id),
      nextPage: items.length === 10 ? (pageParam as number) + 1 : null,
    },
  }),
})
```

### Mutation

```ts
import { defineMutation } from 'vue-sync-engine'

export const updatePostTitle = defineMutation<{ id: number; title: string }, Post>({
  name: 'post.updateTitle',
  fetch: (input, ctx) =>
    fetch(`/api/posts/${input.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: input.title }),
      headers: { 'Content-Type': 'application/json' },
      signal: ctx.signal,
    }).then((r) => r.json()),

  // Optimistic: мгновенно меняем сущность в Mirror.
  // На rollback применяется автоматически сгенерированный inverse patch.
  optimistic: (input, ctx) => ctx.patchEntity(PostEntity, input.id, { title: input.title }),

  // Опционально: после успеха сделать дополнительные правки.
  onSuccess: (resp, _input, ctx) => ctx.upsertEntity(PostEntity, resp),

  // Опционально: инвалидировать кэшированные запросы.
  invalidate: () => ['posts'], // строки = теги, либо передать QueryDef
  maxRetries: 0,
})
```

## Композиции для Vue

```vue
<script setup lang="ts">
import {
  Status, useEngine, useQuery, useInfiniteQuery, useMutation, useEntity,
} from 'vue-sync-engine'
import { usersQuery, postsInfinite, updatePostTitle, PostEntity, UserEntity } from './app.defs'

const engine = useEngine()

// Реактивные args: при изменении ref‑а хеш ключа пересчитается и подписка
// автоматически перейдёт на новый QueryNode (со старого release).
const selectedUser = ref<number | undefined>(undefined)

const users = useQuery(usersQuery, () => undefined as void)
// users.data / users.status / users.error / users.isLoading / isSuccess / isError

const posts = useInfiniteQuery(postsInfinite, () => ({ userId: selectedUser.value }))
// posts.pages / posts.pageParams / posts.fetchNextPage()

const m = useMutation(updatePostTitle)
// m.mutate(input) — fire & forget
// await m.mutateAsync(input) — ждать результат
// m.status / m.error / m.data

// Прямое чтение сущности из Mirror (реактивно):
const user = useEntity(UserEntity, () => selectedUser.value)
</script>
```

Под капотом `useQuery` дергает `engine.subscribeQuery(defName, key, args)` и
возвращает `computed`‑ы поверх `ShallowRef<QueryState>`. Подписка освобождается
автоматически при размонтировании компонента (`onScopeDispose`). Между
unmount и реальной отпиской есть GC‑окно (`staleSubGcMs`, по умолчанию 5с) —
чтобы быстрая навигация туда‑сюда не дёргала повторный fetch.

## Два режима работы движка

### Inline (в той же вкладке)

Самый простой режим. `QueryGraph` и `Mirror` живут в основном треде; транспорт
— in‑process через `queueMicrotask` для микро‑батчинга. Подходит когда не нужна
синхронизация между вкладками.

```ts
import { createApp } from 'vue'
import { createEngine, installEngine, indexedDBAdapter } from 'vue-sync-engine'
import App from './App.vue'
import { PostEntity, UserEntity, usersQuery, postsInfinite, updatePostTitle } from './demo.defs'

const engine = createEngine({
  entities: [PostEntity, UserEntity],
  queries: [usersQuery, postsInfinite],
  mutations: [updatePostTitle],
  storage: indexedDBAdapter({ dbName: 'my-app' }),
  defaultStaleTime: 30_000,
  defaultGcTime: 300_000,
})

const app = createApp(App)
installEngine(app, engine, { defaults: { staleTime: 30_000, gcTime: 300_000 } })
app.mount('#app')
```

### SharedWorker (cross‑tab)

`QueryGraph` и storage поднимаются один раз в `SharedWorker`. Все вкладки одного
origin'а подключаются через `MessagePort` и:

- видят одну и ту же копию данных;
- любой fetch делается ровно один раз на все вкладки;
- IndexedDB открыт один раз;
- мутации одной вкладки мгновенно видны во всех остальных.

`src/engine.worker.ts`:

```ts
import { bootstrapWorker, indexedDBAdapter, createSharedWorkerServerEndpoint } from './engine'
import registry from 'virtual:sync-engine-registry'

bootstrapWorker({
  ...registry,
  storage: indexedDBAdapter({ dbName: 'demo-sync-engine' }),
  endpoint: createSharedWorkerServerEndpoint(self as unknown as { onconnect: any }),
})
```

`src/main.ts`:

```ts
import { createTabEngine, createSharedWorkerClientTransport, installEngine } from './engine'

const worker = new SharedWorker(new URL('./engine.worker.ts', import.meta.url), {
  type: 'module',
  name: 'vue-sync-engine',
})

const engine = createTabEngine({
  transport: createSharedWorkerClientTransport(worker),
})

const app = createApp(App)
installEngine(app, engine)
app.mount('#app')
```

В демо `src/main.ts` лежат оба варианта в виде «активный + закомментированный»
— просто переключите блоки.

### Когда что выбирать

| | Inline (`createEngine`) | SharedWorker (`createTabEngine`) |
|---|---|---|
| Кросс‑таб синхронизация | нет | да |
| Дедупликация fetch | внутри одной вкладки | глобально |
| IndexedDB | каждая вкладка открывает свою | один общий instance |
| Bundle | один main‑чанк | дополнительный worker‑чанк |
| Сложность | минимальная | нужен worker‑файл |
| Тесты | удобно (используется в `__tests__`) | требует мок MessagePort |
| Safari / строгий CSP | стабильно | бывают квирки с SharedWorker |

## Кэш и время жизни

Для каждого `QueryDef` есть две настройки времени:

- **`staleTime`** — пока возраст последнего успешного результата меньше этого
  значения, повторная подписка отдаёт кэш без fetch. По умолчанию 30 с.
- **`gcTime`** — сколько держать `QueryNode` в памяти после того, как последний
  подписчик отвалился. По умолчанию 5 минут. По истечении — узел удаляется,
  storage запись по этому ключу тоже.

Дефолты передаются на этапе бутстрапа:

```ts
createEngine({ ..., defaultStaleTime: 30_000, defaultGcTime: 300_000 })
// или
bootstrapWorker({ ..., defaultStaleTime: 30_000, defaultGcTime: 300_000 })
```

Per‑query значения перекрывают дефолты:

```ts
defineQuery({ ..., staleTime: 0, gcTime: Infinity })
```

### Инвалидация

Мутация может явно сбросить кэш других запросов через `invalidate`:

```ts
defineMutation({
  // ...
  // Можно возвращать:
  //   - строковые теги (сопоставляются с QueryDef.tags(args))
  //   - сами QueryDef / InfiniteQueryDef
  invalidate: (input) => ['posts', `user-${input.userId}`],
})
```

Инвалидированный узел переходит в `Pending` и фетчит заново при наличии активных
подписчиков; без подписчиков — просто помечается как протухший.

### Optimistic update + rollback

`optimistic` синхронно меняет `Mirror` до того, как сервер ответил. Движок сам
запоминает инверсные патчи и применяет их при ошибке, поэтому отдельный rollback
писать не нужно.

```ts
optimistic: (input, ctx) => {
  ctx.patchEntity(PostEntity, input.id, { title: input.title }) // partial merge
  // ctx.upsertEntity(PostEntity, newPost)   // полная замена / создание
  // ctx.removeEntity(PostEntity, input.id)  // удаление
},
```

## Persistence: storage‑адаптеры

Два уровня:

### 1. Engine‑level — `StorageAdapter`

Хранит снапшоты запросов (`QuerySnapshot`) и очередь отложенных мутаций
(`QueuedMutation`). Два варианта:

```ts
import { memoryAdapter, indexedDBAdapter } from 'vue-sync-engine'

memoryAdapter()                       // эпhemeral, ничего не выживает
indexedDBAdapter({ dbName: 'my-app' }) // отдельный IDB per origin
```

Этот адаптер передаётся в `createEngine({ storage })` или
`bootstrapWorker({ storage })`. Если не указать — используется `memoryAdapter()`.

### 2. Per‑entity — `KeyedStore`

Каждая сущность может сама решать, персистится ли она:

```ts
import { defineEntity, idbStore, memoryStore, noopStore } from 'vue-sync-engine'

defineEntity({ name: 'post', id: (p) => p.id, storage: idbStore({ dbName: 'my-app' }) })
defineEntity({ name: 'user', id: (u) => u.id }) // без storage — только в памяти
defineEntity({ name: 'session', id: (s) => s.id, storage: noopStore() }) // явный no‑op
```

При наличии `storage`:

- каждый `EntityPatch` пишется в KeyedStore асинхронно;
- при первой подписке на запрос, в `entityRefs` которого фигурируют такие сущности,
  они подтягиваются из стораджа и сразу рассылаются вкладкам через `EntityPatch` —
  поэтому после `pnpm dev` + reload список «всплывает» мгновенно.

В демо это можно увидеть наглядно: `PostEntity` персистится, `UserEntity` — нет
(специально, для контраста в DevTools‑панели «Engine → entity persistence»).

## Vite‑плагин и авто‑дискавери

Плагин в `src/engine/plugin.ts` сканирует переданные glob‑шаблоны и собирает все
найденные `defineEntity / defineQuery / defineInfiniteQuery / defineMutation`
в один виртуальный модуль `virtual:sync-engine-registry`.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import VueDevTools from 'vite-plugin-vue-devtools'
import { syncEnginePlugin } from './src/engine/plugin'

export default defineConfig({
  plugins: [
    VueDevTools(),
    vue(),
    syncEnginePlugin({ definitions: ['/src/**/*.defs.ts'] }),
  ],
  worker: {
    // Тот же плагин для worker bundle — чтобы virtual:sync-engine-registry
    // был доступен и внутри SharedWorker.
    plugins: () => [syncEnginePlugin({ definitions: ['/src/**/*.defs.ts'] })],
  },
})
```

Использование:

```ts
import registry from 'virtual:sync-engine-registry'
// registry.entities / registry.queries / registry.mutations — массивы дефов
```

Дедупликация по `name` сделана на уровне плагина: если случайно экспортнуть один
и тот же deф из двух мест, попадёт только первый.

> В режиме `SharedWorker` импортируйте регистр **только в worker‑файле** — чтобы
> defs не попали в main‑чанк. В режиме `inline` импортируйте в main, или
> перечисляйте defs руками для лучшего tree‑shake'а.

## Vue DevTools

Подключается автоматически в `installEngine`, в проде вырезается через
константу `__SYNC_ENGINE_DEV__` (объявлена в `vite.config.ts`).

В кастомном инспекторе `Sync Engine` пять корневых узлов:

- **Engine** — defaults `staleTime` / `gcTime` (с пометкой `(assumed)`, если
  не передали явно через `installEngine(app, runtime, { defaults })`), счётчики
  регистра, списки персистентных vs in‑memory сущностей, `ownTabId`,
  `connectedTabs`.
- **Queries** — по узлу на каждую активную подписку. Тег статуса
  (idle/pending/success/error) и тег `stale`, когда возраст последнего патча
  превысил `staleTime`. В state — `args`, `data`, `cache` секция с `ageMs`,
  `isStale`, `tags`, эффективными `staleTime / gcTime`, `kind`.
- **Entities** — по типу. Тег `persisted` у сущностей с настроенным storage,
  счётчик инстансов; в state — полный список items.
- **Mutations** — кольцевой буфер последних 50 (in‑flight + завершённых). В
  state — длительность, входы/выход/ошибка, флаги `optimistic / onSuccess /
  invalidates / maxRetries` из дефа.
- **Tabs** — обнаружение других вкладок этого origin'а через отдельный
  `BroadcastChannel('vue-sync-engine-devtools')` (hello + ping каждые 2с,
  reap через 5.5с). Свой таб помечен тегом `self`. Работает независимо от
  режима транспорта.

В Timeline‑слое `Sync Engine` логируются все сообщения транспорта:
`Subscribe / Unsubscribe / Mutate / FetchNextPage` (исходящие) и
`QueryPatch / EntityPatch / MutateResult` (входящие). Все обновления инспектора
батчатся на 50 мс — бурст из десятков `EntityPatch` при гидрации не дёрнет
панель 50 раз.

## Тестирование

```bash
pnpm test         # один прогон
pnpm test:watch   # watch‑режим
```

Тесты используют **inline** режим (`createEngine`) и happy‑dom. Подключать
DevTools и SharedWorker в тестах не требуется — `installEngine` вызывается
только в `main.ts`, а тесты работают с `runtime` напрямую.

```ts
// __tests__/engine.test.ts (упрощённо)
import { createEngine, memoryAdapter } from '../index'
import { PostEntity, usersQuery } from '../../demo.defs'

const engine = createEngine({
  entities: [PostEntity],
  queries: [usersQuery],
  mutations: [],
  storage: memoryAdapter(),
})

const sub = engine.subscribeQuery(usersQuery.name, usersQuery.key(undefined), undefined)
// проверки на engine.mirror.ensureQuery(sub.subId).value
sub.release()
```

## Структура проекта

```
src/
├── engine/                        ← сама библиотека
│   ├── index.ts                   ← публичный API
│   ├── createEngine.ts            ← createEngine / createTabEngine / bootstrapWorker / installEngine
│   ├── define.ts                  ← defineEntity / defineQuery / defineInfiniteQuery / defineMutation
│   ├── devtools.ts                ← Pinia‑подобный плагин для Vue DevTools
│   ├── plugin.ts                  ← Vite‑плагин для virtual:sync-engine-registry
│   │
│   ├── core/                      ← общие типы и утилиты
│   │   ├── types.ts               ← EntityDef / QueryDef / MutationDef / Patch / ...
│   │   ├── flags.ts               ← числовые enum'ы (Op, Status, Msg, Kind)
│   │   ├── patches.ts             ← applyPatch + автогенерация inverse patches
│   │   ├── queryKey.ts            ← стабильный hashKey(...) для query‑ключей
│   │   └── keyedStore.ts          ← интерфейс KeyedStore<T>
│   │
│   ├── composables/               ← Vue‑композиции
│   │   ├── useEngine.ts           ← inject(EngineKey)
│   │   ├── useQuery.ts
│   │   ├── useInfiniteQuery.ts
│   │   ├── useMutation.ts
│   │   └── useEntity.ts
│   │
│   ├── adapters/                  ← storage
│   │   ├── storageAdapter.ts      ← memoryAdapter / indexedDBAdapter
│   │   ├── memoryStore.ts         ← memoryStore / noopStore
│   │   └── idbStore.ts            ← idbStore({ dbName })
│   │
│   ├── transport/                 ← каналы между Tab и QueryGraph
│   │   ├── protocol.ts            ← ClientMsg / ServerMsg / Transport / ServerEndpoint
│   │   ├── InlineTransport.ts     ← in‑process, queueMicrotask
│   │   └── SharedWorkerTransport.ts
│   │
│   ├── tab/                       ← клиентская сторона (вкладка)
│   │   ├── mirror.ts              ← reactive «снимок» entities + queries
│   │   └── runtime.ts             ← TabRuntime: subscribeQuery / mutate / dispose
│   │
│   ├── worker/                    ← серверная сторона (worker или тот же тред)
│   │   └── queryGraph.ts          ← QueryNode'ы, fetch‑дедупликация, hydrate, gcTimer
│   │
│   └── __tests__/                 ← vitest
│
├── App.vue, PostCard.vue          ← UI демо
├── demo.defs.ts                   ← entity/query/mutation для демо
├── engine.worker.ts               ← SharedWorker entrypoint (вариант с воркером)
├── main.ts                        ← bootstrap (в репо лежат оба варианта)
└── env.d.ts                       ← ambient: __SYNC_ENGINE_DEV__ + virtual module
```

## API кратко

### Bootstrap

| | Назначение |
|---|---|
| `createEngine(opts)` | inline‑движок, всё в одном треде. Возвращает `TabRuntime` |
| `createTabEngine({ transport })` | только клиентская часть; нужен внешний транспорт |
| `bootstrapWorker(opts)` | поднять QueryGraph внутри SharedWorker |
| `installEngine(app, runtime, opts?)` | `app.provide(EngineKey, runtime)` + dev‑hook DevTools |
| `setupSyncEngineDevtools(app, runtime, opts?)` | ручная установка DevTools, если не используете `installEngine` |

### Define

| | Возвращает |
|---|---|
| `defineEntity({ name, id, storage? })` | `EntityDef<T>` |
| `defineQuery({ name, key, fetch, normalize?, staleTime?, gcTime?, tags? })` | `QueryDef` |
| `defineInfiniteQuery({ name, key, initialPageParam, getNextPageParam, fetch, normalize?, ... })` | `InfiniteQueryDef` |
| `defineMutation({ name, fetch, optimistic?, onSuccess?, invalidate?, maxRetries? })` | `MutationDef` |

### Composables

| | Возвращает |
|---|---|
| `useEngine()` | `TabRuntime` (inject) |
| `useQuery(def, args)` | `{ data, status, error, isLoading, isSuccess, isError }` |
| `useInfiniteQuery(def, args)` | `{ pages, pageParams, status, error, isLoading, fetchNextPage }` |
| `useMutation(def)` | `{ mutate, mutateAsync, status, error, data }` |
| `useEntity(def, id)` | `ComputedRef<T \| undefined>` |

### Storage

| | |
|---|---|
| `memoryAdapter()` | engine‑level KV в памяти |
| `indexedDBAdapter({ dbName })` | engine‑level KV в IndexedDB |
| `memoryStore()` | factory для per‑entity in‑memory |
| `idbStore({ dbName })` | factory для per‑entity IndexedDB |
| `noopStore()` | factory, который игнорирует записи (для отладки) |

### Transport

| | |
|---|---|
| `createInlineTransport()` | `{ client: Transport, server: ServerEndpoint }`. Используется внутри `createEngine` |
| `createSharedWorkerClientTransport(worker)` | клиентский транспорт для вкладки |
| `createSharedWorkerServerEndpoint(scope)` | серверный endpoint внутри SharedWorker |

### Vite

```ts
syncEnginePlugin({ definitions: '/src/**/*.defs.ts' })
```

---

Лицензия — на усмотрение автора (в репозитории не указана).
