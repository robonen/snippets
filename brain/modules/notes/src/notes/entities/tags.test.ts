import { describe, expect, it } from 'vitest';
import { countOf, countTags } from './tags';
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

describe(countTags, () => {
  it('считает заметки на тег и ставит частые сверху', () => {
    const list = [
      note({ id: 'a', tags: ['работа', 'идеи'] }),
      note({ id: 'b', tags: ['работа'] }),
      note({ id: 'c', tags: ['работа', 'дом'] }),
    ];
    expect(countTags(list)).toEqual([
      { tag: 'работа', count: 3 },
      { tag: 'дом', count: 1 },
      { tag: 'идеи', count: 1 },
    ]);
  });

  it('одинаково частые разводятся алфавитом, а не порядком прихода', () => {
    const straight = countTags([note({ id: 'a', tags: ['ремонт', 'дом'] })]);
    const reversed = countTags([note({ id: 'a', tags: ['дом', 'ремонт'] })]);
    expect(straight.map(item => item.tag)).toEqual(['дом', 'ремонт']);
    expect(reversed).toEqual(straight);
  });

  it('повтор тега внутри одной заметки её дважды не считает', () => {
    // Такого набора парсер не отдаёт, но снимок приезжает и с другого
    // устройства — счётчик обязан оставаться числом ЗАМЕТОК.
    expect(countTags([note({ id: 'a', tags: ['дом', 'дом'] })])).toEqual([{ tag: 'дом', count: 1 }]);
  });

  it('без заметок и без тегов список пуст', () => {
    expect(countTags([])).toEqual([]);
    expect(countTags([note({ id: 'a' })])).toEqual([]);
  });
});

describe(countOf, () => {
  const counts = countTags([note({ id: 'a', tags: ['дом'] })]);

  it('находит число по тегу', () => {
    expect(countOf(counts, 'дом')).toBe(1);
  });

  it('у исчезнувшего тега ноль, а не пусто', () => {
    expect(countOf(counts, 'работа')).toBe(0);
  });
});
