import { describe, expect, it } from 'vitest';
import { UNTITLED } from './note';
import type { Note } from './note';
import { exportName, noteToMarkdown, notesToMarkdown } from './export';

// Полдень по МЕСТНОМУ времени: дата у такой метки одна и та же в любом часовом
// поясе, а выгрузка форматирует именно местную дату.
const AT = new Date(2026, 7, 24, 12).getTime();

function note(patch: Partial<Note> & { id: string }): Note {
  return {
    title: '',
    body: '',
    tags: [],
    pinned: false,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
    ...patch,
  };
}

describe(noteToMarkdown, () => {
  it('заголовок первого уровня, метаданные строкой, дальше тело', () => {
    const md = noteToMarkdown(note({
      id: 'n',
      title: 'Планы на неделю',
      tags: ['работа', 'идеи'],
      body: '- созвон\n- см. [[Дневник]]',
    }));

    expect(md).toBe([
      '# Планы на неделю',
      '',
      '*2026-08-24* · #работа #идеи',
      '',
      '- созвон',
      '- см. [[Дневник]]',
    ].join('\n'));
  });

  it('без тегов остаётся только дата', () => {
    expect(noteToMarkdown(note({ id: 'n', title: 'Тема' }))).toBe('# Тема\n\n*2026-08-24*');
  });

  it('пустое тело блока не добавляет: хвост из пустых строк не нужен', () => {
    expect(noteToMarkdown(note({ id: 'n', title: 'Тема', body: '\n  \n' })).endsWith('*2026-08-24*')).toBeTruthy();
  });

  it('безымянная заметка подписана явно', () => {
    expect(noteToMarkdown(note({ id: 'n' })).startsWith(`# ${UNTITLED}`)).toBeTruthy();
  });

  it('заметка дня уходит в файл с ISO-датой, а не с «Сегодня»', () => {
    const daily = note({ id: 'daily:2026-08-24', title: '2026-08-24', daily: '2026-08-24' });
    expect(noteToMarkdown(daily).startsWith('# 2026-08-24')).toBeTruthy();
  });
});

describe(notesToMarkdown, () => {
  it('склеивает заметки чертой и закрывает файл переводом строки', () => {
    const md = notesToMarkdown([
      note({ id: 'a', title: 'Раз' }),
      note({ id: 'b', title: 'Два' }),
    ]);

    expect(md).toBe('# Раз\n\n*2026-08-24*\n\n---\n\n# Два\n\n*2026-08-24*\n');
  });

  it('порядок сохраняется как передали: сортирует вызывающий', () => {
    const order = ['Три', 'Раз', 'Два'];
    const md = notesToMarkdown(order.map((title, index) => note({ id: String(index), title })));
    expect(md.match(/^# (.+)$/gmu)).toEqual(order.map(title => `# ${title}`));
  });

  it('пустая выгрузка — пустой файл, а не файл из одной черты', () => {
    expect(notesToMarkdown([])).toBe('');
  });
});

describe(exportName, () => {
  it('имя латиницей и с датой выгрузки', () => {
    expect(exportName(new Date(2026, 7, 24, 12))).toBe('notes-2026-08-24.md');
  });
});
