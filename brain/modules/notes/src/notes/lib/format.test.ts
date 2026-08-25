import { describe, expect, it } from 'vitest';
import { fmtNotes, fmtWords, plural } from './format';

describe(plural, () => {
  it('singular only for numbers ending in 1', () => {
    expect(plural(1, 'заметка', 'заметки', 'заметок')).toBe('заметка');
    expect(plural(21, 'заметка', 'заметки', 'заметок')).toBe('заметка');
  });

  it('two to four — the second form', () => {
    expect(plural(2, 'заметка', 'заметки', 'заметок')).toBe('заметки');
    expect(plural(34, 'заметка', 'заметки', 'заметок')).toBe('заметки');
  });

  it('eleven to fourteen fall out of the last-digit rule', () => {
    expect(plural(11, 'заметка', 'заметки', 'заметок')).toBe('заметок');
    expect(plural(112, 'заметка', 'заметки', 'заметок')).toBe('заметок');
    expect(plural(114, 'заметка', 'заметки', 'заметок')).toBe('заметок');
  });

  it('zero and round tens — the third form', () => {
    expect(plural(0, 'заметка', 'заметки', 'заметок')).toBe('заметок');
    expect(plural(10, 'заметка', 'заметки', 'заметок')).toBe('заметок');
  });
});

describe('labels with a counter', () => {
  it('notes', () => {
    expect(fmtNotes(0)).toBe('0 заметок');
    expect(fmtNotes(1)).toBe('1 заметка');
    expect(fmtNotes(3)).toBe('3 заметки');
  });

  it('words', () => {
    expect(fmtWords(0)).toBe('0 слов');
    expect(fmtWords(1)).toBe('1 слово');
    expect(fmtWords(2)).toBe('2 слова');
  });
});
