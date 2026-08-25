import { describe, expect, it } from 'vitest';
import { extractLinks, linkKey } from './links';

describe(extractLinks, () => {
  it('extracts a link from text', () => {
    expect(extractLinks('см. [[Планы на неделю]] и дальше')).toEqual(['Планы на неделю']);
  });

  it('finds several links in one line', () => {
    expect(extractLinks('[[a]], [[b]] и [[c]]')).toEqual(['a', 'b', 'c']);
  });

  it('collapses duplicates, comparing case-insensitively and ignoring extra spaces', () => {
    expect(extractLinks('[[Идеи]] … [[идеи]] … [[  Идеи  ]]')).toEqual(['Идеи']);
  });

  it('trims spaces inside brackets', () => {
    expect(extractLinks('[[  Дневник  ]]')).toEqual(['Дневник']);
  });

  it('empty brackets do not count as a link', () => {
    expect(extractLinks('[[]] и [[   ]]')).toEqual([]);
  });

  it('unclosed bracket yields no link', () => {
    expect(extractLinks('[[Начал и бросил')).toEqual([]);
  });

  it('unclosed bracket does not span to the next line', () => {
    expect(extractLinks('[[Начал\nи закрыл не тем]]')).toEqual([]);
  });

  it('in nested brackets the inner pair wins', () => {
    expect(extractLinks('[[a [[b]] c]]')).toEqual(['b']);
  });

  it('single brackets and markdown links are untouched', () => {
    expect(extractLinks('[текст](https://example.com) и [сноска]')).toEqual([]);
  });

  it('extra closing brackets create no empty links', () => {
    expect(extractLinks('[[Тема]]]] хвост')).toEqual(['Тема']);
  });

  it('for a link with a label the title stays the address', () => {
    expect(extractLinks('[[Планы на неделю|планы]]')).toEqual(['Планы на неделю']);
  });

  it('link at the start and at the end of the body', () => {
    expect(extractLinks('[[раз]] середина [[два]]')).toEqual(['раз', 'два']);
  });

  it('empty body yields an empty list', () => {
    expect(extractLinks('')).toEqual([]);
    expect(extractLinks('[')).toEqual([]);
  });
});

describe(linkKey, () => {
  it('lowercases and collapses spaces', () => {
    expect(linkKey('  Планы   НА неделю ')).toBe('планы на неделю');
  });

  it('empty title yields an empty key', () => {
    expect(linkKey('   ')).toBe('');
  });
});
