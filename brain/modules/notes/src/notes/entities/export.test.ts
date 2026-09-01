import { describe, expect, it } from 'vitest';
import { EMPTY_BODY, body, bullet, paragraph, run } from './body';
import { UNTITLED } from './note';
import type { Note } from './note';
import { exportName, noteToMarkdown, notesToMarkdown } from './export';

// Полдень по МЕСТНОМУ времени: дата у такой метки одна и та же в любом часовом
// поясе, а выгрузка форматирует именно местную дату.
const AT = new Date(2026, 7, 24, 12).getTime();

function note(patch: Partial<Note> & { id: string }): Note {
  return {
    title: '',
    body: EMPTY_BODY,
    tags: [],
    pinned: false,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
    ...patch,
  };
}

describe(noteToMarkdown, () => {
  it('first-level heading, metadata line, then the body as markdown', () => {
    const md = noteToMarkdown(note({
      id: 'n',
      title: 'Планы на неделю',
      tags: ['работа', 'идеи'],
      body: body(bullet('созвон'), bullet('см. ', run('[[Дневник]]', 'bold'))),
    }));

    expect(md).toBe([
      '# Планы на неделю',
      '',
      '*2026-08-24* · #работа #идеи',
      '',
      '- созвон',
      '- см. **[[Дневник]]**',
    ].join('\n'));
  });

  it('without tags only the date remains', () => {
    expect(noteToMarkdown(note({ id: 'n', title: 'Тема' }))).toBe('# Тема\n\n*2026-08-24*');
  });

  it('a body of blank paragraphs adds no block: no tail of blank lines needed', () => {
    const blank = note({ id: 'n', title: 'Тема', body: body(paragraph(), paragraph('  ')) });
    expect(noteToMarkdown(blank).endsWith('*2026-08-24*')).toBeTruthy();
  });

  it('untitled note is labeled explicitly', () => {
    expect(noteToMarkdown(note({ id: 'n' })).startsWith(`# ${UNTITLED}`)).toBeTruthy();
  });

  it('daily note goes to the file with an ISO date, not with "Today"', () => {
    const daily = note({ id: 'daily:2026-08-24', title: '2026-08-24', daily: '2026-08-24' });
    expect(noteToMarkdown(daily).startsWith('# 2026-08-24')).toBeTruthy();
  });
});

describe(notesToMarkdown, () => {
  it('joins notes with a rule and ends the file with a newline', () => {
    const md = notesToMarkdown([
      note({ id: 'a', title: 'Раз' }),
      note({ id: 'b', title: 'Два' }),
    ]);

    expect(md).toBe('# Раз\n\n*2026-08-24*\n\n---\n\n# Два\n\n*2026-08-24*\n');
  });

  it('order is preserved as given: the caller sorts', () => {
    const order = ['Три', 'Раз', 'Два'];
    const md = notesToMarkdown(order.map((title, index) => note({ id: String(index), title })));
    expect(md.match(/^# (.+)$/gmu)).toEqual(order.map(title => `# ${title}`));
  });

  it('empty export — an empty file, not a file of a single rule', () => {
    expect(notesToMarkdown([])).toBe('');
  });
});

describe(exportName, () => {
  it('file name is Latin and carries the export date', () => {
    expect(exportName(new Date(2026, 7, 24, 12))).toBe('notes-2026-08-24.md');
  });
});
