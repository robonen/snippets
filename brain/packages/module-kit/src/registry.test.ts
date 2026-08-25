import { expect, test } from 'vitest';
import { defineComponent } from 'vue';
import { createRegistry } from './registry';
import { defineModule } from './module';
import type { BrainModule } from './module';

const Screen = defineComponent({ name: 'screen', setup: () => () => null });

function stub(id: string, extra: Partial<BrainModule> = {}): BrainModule {
  return defineModule({
    id,
    title: id,
    land: { root: 'brain-test-root' as never },
    routes: [{ path: '', name: `${id}:index`, component: Screen }],
    ...extra,
  });
}

test('Module routes hang under /<id> and are wrapped in their own host', () => {
  const registry = createRegistry([stub('kcal'), stub('notes')]);
  const routes = registry.routes();

  expect(routes.map(route => route.path)).toEqual(['/kcal', '/notes']);
  expect(routes[0]!.meta).toEqual({ module: 'kcal', title: 'kcal' });
  expect(routes[0]!.children).toHaveLength(1);

  // Хост — свой компонент на модуль, иначе Vue переиспользует инстанс при
  // переходе между модулями и оставит вниз чужое пространство.
  expect(routes[0]!.component).not.toBe(routes[1]!.component);
});

test('Duplicate module names are rejected', () => {
  expect(() => createRegistry([stub('notes'), stub('notes')])).toThrow(/declared twice/);
});

test('Different names with the same land address are rejected', () => {
  // Схема чеканки повторяет имя по кругу: «ab» и «abab» дают один ленд.
  expect(() => createRegistry([stub('ab'), stub('abab')])).toThrow(/same land address/);
});

test('Malformed name is rejected: paths and the address are built from it', () => {
  expect(() => createRegistry([stub('Notes')])).toThrow(/not valid/);
  expect(() => createRegistry([stub('my notes')])).toThrow(/not valid/);
  expect(() => createRegistry([stub('заметки')])).toThrow(/not valid/);
  expect(() => createRegistry([stub('a-very-long-module-id')])).toThrow(/not valid/);
});

test('Widgets are collected from all modules and sorted by order', () => {
  const registry = createRegistry([
    stub('kcal', { widgets: [{ id: 'today', title: 'Ккал', component: Screen, order: 20 }] }),
    stub('notes', {
      widgets: [
        { id: 'daily', title: 'Заметка дня', component: Screen, order: 10 },
        { id: 'recent', title: 'Недавние', component: Screen },
      ],
    }),
  ]);

  expect(registry.widgets().map(entry => entry.widget.id)).toEqual(['daily', 'today', 'recent']);
  expect(registry.widgets()[0]!.module.id).toBe('notes');
});

test('Commands are collected from all modules and remember their module', () => {
  const registry = createRegistry([
    stub('notes', { commands: [{ id: 'new', title: 'Новая заметка', run: () => {} }] }),
    stub('kcal'),
  ]);

  const commands = registry.commands();
  expect(commands).toHaveLength(1);
  expect(commands[0]!.module.id).toBe('notes');
  expect(commands[0]!.command.title).toBe('Новая заметка');
});

test('Unknown name is a typo, not data: get throws', () => {
  const registry = createRegistry([stub('notes')]);
  expect(registry.get('notes').id).toBe('notes');
  expect(() => registry.get('tasks')).toThrow(/not registered/);
});
