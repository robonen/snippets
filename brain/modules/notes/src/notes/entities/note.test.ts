import { describe, expect, it } from 'vitest';
import {
  UNTITLED,
  hasTags,
  inScope,
  matchesQuery,
  noteLabel,
  noteSnippet,
  noteStats,
  sameContent,
  searchNotes,
  selectNotes,
  sortNotes,
} from './note';
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

describe(sortNotes, () => {
  it('pinned first, then by edit freshness', () => {
    const list = [
      note({ id: 'a', updatedAt: 30 }),
      note({ id: 'b', updatedAt: 10, pinned: true }),
      note({ id: 'c', updatedAt: 20 }),
    ];
    expect(sortNotes(list).map(item => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('pinned notes are ordered by freshness among themselves', () => {
    const list = [
      note({ id: 'a', updatedAt: 10, pinned: true }),
      note({ id: 'b', updatedAt: 40, pinned: true }),
    ];
    expect(sortNotes(list).map(item => item.id)).toEqual(['b', 'a']);
  });

  it('equal stamps are split by id, not by arrival order', () => {
    const straight = sortNotes([
      note({ id: 'b', updatedAt: 10, createdAt: 1 }),
      note({ id: 'a', updatedAt: 10, createdAt: 1 }),
    ]);
    const reversed = sortNotes([
      note({ id: 'a', updatedAt: 10, createdAt: 1 }),
      note({ id: 'b', updatedAt: 10, createdAt: 1 }),
    ]);
    expect(straight.map(item => item.id)).toEqual(['a', 'b']);
    expect(reversed.map(item => item.id)).toEqual(straight.map(item => item.id));
  });

  it('does not touch the source array', () => {
    const list = [note({ id: 'a', updatedAt: 1 }), note({ id: 'b', updatedAt: 2 })];
    sortNotes(list);
    expect(list.map(item => item.id)).toEqual(['a', 'b']);
  });

  it('by creation — newest created first, edit freshness ignored', () => {
    const list = [
      note({ id: 'a', createdAt: 10, updatedAt: 90 }),
      note({ id: 'b', createdAt: 30, updatedAt: 30 }),
      note({ id: 'c', createdAt: 20, updatedAt: 80 }),
    ];
    expect(sortNotes(list, 'created').map(item => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('by name — alphabetical, case-insensitive', () => {
    const list = [
      note({ id: 'a', title: 'Ремонт' }),
      note({ id: 'b', title: 'дневник' }),
      note({ id: 'c', title: 'Идеи' }),
    ];
    expect(sortNotes(list, 'title').map(item => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('by name the untitled go to the end, not the beginning', () => {
    const list = [note({ id: 'a' }), note({ id: 'b', title: 'Ремонт' })];
    expect(sortNotes(list, 'title').map(item => item.id)).toEqual(['b', 'a']);
  });

  it('pin beats any ordering', () => {
    const list = [
      note({ id: 'a', title: 'Ананас' }),
      note({ id: 'b', title: 'Яблоко', pinned: true }),
    ];
    expect(sortNotes(list, 'title').map(item => item.id)).toEqual(['b', 'a']);
    expect(sortNotes(list, 'created').map(item => item.id)).toEqual(['b', 'a']);
  });
});

describe(inScope, () => {
  const active = note({ id: 'a' });
  const pinned = note({ id: 'b', pinned: true });
  const archived = note({ id: 'c', archived: true });
  const both = note({ id: 'd', pinned: true, archived: true });

  it('ordinary slice shows everything except the archive', () => {
    expect([active, pinned, archived].filter(item => inScope(item, 'active')).map(item => item.id))
      .toEqual(['a', 'b']);
  });

  it('pinned — only them, and only outside the archive', () => {
    expect([active, pinned, both].filter(item => inScope(item, 'pinned')).map(item => item.id))
      .toEqual(['b']);
  });

  it('archive shows only the archived', () => {
    expect([active, pinned, archived, both].filter(item => inScope(item, 'archived')).map(item => item.id))
      .toEqual(['c', 'd']);
  });
});

describe(hasTags, () => {
  const item = note({ id: 'n', tags: ['работа', 'идеи'] });

  it('with no tags selected any note matches', () => {
    expect(hasTags(note({ id: 'x' }), [])).toBeTruthy();
  });

  it('several tags narrow: ALL are required', () => {
    expect(hasTags(item, ['работа'])).toBeTruthy();
    expect(hasTags(item, ['работа', 'идеи'])).toBeTruthy();
    expect(hasTags(item, ['работа', 'чтение'])).toBeFalsy();
  });
});

describe(matchesQuery, () => {
  const item = note({ id: 'n', title: 'Планы на неделю', tags: ['работа', 'идеи'] });

  it('empty query matches everything', () => {
    expect(matchesQuery(item, '   ')).toBeTruthy();
  });

  it('searches by a title fragment, case-insensitive', () => {
    expect(matchesQuery(item, 'НЕДЕЛ')).toBeTruthy();
  });

  it('searches by tag', () => {
    expect(matchesQuery(item, 'идеи')).toBeTruthy();
  });

  it('hash searches tags only', () => {
    expect(matchesQuery(item, '#работа')).toBeTruthy();
    expect(matchesQuery(item, '#планы')).toBeFalsy();
  });

  it('body is not searched', () => {
    expect(matchesQuery(note({ id: 'n', body: 'секретное слово' }), 'секретное')).toBeFalsy();
  });
});

describe(searchNotes, () => {
  it('filters and sorts in one pass', () => {
    const list = [
      note({ id: 'a', title: 'Планы', updatedAt: 10 }),
      note({ id: 'b', title: 'Покупки', updatedAt: 20 }),
      note({ id: 'c', title: 'План ремонта', updatedAt: 30 }),
    ];
    expect(searchNotes(list, 'план').map(item => item.id)).toEqual(['c', 'a']);
  });

  it('archived note does not enter the result even on an exact match', () => {
    const list = [
      note({ id: 'a', title: 'Планы' }),
      note({ id: 'b', title: 'Планы', archived: true }),
    ];
    expect(searchNotes(list, 'Планы').map(item => item.id)).toEqual(['a']);
  });
});

describe(selectNotes, () => {
  const list = [
    note({ id: 'a', title: 'Планы', tags: ['работа'], updatedAt: 10 }),
    note({ id: 'b', title: 'Ремонт', tags: ['работа', 'дом'], updatedAt: 20 }),
    note({ id: 'c', title: 'Идеи', tags: ['дом'], updatedAt: 30, archived: true }),
    note({ id: 'd', title: 'Дневник', updatedAt: 40, pinned: true }),
  ];

  it('without filters returns active notes in the default order', () => {
    expect(selectNotes(list).map(item => item.id)).toEqual(['d', 'b', 'a']);
  });

  it('archive slice retrieves what is hidden from the rest', () => {
    expect(selectNotes(list, { scope: 'archived' }).map(item => item.id)).toEqual(['c']);
  });

  it('tags narrow the result and do not pull out the archive', () => {
    expect(selectNotes(list, { tags: ['дом'] }).map(item => item.id)).toEqual(['b']);
    expect(selectNotes(list, { tags: ['дом'], scope: 'archived' }).map(item => item.id)).toEqual(['c']);
  });

  it('query and tags apply together', () => {
    expect(selectNotes(list, { tags: ['работа'], query: 'рем' }).map(item => item.id)).toEqual(['b']);
    expect(selectNotes(list, { tags: ['дом'], query: 'планы' })).toEqual([]);
  });

  it('pinned slice ignores the sort order', () => {
    expect(selectNotes(list, { scope: 'pinned', sort: 'title' }).map(item => item.id)).toEqual(['d']);
  });

  it('sorting applies after filtering', () => {
    expect(selectNotes(list, { sort: 'title' }).map(item => item.id)).toEqual(['d', 'a', 'b']);
  });
});

describe(sameContent, () => {
  const base = note({ id: 'n', title: 'Тема', body: 'текст', tags: ['a', 'b'] });

  it('snapshot equals itself even when edit stamps diverge', () => {
    expect(sameContent(base, { ...base, updatedAt: base.updatedAt + 1000 })).toBeTruthy();
  });

  it('sees edits to body, title, pin, archive, and tags', () => {
    expect(sameContent(base, { ...base, body: 'другой' })).toBeFalsy();
    expect(sameContent(base, { ...base, title: 'Другая' })).toBeFalsy();
    expect(sameContent(base, { ...base, pinned: true })).toBeFalsy();
    expect(sameContent(base, { ...base, archived: true })).toBeFalsy();
    expect(sameContent(base, { ...base, tags: ['a'] })).toBeFalsy();
    expect(sameContent(base, { ...base, tags: ['b', 'a'] })).toBeFalsy();
  });
});

describe(noteLabel, () => {
  it('untitled note is labeled explicitly', () => {
    expect(noteLabel(note({ id: 'n' }))).toBe(UNTITLED);
  });

  it('ordinary note is labeled with its own title', () => {
    expect(noteLabel(note({ id: 'n', title: 'Тема' }))).toBe('Тема');
  });

  it('daily note shows its date in human form', () => {
    const daily = note({ id: 'd', title: '2026-08-24', daily: '2026-08-24' });
    expect(noteLabel(daily, '2026-08-24')).toBe('Сегодня');
    expect(noteLabel(daily, '2026-08-25')).toBe('Вчера');
  });

  it('renamed daily note keeps its own title', () => {
    const renamed = note({ id: 'd', title: 'Отпуск', daily: '2026-08-24' });
    expect(noteLabel(renamed, '2026-08-24')).toBe('Отпуск');
  });
});

describe(noteSnippet, () => {
  it('takes the first meaningful line without markup', () => {
    expect(noteSnippet('\n\n# Заголовок\nвторая строка')).toBe('Заголовок');
  });

  it('strips link brackets', () => {
    expect(noteSnippet('- см. [[Планы]]')).toBe('см. Планы');
  });

  it('truncates a long line with an ellipsis', () => {
    expect(noteSnippet('а'.repeat(50), 10)).toBe(`${'а'.repeat(10)}…`);
  });

  it('empty body has no label', () => {
    expect(noteSnippet('\n  \n')).toBe('');
  });
});

describe(noteStats, () => {
  it('counts words between any whitespace', () => {
    expect(noteStats('раз два\nтри\tчетыре')).toMatchObject({ words: 4 });
  });

  it('empty body — zero and zero', () => {
    expect(noteStats('')).toEqual({ words: 0, chars: 0 });
    expect(noteStats('   \n  ')).toMatchObject({ words: 0 });
  });

  it('characters count as code points, not UTF-16 units', () => {
    expect(noteStats('🙂').chars).toBe(1);
  });

  it('edge spaces add no words', () => {
    expect(noteStats('  одно  ')).toMatchObject({ words: 1 });
  });
});
