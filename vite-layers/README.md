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
import { feature } from '#feature' // алиас регистрирует vite-layers; типы — из .vite-layers/features.d.ts

const routes = [
  { path: '/', component: () => import('@/pages/Home') },
  ...(feature('billing') ? [{ path: '/billing', component: () => import('@/pages/Billing') }] : []),
]
```

`feature('key')` — **компайл-тайм макрос**: плагин заменяет вызов на литерал значения флага,
**одинаково в dev и в build** (один AST-transform, без расхождений). Подставленный `false` делает ветку
статически мёртвой, и Rollup/rolldown вырезает её вместе с `import()` — чанк выключенной фичи не эмитится.
Тип `feature` генерируется из `merged.features` **литеральными типами**, поэтому опечатка ключа
(`feature('biling')`) — ошибка компиляции.

Правила (они **enforced**: нарушение валит сборку — и в dev, и в build, ничего не «протекает» молча):

- ключ — строковый литерал: `feature('billing')`, не `feature(name)`;
- вызывайте напрямую — без алиасов (`const f = feature`), деструктуризации и передачи как значения;
- вложенные флаги — дотированным ключом: `feature('payments.stripe')`;
- ключ должен существовать в `merged.features` (иначе — ошибка сборки).

Тестам ничего дублировать не нужно — тот же transform работает в Vitest (плагин — часть конфига).
В `.vue`-шаблоне напрямую `feature('x')` использовать нельзя (компилятор делает из него `_ctx.feature` —
это не вызов макроса): читайте флаг в `<script setup>`/JSX и используйте в шаблоне локальную переменную.
При изменении любого `app.config.*` dev-сервер **автоматически перезапускается** (`app.config` грузится
c12, вне графа Vite — сам он не следит), подхватывая новые значения флагов.

## Префиксы импортов

| Префикс | Куда резолвится | Примечания |
|---|---|---|
| `@/…`, `~/…` | первый совпавший файл по `srcDir` слоёв, high→low | слоёвый резолвер; **self-skip** даёт `super()` |
| `~~/…`, `@@/…` | `rootDir` проекта | обычный alias |
| `#layers/<name>/…` | `rootDir` соответствующего слоя | обычный alias, first-wins по имени |
| `#feature` | entry макроса `feature('key')` | алиас регистрируется автоматически; вызовы сворачиваются в литералы |

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

**Объявляйте все ключи фич в базовом `features`** (как `analytics` выше), а `$env`-блоки используйте
только чтобы менять их **значения**. Ключ, существующий лишь в `$production`, будет «неизвестен» в dev
(`feature('x')` → ошибка сборки) и не попадёт в типы. Литеральные типы в `features.d.ts` отражают тот
`mode`, в котором их сгенерировали (dev/build/`prepare`) — поэтому флаг с разными значениями по mode
типизируется значением текущего mode; держите ключи в базе для предсказуемости.

## Опции

`buildViteConfig(appDir, options?)`:
- `tsconfig: false` — выключить автоген tsconfig; `tsconfig: {...}` — `GenerateTsConfigOptions`.
- `resolver: { prefixes?, extensions? }` — сменить слоёвые префиксы / расширения резолвера (напр. добавить `.svelte`).
- `hooks: {...}` — программные lifecycle-хуки (см. ниже), регистрируются после слоёвых.
- `devtools: false` — не монтировать панели в Vite DevTools (см. ниже). По умолчанию включено.
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

## DevTools

vite-layers умеет показывать свой резолвнутый стек прямо в [Vite DevTools](https://devtools.vite.dev)
(`@vitejs/devtools`). Добавьте хаб в dev — `buildViteConfig` сам подмонтирует панели; без хаба плагин
**инертен** (используются только *типы* из `@vitejs/devtools-kit`, никакой рантайм-зависимости):

```ts
// apps/main/app.config.ts
import { DevTools } from '@vitejs/devtools' // peer-зависимость только для dev
export default defineLayerConfig({
  vite: ({ command }) => ({
    plugins: [vue(), command === 'serve' && DevTools()], // хаб только в dev
  }),
})
```

Четыре панели (свёрнуты под одной кнопкой `vite-layers`):

| Панель | Что показывает |
|---|---|
| **Layers** | **дерево наследования** (`extends`-граф box-drawing, с ромбами и авто-сканом), резолвнутый стек high→low, мёрж-конфиг (Tree), накопленные хуки |
| **Features** | мёрж-флаги с литеральными значениями и статусом DCE (`kept` / `branch eliminated`); бейдж = число выключенных |
| **Resolver** | плейграунд `@/…` (показывает кандидатов по слоям + победителя) и **живой лог** реальных слоёвых резолвов сессии (включая `super()`-self-skip) |
| **Public & TS** | слоёвые `public/`-ассеты (кто кого затеняет) и сгенерированные `tsconfig.json` / `tsconfig.node.json` / `features.d.ts` |

UI рисуется целиком на сервере (json-render спеки `@vitejs/devtools-kit`) — **клиентский бандл не
нужен**, vite-layers остаётся buildless. Панели читают тот же стек и тот же резолвер-кэш, что и сборка
(`createLayeredResolution` шарится между резолвер-плагином и панелью), поэтому показанное — ровно то,
что действует. При первом заходе DevTools попросит авторизовать браузер (разовый prompt в терминале).

Плагин можно подключить и вручную — `layersDevtoolsPlugin` экспортируется из `vite-layers/devtools`.

## Улучшения над Nuxt/c12

1. **`super()` через self-skip** — оверрайд может импортировать собственный путь (`@/components/X`),
   чтобы дотянуться до базового файла. В Nuxt такого механизма нет.
2. **Cycle-guard** — голый c12 уходит в stack overflow на обратном ребре (`A→B→A`); дедуп Nuxt
   срабатывает только ПОСЛЕ рекурсивного обхода c12 и не спасает. Терминальный пустой слой в
   `resolve`-хуке c12 обрывает рекурсию.
3. **Побрендовый DCE через `feature()`-макрос** — гейтированные `import()` выпиливаются из бандлов
   выключенных брендов: AST-transform заменяет `feature('key')` на литерал (**один механизм для dev и
   build**), а любое не-сворачиваемое использование (алиас, динамический/неизвестный ключ) валит
   сборку с понятной ошибкой — вместо молчаливой деградации DCE, как при `define`-подходе Nuxt.

## TypeScript (автогенерация tsconfig)

Framework-agnostic порт Nuxt `prepare:types`. `buildViteConfig` пишет на каждом dev/build
`<appDir>/.vite-layers/{tsconfig.json, tsconfig.node.json, features.d.ts}` (`features.d.ts` аугментирует
модуль `#feature` литеральными типами `feature()`, а сгенерированный `paths['#feature']` резолвит сам
макрос); `tsconfig.json` приложения его расширяет:

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
- `createLayeredResolution({ roots, prefixes?, extensions?, record? })` — чистое ядро резолвера
  (`parse`/`candidates`/`resolveId`/`records`); шарится между резолвер-плагином и DevTools-панелью.
- `generateTsConfig(appDir, opts?)` / `writeTsConfig(appDir, opts?)` / `tsconfigPlugin(appDir, opts?)` — генерация tsconfig.
- `defineLayerConfig(config)` — типизированный хелпер для `app.config.ts`.
- `feature(key)` (импорт из `#feature` / `vite-layers/feature`) — компайл-тайм макрос флагов; `featurePlugin(features)` — сам плагин (можно отдельно).
- `layersDevtoolsPlugin(data)` (импорт из `vite-layers/devtools`) — панели для Vite DevTools (автоматически подключаются `buildViteConfig`).

## Пример (Vue + Tailwind)

`example/apps/{main,brand,aurora}` — запускаемое мультибрендовое демо. Общий «каркас» (шапка, подвал,
страница профиля, страница биллинга, роутер, входной Tailwind-CSS) живёт только в базовом слое `main`;
каждый бренд меняет ровно **три** вещи — логотип, файл темы Tailwind и лендинг:

| Приложение | Слой | Тема | DCE-страница `billing` | Beta-плашка |
|---|---|---|---|---|
| `main` (Acme) | база | светлая, индиго | ✅ есть | ✅ (в dev) |
| `brand` (Northwind) | `extends ../main` | светлая, изумруд | ❌ вырезана | ✅ (унаследована) |
| `aurora` (Aurora) | `extends ../main` | **тёмная**, роза/небо | ✅ есть | ❌ выключена |

```bash
pnpm example:dev      # дев-сервер Acme (бренды: npx vite example/apps/{brand,aurora})
pnpm example:build    # билд всех трёх — сравните эмитнутые чанки
pnpm example:check    # prepare + vue-tsc для всех трёх (код приложения + node-конфиги)
```

**Как меняется тема.** Общий `@/style.css` (только в базе) подключает Tailwind и мапит токены на
runtime-переменные через `@theme inline` (`--color-brand: var(--c-brand)` и т.д.). Каждый бренд кладёт
свой `@/assets/theme.css` с `:root { --c-* }`; слоёвый резолвер выбирает версию верхнего слоя — и весь
общий UI перекрашивается, без правки единого компонента. `@tailwindcss/vite` резолвит CSS-`@import`
своим резолвером (мимо слоёв), поэтому тему подключаем **JS-импортом** `import '@/assets/theme.css'`,
который идёт через слоёвый резолвер.

Что демонстрирует демо:

- **Общий каркас:** `AppHeader`, `AppFooter`, `Profile`, `Billing`, роутер есть только в `main`, но
  рендерятся во всех брендах через `@/…`. У `brand` больше нет своего `AppHeader` — шапка общая.
- **Перекраска темой:** один и тот же `Profile`/`Billing` рендерится светлым у Acme/Northwind и тёмным
  у Aurora — разница только в `theme.css` (10 токенов цвета/радиуса/шрифта).
- **Перекрытие ассета:** `*/public/logo.svg` затеняется послойно; `favicon.svg` наследуется из базы.
- **DCE:** у `brand` `features.billing: false` → `feature('billing')` сворачивается в `false` →
  `import('@/pages/Billing.vue')` мёртв → чанк `Billing-*.js` не эмитится (и ссылки в навигации нет):

```bash
ls example/apps/main/dist/main/assets     | grep -i billing   # Billing-*.js есть
ls example/apps/brand/dist/brand/assets   | grep -i billing   # пусто → DCE
ls example/apps/aurora/dist/aurora/assets | grep -i billing   # Billing-*.js есть
```

- **Разные наборы фич:** `brand` убирает биллинг, но оставляет beta-плашку; `aurora` — наоборот.
  `$production` гасит beta-плашку в проде у всех (env-оверрайд слоя).
- **tsconfig:** `app.config.ts` правит tsconfig (`jsxImportSource: 'vue'`, `types: ['vite/client']`),
  `vue-tsc` зелёный для всех трёх:

```bash
vite-layers prepare example/apps/aurora
npx vue-tsc --noEmit -p example/apps/aurora
```

## Тесты

```bash
pnpm test          # порядок, diamond-дедуп, cycle-guard, авто-скан, self-skip резолвера, feature()-макрос, tsconfig
pnpm type-check
```

## Сборка

Разработка **buildless** — example-приложения и тесты импортируют `src/*` напрямую, а `exports`
пакета указывают на `./src/*.ts`. Для публикации `pnpm build` (tsdown) собирает ESM + `.d.ts` в
`dist/` по одному выходу на каждый сабпас (`.`, `./feature`, `./devtools`); зависимости и peer'ы
(`vite`, `@vitejs/devtools-kit`) внешние. `publishConfig.exports` переключает пакет на `dist/` —
`prepack` пересобирает автоматически, в tarball едут только `dist/` + `bin/` (проверено `publint`).

```bash
pnpm build         # tsdown → dist/{index,feature,devtools}.{js,d.ts}
pnpm pack          # prepack-сборка + публикуемый tarball (dist + bin)
```

CLI `vite-layers prepare` и алиас `#feature` работают в обоих режимах: из исходников (`feature.ts`,
jiti) и из собранного `dist/` (`feature.js`).
