import { describe, expect, it } from 'vitest';
import { plural } from './text';

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

  it('fractions take the second form, as Intl says', () => {
    expect(plural(1.5, 'день', 'дня', 'дней')).toBe('дня');
  });
});
