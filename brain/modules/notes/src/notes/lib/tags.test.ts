import { describe, expect, it } from 'vitest';
import { addTag, formatTags, normalizeTag, parseTags, removeTag, toggleTag } from './tags';

describe(normalizeTag, () => {
  it('strips the hash, spaces, and case', () => {
    expect(normalizeTag('  #Работа  ')).toBe('работа');
  });

  it('collapses spaces inside a tag', () => {
    expect(normalizeTag('личные   дела')).toBe('личные дела');
  });

  it('tag of only hashes and spaces becomes empty', () => {
    expect(normalizeTag('## ')).toBe('');
  });
});

describe(parseTags, () => {
  it('splits a string by commas and normalizes each tag', () => {
    expect(parseTags('Работа, #идеи ,ЧТЕНИЕ')).toEqual(['работа', 'идеи', 'чтение']);
  });

  it('drops empty pieces', () => {
    expect(parseTags(' , работа,,  ,')).toEqual(['работа']);
  });

  it('collapses duplicates, keeping first-appearance order', () => {
    expect(parseTags('идеи, Работа, ИДЕИ')).toEqual(['идеи', 'работа']);
  });

  it('empty string yields an empty list', () => {
    expect(parseTags('')).toEqual([]);
    expect(parseTags('   ')).toEqual([]);
  });
});

describe(addTag, () => {
  it('normalizes the added tag and appends it to the end', () => {
    expect(addTag(['работа'], ' #Идеи ')).toEqual(['работа', 'идеи']);
  });

  it('duplicate and empty tag DO NOT CHANGE THE SET — the same array is returned', () => {
    // Тождество здесь работает: экран сравнивает снимки, и новый массив с тем
    // же содержимым выглядел бы правкой заметки.
    const tags = ['работа'];
    expect(addTag(tags, 'Работа')).toBe(tags);
    expect(addTag(tags, '  #  ')).toBe(tags);
  });
});

describe(removeTag, () => {
  it('removes a tag, recognizing it in any spelling', () => {
    expect(removeTag(['работа', 'идеи'], '#Работа')).toEqual(['идеи']);
  });

  it('foreign tag does not change the set', () => {
    const tags = ['работа'];
    expect(removeTag(tags, 'чтение')).toBe(tags);
  });
});

describe(toggleTag, () => {
  it('adds a missing tag and removes a selected one', () => {
    expect(toggleTag([], 'дом')).toEqual(['дом']);
    expect(toggleTag(['дом', 'работа'], 'дом')).toEqual(['работа']);
  });

  it('double toggle returns the original set', () => {
    expect(toggleTag(toggleTag(['работа'], 'дом'), 'дом')).toEqual(['работа']);
  });
});

describe('tag round-trip', () => {
  it('parse ∘ format returns the same list', () => {
    const tags = ['работа', 'идеи', 'личные дела'];
    expect(parseTags(formatTags(tags))).toEqual(tags);
  });

  it('format ∘ parse normalizes input to canonical form', () => {
    expect(formatTags(parseTags('#Работа ,  идеи'))).toBe('работа, идеи');
  });

  it('empty list yields an empty string — and back', () => {
    expect(formatTags([])).toBe('');
    expect(parseTags(formatTags([]))).toEqual([]);
  });
});
