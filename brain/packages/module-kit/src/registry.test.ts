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

test('маршруты модуля висят под /<id> и завёрнуты в свой хост', () => {
  const registry = createRegistry([stub('kcal'), stub('notes')]);
  const routes = registry.routes();

  expect(routes.map(route => route.path)).toEqual(['/kcal', '/notes']);
  expect(routes[0]!.meta).toEqual({ module: 'kcal', title: 'kcal' });
  expect(routes[0]!.children).toHaveLength(1);

  // Хост — свой компонент на модуль, иначе Vue переиспользует инстанс при
  // переходе между модулями и оставит вниз чужое пространство.
  expect(routes[0]!.component).not.toBe(routes[1]!.component);
});

test('одинаковые имена модулей отвергаются', () => {
  expect(() => createRegistry([stub('notes'), stub('notes')])).toThrow(/объявлен дважды/);
});

test('разные имена с одним адресом ленда отвергаются', () => {
  // Схема чеканки повторяет имя по кругу: «ab» и «abab» дают один ленд.
  expect(() => createRegistry([stub('ab'), stub('abab')])).toThrow(/один адрес ленда/);
});

test('имя «meta» занято лендом оболочки', () => {
  // Иначе модуль писал бы в ленд с инбоксом и настройками.
  expect(() => createRegistry([stub('meta')])).toThrow(/занято лендом оболочки/);
});

test('имя не по форме отвергается: из него строятся пути и адрес', () => {
  expect(() => createRegistry([stub('Notes')])).toThrow(/не годится/);
  expect(() => createRegistry([stub('my notes')])).toThrow(/не годится/);
  expect(() => createRegistry([stub('заметки')])).toThrow(/не годится/);
  expect(() => createRegistry([stub('a-very-long-module-id')])).toThrow(/не годится/);
});

test('виджеты собираются со всех модулей и сортируются по order', () => {
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

test('команды собираются со всех модулей и помнят свой модуль', () => {
  const registry = createRegistry([
    stub('notes', { commands: [{ id: 'new', title: 'Новая заметка', run: () => {} }] }),
    stub('kcal'),
  ]);

  const commands = registry.commands();
  expect(commands).toHaveLength(1);
  expect(commands[0]!.module.id).toBe('notes');
  expect(commands[0]!.command.title).toBe('Новая заметка');
});

test('незнакомое имя — опечатка, а не данные: get бросает', () => {
  const registry = createRegistry([stub('notes')]);
  expect(registry.get('notes').id).toBe('notes');
  expect(() => registry.get('tasks')).toThrow(/не зарегистрирован/);
});
