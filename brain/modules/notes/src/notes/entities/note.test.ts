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
  it('закреплённые сверху, дальше по свежести правки', () => {
    const list = [
      note({ id: 'a', updatedAt: 30 }),
      note({ id: 'b', updatedAt: 10, pinned: true }),
      note({ id: 'c', updatedAt: 20 }),
    ];
    expect(sortNotes(list).map(item => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('закреплённые между собой тоже по свежести', () => {
    const list = [
      note({ id: 'a', updatedAt: 10, pinned: true }),
      note({ id: 'b', updatedAt: 40, pinned: true }),
    ];
    expect(sortNotes(list).map(item => item.id)).toEqual(['b', 'a']);
  });

  it('одинаковые метки разводятся по id, а не по порядку прихода', () => {
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

  it('исходный массив не трогает', () => {
    const list = [note({ id: 'a', updatedAt: 1 }), note({ id: 'b', updatedAt: 2 })];
    sortNotes(list);
    expect(list.map(item => item.id)).toEqual(['a', 'b']);
  });

  it('по созданию — свежесозданные сверху, свежесть правки не считается', () => {
    const list = [
      note({ id: 'a', createdAt: 10, updatedAt: 90 }),
      note({ id: 'b', createdAt: 30, updatedAt: 30 }),
      note({ id: 'c', createdAt: 20, updatedAt: 80 }),
    ];
    expect(sortNotes(list, 'created').map(item => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('по названию — по алфавиту без учёта регистра', () => {
    const list = [
      note({ id: 'a', title: 'Ремонт' }),
      note({ id: 'b', title: 'дневник' }),
      note({ id: 'c', title: 'Идеи' }),
    ];
    expect(sortNotes(list, 'title').map(item => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('по названию безымянные уезжают в конец, а не в начало', () => {
    const list = [note({ id: 'a' }), note({ id: 'b', title: 'Ремонт' })];
    expect(sortNotes(list, 'title').map(item => item.id)).toEqual(['b', 'a']);
  });

  it('закрепление сильнее любого порядка', () => {
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

  it('обычный срез показывает всё, кроме архива', () => {
    expect([active, pinned, archived].filter(item => inScope(item, 'active')).map(item => item.id))
      .toEqual(['a', 'b']);
  });

  it('закреплённые — только они, и только вне архива', () => {
    expect([active, pinned, both].filter(item => inScope(item, 'pinned')).map(item => item.id))
      .toEqual(['b']);
  });

  it('архив показывает только архивное', () => {
    expect([active, pinned, archived, both].filter(item => inScope(item, 'archived')).map(item => item.id))
      .toEqual(['c', 'd']);
  });
});

describe(hasTags, () => {
  const item = note({ id: 'n', tags: ['работа', 'идеи'] });

  it('без выбранных тегов подходит любая заметка', () => {
    expect(hasTags(note({ id: 'x' }), [])).toBeTruthy();
  });

  it('несколько тегов сужают: нужны ВСЕ', () => {
    expect(hasTags(item, ['работа'])).toBeTruthy();
    expect(hasTags(item, ['работа', 'идеи'])).toBeTruthy();
    expect(hasTags(item, ['работа', 'чтение'])).toBeFalsy();
  });
});

describe(matchesQuery, () => {
  const item = note({ id: 'n', title: 'Планы на неделю', tags: ['работа', 'идеи'] });

  it('пустой запрос подходит всем', () => {
    expect(matchesQuery(item, '   ')).toBeTruthy();
  });

  it('ищет по куску заголовка без учёта регистра', () => {
    expect(matchesQuery(item, 'НЕДЕЛ')).toBeTruthy();
  });

  it('ищет по тегу', () => {
    expect(matchesQuery(item, 'идеи')).toBeTruthy();
  });

  it('решётка ищет только по тегам', () => {
    expect(matchesQuery(item, '#работа')).toBeTruthy();
    expect(matchesQuery(item, '#планы')).toBeFalsy();
  });

  it('тело в поиск не входит', () => {
    expect(matchesQuery(note({ id: 'n', body: 'секретное слово' }), 'секретное')).toBeFalsy();
  });
});

describe(searchNotes, () => {
  it('фильтрует и сортирует одним проходом', () => {
    const list = [
      note({ id: 'a', title: 'Планы', updatedAt: 10 }),
      note({ id: 'b', title: 'Покупки', updatedAt: 20 }),
      note({ id: 'c', title: 'План ремонта', updatedAt: 30 }),
    ];
    expect(searchNotes(list, 'план').map(item => item.id)).toEqual(['c', 'a']);
  });

  it('архивная заметка в выдачу не попадает, даже если подходит слово в слово', () => {
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

  it('без фильтров отдаёт активные заметки в обычном порядке', () => {
    expect(selectNotes(list).map(item => item.id)).toEqual(['d', 'b', 'a']);
  });

  it('срез архива достаёт то, что скрыто от остальных', () => {
    expect(selectNotes(list, { scope: 'archived' }).map(item => item.id)).toEqual(['c']);
  });

  it('теги сужают выдачу и не вытаскивают архив', () => {
    expect(selectNotes(list, { tags: ['дом'] }).map(item => item.id)).toEqual(['b']);
    expect(selectNotes(list, { tags: ['дом'], scope: 'archived' }).map(item => item.id)).toEqual(['c']);
  });

  it('запрос и теги применяются вместе', () => {
    expect(selectNotes(list, { tags: ['работа'], query: 'рем' }).map(item => item.id)).toEqual(['b']);
    expect(selectNotes(list, { tags: ['дом'], query: 'планы' })).toEqual([]);
  });

  it('срез закреплённых не смотрит на порядок сортировки', () => {
    expect(selectNotes(list, { scope: 'pinned', sort: 'title' }).map(item => item.id)).toEqual(['d']);
  });

  it('сортировка применяется после фильтрации', () => {
    expect(selectNotes(list, { sort: 'title' }).map(item => item.id)).toEqual(['d', 'a', 'b']);
  });
});

describe(sameContent, () => {
  const base = note({ id: 'n', title: 'Тема', body: 'текст', tags: ['a', 'b'] });

  it('снимок равен себе, даже если метки правки разошлись', () => {
    expect(sameContent(base, { ...base, updatedAt: base.updatedAt + 1000 })).toBeTruthy();
  });

  it('видит правку тела, заголовка, закрепления, архива и тегов', () => {
    expect(sameContent(base, { ...base, body: 'другой' })).toBeFalsy();
    expect(sameContent(base, { ...base, title: 'Другая' })).toBeFalsy();
    expect(sameContent(base, { ...base, pinned: true })).toBeFalsy();
    expect(sameContent(base, { ...base, archived: true })).toBeFalsy();
    expect(sameContent(base, { ...base, tags: ['a'] })).toBeFalsy();
    expect(sameContent(base, { ...base, tags: ['b', 'a'] })).toBeFalsy();
  });
});

describe(noteLabel, () => {
  it('заметка без заголовка подписана явно', () => {
    expect(noteLabel(note({ id: 'n' }))).toBe(UNTITLED);
  });

  it('обычная заметка подписана своим заголовком', () => {
    expect(noteLabel(note({ id: 'n', title: 'Тема' }))).toBe('Тема');
  });

  it('заметке дня дату показывает по-человечески', () => {
    const daily = note({ id: 'd', title: '2026-08-24', daily: '2026-08-24' });
    expect(noteLabel(daily, '2026-08-24')).toBe('Сегодня');
    expect(noteLabel(daily, '2026-08-25')).toBe('Вчера');
  });

  it('переименованная заметка дня остаётся под своим заголовком', () => {
    const renamed = note({ id: 'd', title: 'Отпуск', daily: '2026-08-24' });
    expect(noteLabel(renamed, '2026-08-24')).toBe('Отпуск');
  });
});

describe(noteSnippet, () => {
  it('берёт первую содержательную строку без разметки', () => {
    expect(noteSnippet('\n\n# Заголовок\nвторая строка')).toBe('Заголовок');
  });

  it('снимает скобки ссылок', () => {
    expect(noteSnippet('- см. [[Планы]]')).toBe('см. Планы');
  });

  it('обрезает длинную строку многоточием', () => {
    expect(noteSnippet('а'.repeat(50), 10)).toBe(`${'а'.repeat(10)}…`);
  });

  it('у пустого тела подписи нет', () => {
    expect(noteSnippet('\n  \n')).toBe('');
  });
});

describe(noteStats, () => {
  it('считает слова между любыми пробелами', () => {
    expect(noteStats('раз два\nтри\tчетыре')).toMatchObject({ words: 4 });
  });

  it('пустое тело — ноль и ноль', () => {
    expect(noteStats('')).toEqual({ words: 0, chars: 0 });
    expect(noteStats('   \n  ')).toMatchObject({ words: 0 });
  });

  it('символы считаются кодовыми точками, а не единицами UTF-16', () => {
    expect(noteStats('🙂').chars).toBe(1);
  });

  it('пробелы по краям слов не добавляют', () => {
    expect(noteStats('  одно  ')).toMatchObject({ words: 1 });
  });
});
