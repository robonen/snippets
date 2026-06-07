# vite-layers

Framework-agnostic **слои в стиле Nuxt**, портированные на чистый Vite: файловые оверрайды через
`extends` + мёрж конфигов, плюс побрендовый build-time dead-code elimination. Работает с любым
фреймворком — у ядра **нет фреймворк-зависимостей**; `vue()`/`react()`/и т.п. подключаются на уровне слоя.

Логика стека слоёв (порядок, дедуп, авто-скан, алиасы) портирована напрямую из исходников Nuxt
(`@nuxt/kit` `loadNuxtConfig` + `@nuxt/schema`), с тремя осознанными улучшениями.

## Установка

```bash
pnpm add -D vite-layers   # peer-зависимость: vite ^8
```

## Использование

Каждое приложение/бренд — это директория с `app.config.ts` и однострочным `vite.config.ts`:

```ts
// apps/main/app.config.ts
import { defineLayerConfig } from 'vite-layers'
export default defineLayerConfig({
  name: 'main',
  features: { billing: true },
  vite: { plugins: [vue()] },           // фреймворк-плагин живёт здесь, а не в ядре
})

// apps/brand/app.config.ts — только диффы
import { defineLayerConfig } from 'vite-layers'
export default defineLayerConfig({
  name: 'brand',
  extends: ['../main'],
  features: { billing: false },         // бренд полностью убирает страницу billing
})

// apps/<любой>/vite.config.ts
import { buildViteConfig } from 'vite-layers'
export default buildViteConfig(import.meta.dirname)
```

Чтобы перекрыть файл, положите его по тому же относительному пути в слое с более высоким приоритетом
(`apps/brand/src/components/Header.vue` затеняет `apps/main/src/components/Header.vue`).

Гейтите опциональные страницы так, чтобы выключенные **исчезали из бандла** (а не просто переставали роутиться):

```ts
// __FEATURES__ типизируется сгенерированным .vite-layers/features.d.ts — declare не нужен
const routes = [
  { path: '/', component: () => import('@/pages/Home') },
  ...(__FEATURES__.billing ? [{ path: '/billing', component: () => import('@/pages/Billing') }] : []),
]
```

Тип `__FEATURES__` генерируется из `merged.features` в `.vite-layers/features.d.ts`, поэтому опечатка
(`__FEATURES__.biling`) — ошибка компиляции, а не молчком-falsy.

Флаги вшиваются через `define` и сворачиваются esbuild ещё **до** построения графа Rollup, поэтому
выключенная ветка и её `import()` физически не попадают в бандл. Дотированные литералы эмитятся на
любую глубину (`__FEATURES__.nested.enabled` тоже сворачивается). Правила, чтобы DCE сработало:

- обращайтесь **напрямую** — `__FEATURES__.billing`; алиас/деструктуризация (`const f = __FEATURES__; f.billing`)
  и динамический доступ (`__FEATURES__[name]`) не сворачиваются;
- гейт оборачивает сам `import()` (тернарник/`&&`/спред), а не `.filter` после — reachable-импорт не вырезается;
- ключи фич — валидные JS-идентификаторы (kebab/пробел доступны в рантайме через объект `__FEATURES__`,
  но без DCE);
- в тестах продублируйте `define` (в `vitest.config`) или гардите `globalThis.__FEATURES__ ?? {}`.

**Dev-режим.** В build флаги работают через `define` (+ DCE). В dev Vite 8 / rolldown-vite **не**
инлайнит пользовательский `define` в исходники, поэтому `vite-layers` сам подставляет `__FEATURES__`
в рантайме (dev-only плагин). Плюс при изменении любого `app.config.*` слоя dev-сервер
**автоматически перезапускается** (`app.config` грузится c12, вне графа Vite — сам он не следит) —
так фичи обновляются без ручного рестарта. В шаблонах `.vue` `__FEATURES__` напрямую использовать
нельзя — компилятор префиксует его в `_ctx.__FEATURES__` (define/рантайм-подстановка не матчат);
читайте флаг в `<script setup>` и используйте в шаблоне локальную переменную.

## Префиксы импортов

| Префикс | Куда резолвится | Примечания |
|---|---|---|
| `@/…`, `~/…` | первый совпавший файл по `srcDir` слоёв, high→low | слоёвый резолвер; **self-skip** даёт `super()` |
| `~~/…`, `@@/…` | `rootDir` проекта | обычный alias |
| `#layers/<name>/…` | `rootDir` соответствующего слоя | обычный alias, first-wins по имени |

## Модель приоритета (из Nuxt)

`layers[0]` — это сам проект (высший приоритет); далее `extends` слева-направо, в глубину;
авто-сканированные `layers/*` сортируются по убыванию (`Z` > `A`, выше числовой префикс — выше приоритет).
Коллизии решаются как **меньший индекс слоя выигрывает**. Конфиги мёржатся через `defu` (проект
выигрывает; массивы конкатятся).

## Слоёвые `public/`-ассеты (брендинг)

У каждого слоя может быть своя `public/` — резолвится **first-match по слоям**, как `@/`:
`brand/public/logo.svg` затеняет `main/public/logo.svg`, а `favicon.svg` из базы наследуется.
Удобно для лого/favicon/шрифтов per-brand. Работает и в dev (отдаётся через sirv по приоритету),
и в build (эмитится в `outDir`, верхний слой перетирает нижний). `publicDir` Vite при этом
отключается автоматически (он одиночный) — плагин берёт обслуживание на себя.

```
apps/main/public/{logo.svg, favicon.svg}   # база
apps/brand/public/logo.svg                  # бренд перекрывает только лого
→ dist/brand/{logo.svg = brand, favicon.svg = main}
```

## Env-оверрайды слоёв

Слой в `app.config.ts` может переопределять себя по Vite `mode` (через c12 `$<env>`/`$env`):

```ts
export default defineLayerConfig({
  features: { analytics: false },
  $production: { features: { analytics: true } }, // применится при mode=production
})
```

## Опции

`buildViteConfig(appDir, options?)`:
- `tsconfig: false` — выключить автоген tsconfig; `tsconfig: {...}` — `GenerateTsConfigOptions`.
- `resolver: { prefixes?, extensions? }` — сменить слоёвые префиксы / расширения резолвера (напр. добавить `.svelte`).
- `hooks: {...}` — программные lifecycle-хуки (см. ниже), регистрируются после слоёвых.
- `outDir`, `vite` — выходная папка и финальный Vite-фрагмент (высший приоритет).

## Хуки жизненного цикла

Как в Nuxt (на `unjs/hookable`): типизированные, **серийные в порядке слоёв (база первой)**,
**mutation-style** (хендлер мутирует общий аргумент). Хуки каждого слоя из `app.config.ts`
**накапливаются** (одноимённые из разных слоёв все выполняются), не перетираются.

```ts
export default defineLayerConfig({
  hooks: {
    'layers:resolved': (stack) => { stack.merged.features ??= {}; /* править merged/features/layers */ },
    'vite:config':     (ctx) => { ctx.config.plugins?.push(myPlugin()) }, // финальный Vite-конфиг
    'tsconfig:generate': (ctx) => { ctx.tsconfig.compilerOptions!.strict = true }, // перед записью
  },
})
```

| Хук | Аргумент | Когда |
|---|---|---|
| `layers:resolved` | `LayerStack` | после резолва стека (до чтения features/алиасов) |
| `vite:config` | `{ config, env, stack }` | финальный Vite-конфиг перед возвратом |
| `tsconfig:generate` | `{ appDir, tsconfig, stack }` | сгенерированный tsconfig перед записью |

Программно: `buildViteConfig(dir, { hooks: { … } })`. Низкоуровнево экспортируются
`createLayerHooks`/`registerLayerHooks`/`hooksFromStack` и типы `LayerHooks`/`LayerHookable`.

## Улучшения над Nuxt/c12

1. **`super()` через self-skip** — оверрайд может импортировать собственный путь (`@/components/X`),
   чтобы дотянуться до базового файла. В Nuxt такого механизма нет.
2. **Cycle-guard** — голый c12 уходит в stack overflow на обратном ребре (`A→B→A`); дедуп Nuxt
   срабатывает только ПОСЛЕ рекурсивного обхода c12 и не спасает. Терминальный пустой слой в
   `resolve`-хуке c12 обрывает рекурсию.
3. **Побрендовый DCE** — гейтированные динамические `import()` выпиливаются из бандлов выключенных
   брендов через дотированные `__FEATURES__.<key>` defines (esbuild сворачивает литерал ещё до того,
   как Rollup построит граф модулей).

## TypeScript (автогенерация tsconfig)

Framework-agnostic порт Nuxt `prepare:types`. `buildViteConfig` пишет на каждом dev/build
`<appDir>/.vite-layers/{tsconfig.json, tsconfig.node.json, features.d.ts}` (`features.d.ts` типизирует
`__FEATURES__`); `tsconfig.json` приложения его расширяет:

```jsonc
// apps/brand/tsconfig.json
{ "extends": "./.vite-layers/tsconfig.json" }
// сюда добавляются фреймворк-опции (для Vue: "jsx": "preserve", "jsxImportSource": "vue")
```

Сгенерированный `paths['@/*']`/`['~/*']` — это массив **`srcDir` всех слоёв в порядке приоритета**,
поэтому `tsc`/`vue-tsc` резолвит слоёвые импорты по first-existing-file — точно как рантайм-резолвер.
`~~`/`@@` → корень проекта; `#layers/<name>` → каждый слой.

**Два tsconfig — как в Nuxt (app + node).** `tsconfig.json` — для кода приложения (слои, DOM, `paths`);
`tsconfig.node.json` — для конфиг-файлов (`vite.config.*`/`app.config.*` всех слоёв) с node-типами,
без DOM и без слоёвых `paths`. Проверять оба:

```bash
vue-tsc --noEmit -p apps/brand                                  # код приложения
vue-tsc --noEmit -p apps/brand/.vite-layers/tsconfig.node.json  # конфиг-файлы (node)
```

**Настройка на уровне слоя** через поле `tsConfig` в `app.config.ts` (это pkg-types
[`TSConfig`](https://github.com/unjs/pkg-types)), мёржится по стеку как Nuxt `typescript.tsConfig` —
сгенерированные `paths` всегда побеждают:

```ts
// apps/main/app.config.ts
export default defineLayerConfig({
  name: 'main',
  tsConfig: { compilerOptions: { jsxImportSource: 'vue', strict: true } }, // наследуется брендами
})
```

Ручная генерация для CI:

```bash
vite-layers prepare apps/brand    # пишет apps/brand/.vite-layers/tsconfig.json
vue-tsc --noEmit -p apps/brand    # или tsc --noEmit
```

Отключить авто-запись: `buildViteConfig(dir, { tsconfig: false })`. Добавьте `.vite-layers/` в `.gitignore`.

## API

- `buildViteConfig(appDir, options?)` — дефолтный экспорт для `vite.config.ts` (резолвер + автоген
  tsconfig; `options.tsconfig: false` — отключить, `options.tsconfig: {...}` — настроить).
- `resolveLayerStack(cwd)` → `{ merged, layers }` — резолвнутый упорядоченный стек.
- `layersResolver({ roots, prefixes?, extensions? })` — Vite-плагин резолвера (можно отдельно).
- `generateTsConfig(appDir, opts?)` / `writeTsConfig(appDir, opts?)` / `tsconfigPlugin(appDir, opts?)` — генерация tsconfig.
- `defineLayerConfig(config)` — типизированный хелпер для `app.config.ts`.

## Пример (Vue)

`example/apps/{main,brand}` — запускаемое Vue-демо. `main` — база (`vue()` + страница `billing`),
`brand` расширяет её, перекрывает `AppHeader.vue` и выключает `billing`. Соберите оба и сравните:

```bash
npx vite build example/apps/main    # эмитит чанки Home + Billing
npx vite build example/apps/brand   # только Home (чанка Billing НЕТ → DCE); AppHeader перекрыт
```

Что демонстрирует демо:

- **Оверрайд:** `brand/src/components/AppHeader.vue` затеняет версию из `main` (`@/components/AppHeader.vue`).
- **DCE:** `features.billing: false` → динамический `import('@/pages/Billing.vue')` мёртв → чанк не эмитится.
- **Алиасы/резолвер:** `main.ts` тянет страницы и компонент через `@/…` сквозь слои.
- **tsconfig:** `app.config.ts` правит tsconfig (`jsxImportSource: 'vue'`), `vue-tsc` зелёный:

```bash
vite-layers prepare example/apps/brand
npx vue-tsc --noEmit -p example/apps/brand
```

## Тесты

```bash
pnpm test          # порядок, diamond-дедуп, cycle-guard, авто-скан, self-skip резолвера, defines, tsconfig
pnpm type-check
```
