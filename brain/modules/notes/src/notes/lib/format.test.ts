import { describe, expect, it } from 'vitest';
import { fmtNotes, fmtWords } from './format';

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
