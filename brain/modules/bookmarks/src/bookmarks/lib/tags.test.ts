import { describe, expect, it } from 'vitest';
import { formatTags, normalizeTags, parseTags } from './tags';

describe(normalizeTags, () => {
  it('lowercases and strips the hash', () => {
    expect(normalizeTags(['Vue', '#CRDT'])).toEqual(['vue', 'crdt']);
  });

  it('drops empties and duplicates, keeping first-appearance order', () => {
    expect(normalizeTags(['vue', '  ', 'VUE', '', '#vue', 'rust'])).toEqual(['vue', 'rust']);
  });

  it('collapses inner spaces: "local  first" and "local first" are one tag', () => {
    expect(normalizeTags(['local  first', 'local first'])).toEqual(['local first']);
  });

  it('empty input — empty list', () => {
    expect(normalizeTags([])).toEqual([]);
  });
});

describe(parseTags, () => {
  it('splits a string by commas, spaces, and line breaks', () => {
    expect(parseTags('vue, Rust\ncrdt  #vue')).toEqual(['vue', 'rust', 'crdt']);
  });

  it('string of only separators yields no tags', () => {
    expect(parseTags(' , , ')).toEqual([]);
  });
});

describe(formatTags, () => {
  it('reassembles back into the input-field string', () => {
    expect(formatTags(['vue', 'crdt'])).toBe('vue, crdt');
    expect(parseTags(formatTags(['vue', 'crdt']))).toEqual(['vue', 'crdt']);
  });
});
