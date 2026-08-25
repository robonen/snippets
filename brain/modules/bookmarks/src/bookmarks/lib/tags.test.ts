import { describe, expect, it } from 'vitest';
import { formatTags, normalizeTags, parseTags } from './tags';

describe(normalizeTags, () => {
  it('приводит регистр и срезает решётку', () => {
    expect(normalizeTags(['Vue', '#CRDT'])).toEqual(['vue', 'crdt']);
  });

  it('выкидывает пустые и повторы, сохраняя порядок первого появления', () => {
    expect(normalizeTags(['vue', '  ', 'VUE', '', '#vue', 'rust'])).toEqual(['vue', 'rust']);
  });

  it('схлопывает внутренние пробелы: «local  first» и «local first» — один тег', () => {
    expect(normalizeTags(['local  first', 'local first'])).toEqual(['local first']);
  });

  it('пустой вход — пустой список', () => {
    expect(normalizeTags([])).toEqual([]);
  });
});

describe(parseTags, () => {
  it('разбирает строку по запятым, пробелам и переводам строк', () => {
    expect(parseTags('vue, Rust\ncrdt  #vue')).toEqual(['vue', 'rust', 'crdt']);
  });

  it('строка из одних разделителей тегов не даёт', () => {
    expect(parseTags(' , , ')).toEqual([]);
  });
});

describe(formatTags, () => {
  it('собирает обратно в строку поля ввода', () => {
    expect(formatTags(['vue', 'crdt'])).toBe('vue, crdt');
    expect(parseTags(formatTags(['vue', 'crdt']))).toEqual(['vue', 'crdt']);
  });
});
