# Как написать модуль brain

Практическая шпаргалка: что модуль обязан отдать оболочке и каким API
пользуется внутри. Архитектурные «почему» — в [00-plan.md](00-plan.md).

---

## 1. Скелет

Модуль — одновременно **слой** `vite-layers` и **пакет** workspace. Слой даёт
перекрытие файлов и `feature()`-гейт, пакет — резолв зависимостей и гейты.

```
modules/<id>/
  app.config.ts         defineLayerConfig({ name: '<id>' })
  package.json          @brain/<id>, exports → ./src/<id>/module.ts
  tsconfig.json         extends ../../tsconfig.base.json
  src/<id>/             ← ОБЯЗАТЕЛЬНО под своим именем
    module.ts           defineModule(...) — единственный экспорт наружу
    db/models.ts        схема ленда + снимки документ → доменный тип
    db/composables.ts   хуки поверх @sync/vue
    entities/*.ts       доменные типы и чистые расчёты
    screens/**/*.vue    экраны
    lib/*.ts            доменные хелперы модуля
```

**Почему `src/<id>/`, а не просто `src/`.** Слои резолвят `@/…` по всему стеку,
и путь-победитель один. Если у пяти модулей есть `src/db/models.ts`, то
`@/db/models` — это лотерея с первым слоем. Своё имя разводит пространства и
делает осмысленным обратное: чтобы перекрыть экран заметок, оболочка кладёт
файл в `apps/web/src/notes/screens/…`, а базовый берёт через `#super`.

Слои внутри модуля — DAG: `screens → db → entities → lib`. Своего `shared`
нет: то, что просится в общее, уезжает в `packages/std` или `packages/ui`.
Импорты внутри модуля **относительные** (`../entities/note`).

## 2. Декларация

```ts
import { defineModule } from '@brain/module-kit';
import { IconNotes } from '@brain/ui';
import NotesScreen from './screens/list/NotesScreen.vue';

export const notesModule = defineModule({
  id: 'notes',                       // латиница, ≤16 симв.; из имени чеканится адрес ленда
  title: 'Заметки',
  icon: IconNotes,
  land: { root: 'notes/root', seed },       // seed — идемпотентный по содержимому
  routes: [                                  // пути ОТНОСИТЕЛЬНЫЕ: висят под /notes
    { path: '', name: 'notes:list', component: NotesScreen },
    { path: ':id', name: 'notes:note', component: () => import('./screens/note/NoteScreen.vue') },
  ],
  widgets: [{ id: 'today', title: 'Заметка дня', component: DailyWidget, order: 10 }],
  commands: [{ id: 'new', title: 'Новая заметка', run: ctx => { /* ctx.space */ } }],
  search: (ctx, query) => [/* SearchHit */],
});
```

Оболочка сама вешает маршруты под `/<id>` и оборачивает их хостом, который
отдаёт вниз пространство модуля. Поэтому экраны зовут `useDoc()` как в
одноленовом приложении и про мультиленд не знают.

## 3. Модели

Имена **обязательно** с префиксом модуля: реестр `Models` один на приложение.

```ts
import { atom, model, part, parts, t } from '@sync/core';
import { scoped } from '@brain/module-kit';

const scope = scoped('notes');

export const NoteModel = model(scope('note'), {
  title: atom(t.string),
  tags: atom(t.string),                    // «a,b,c» — простой случай
  pinned: atom(t.bool),
  createdAt: atom(t.number),
  updatedAt: atom(t.number),
});

export const NotesModel = model(scope('root'), {
  notes: parts(t.string, 'notes/note'),    // каталог по id
  settings: part('notes/settings'),        // единственный документ
});

declare module '@sync/core' {
  interface Models {
    'notes/note': typeof NoteModel;
    'notes/root': typeof NotesModel;
  }
}
```

Типы значений: `t.string`, `t.number`, `t.int`, `t.bool`, `t.maybe(t.number)`,
`t.enum([...] as const).or('дефолт')`.

Опциональность домена (`undefined`) отображается в `null` модели и обратно —
у каналов один сентинел. Снимок пишется руками:

```ts
export function readNote(id: string, doc: Doc<'notes/note'>): Note {
  const note: Note = { id, title: doc.title(), createdAt: doc.createdAt() };
  const due = doc.dueAt();
  if (due !== null) note.dueAt = due;
  return note;
}
```

## 4. Каналы

| Вид | Чтение | Запись |
|---|---|---|
| `atom` | `doc.title()` | `doc.title('новое')` |
| `parts` | `root.notes(id)`, `.keys()`, `.size()`, `.has(id)` | `.delete(id)`, `.clear()` |
| `part` | `root.settings()` | — (пишутся поля внутри) |
| `list` | `doc.tags()`, `.at(i)`, `.size()` | `.push()`, `.remove()`, `.move()`, `.set([...])` |
| `dict` | `doc.meta(key)`, `.keys()` | `doc.meta(key, value)`, `.delete(key)` |
| `text` | абзацы и токены | — для тела заметки |

Документ существует, как только к нему обратились: `root.notes(id)` создаёт
его при первой записи. Проверка «был ли» — `doc.$.exists()`.

## 5. Хуки

```ts
import { useDoc, useSpace, useSync, useValue } from '@sync/vue';

export function useNotes(): ComputedRef<Note[]> {
  const root = useDoc(NotesModel);
  const snapshot = useValue(() => root.notes.keys().map(id => readNote(id, root.notes(id))));
  return computed(() => [...(snapshot.value ?? [])].sort((a, b) => b.updatedAt - a.updatedAt));
}
```

Снимок целой коллекции, а не подписка на строку: личных данных — сотни
записей, и один файбер на коллекцию дешевле файбера на строку. Важнее другое:
фильтры по дате живут на Vue-рефах, а файберный наблюдатель Vue-рефов не видит.

`useValue` отдаёт `undefined`, пока ленд едет из хранилища. Это НЕ «пусто» —
это «ещё не знаем»; `useSync` разделяет их явно (`data`/`pending`/`error`).

Запись — прямой вызов канала в транзакции:

```ts
const space = useSpace();
space.edit(() => {
  writeNote(root.notes(note.id), note);
});
```

Мутаций как понятия нет: запись сразу локальная и настоящая, откатывать нечего.

## 6. Экраны

SFC `<script setup lang="ts">`, компоненты из `@brain/ui`:
`Button`, `Card`, `Sheet`, `TextField`, `SwitchField`, `Meter`,
`EmptyState`, `PageHeader`, `Spinner`, иконки `Icon*`.

Оформление — только токены кита: `bg-surface`, `text-text-soft`,
`border-line`, `text-accent`, `rounded-card`. Ни одного захардкоженного цвета:
тема меняет значения переменных, и `#1c1b1a` в компоненте сломает светлую.
Доменные цвета модуля — своим `<id>.css` с `@theme`, в двух вариантах
(светлая и тёмная), как в `modules/kcal/src/kcal.css`.

## 7. Гейты

Модуль не считается готовым, пока не проходят все четыре:

```bash
pnpm --filter @brain/<id> typecheck
pnpm exec eslint modules/<id>
pnpm vitest run modules/<id>
pnpm build
```

Тесты обязательны для расчётов и снимков (`read*`/`write*` — цикл
«записали → прочитали → то же самое»). Экраны тестами не покрываются, но
логика из них выносится так, чтобы её можно было проверить без DOM.
