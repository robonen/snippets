import { describe, expect, it } from 'vitest';
import { mentionsOf } from './mentions';
import type { Note } from './note';

function note(patch: Partial<Note> & { id: string }): Note {
  return {
    title: '',
    body: '',
    tags: [],
    pinned: false,
    archived: false,
    createdAt: 1_700_000,
    updatedAt: 1_700_000,
    ...patch,
  };
}

const target = note({ id: 'target', title: 'Планы на неделю' });

describe(mentionsOf, () => {
  it('находит заметки, ссылающиеся по заголовку', () => {
    const linker = note({ id: 'a', body: 'см. [[Планы на неделю]]' });
    const other = note({ id: 'b', body: 'ничего общего' });
    expect(mentionsOf(target, [target, linker, other]).map(item => item.id)).toEqual(['a']);
  });

  it('регистр и лишние пробелы в ссылке не мешают', () => {
    const linker = note({ id: 'a', body: '[[планы   НА неделю]]' });
    expect(mentionsOf(target, [target, linker])).toHaveLength(1);
  });

  it('ссылка с подписью считается', () => {
    const linker = note({ id: 'a', body: '[[Планы на неделю|туда]]' });
    expect(mentionsOf(target, [target, linker])).toHaveLength(1);
  });

  it('заметка не упоминает саму себя', () => {
    const selfish = note({ id: 'target', title: 'Планы на неделю', body: '[[Планы на неделю]]' });
    expect(mentionsOf(selfish, [selfish])).toEqual([]);
  });

  it('у заметки без заголовка упоминаний нет: ссылаться не на что', () => {
    const empty = note({ id: 'x' });
    const linker = note({ id: 'a', body: '[[]]' });
    expect(mentionsOf(empty, [empty, linker])).toEqual([]);
  });

  it('архивная заметка упоминанием не считается: её убрали с глаз', () => {
    const linker = note({ id: 'a', body: '[[Планы на неделю]]', archived: true });
    expect(mentionsOf(target, [target, linker])).toEqual([]);
  });

  it('упоминание текстом без скобок не считается', () => {
    const linker = note({ id: 'a', body: 'обсудили планы на неделю' });
    expect(mentionsOf(target, [target, linker])).toEqual([]);
  });

  it('упоминания идут в порядке списка: закреплённые сверху, дальше по свежести', () => {
    const all = [
      target,
      note({ id: 'a', body: '[[Планы на неделю]]', updatedAt: 10 }),
      note({ id: 'b', body: '[[планы на неделю]]', updatedAt: 30 }),
      note({ id: 'c', body: '[[Планы на неделю]]', updatedAt: 1, pinned: true }),
    ];
    expect(mentionsOf(target, all).map(item => item.id)).toEqual(['c', 'b', 'a']);
  });
});
