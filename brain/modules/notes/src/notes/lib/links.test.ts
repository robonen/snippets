import { describe, expect, it } from 'vitest';
import { extractLinks, linkKey } from './links';

describe(extractLinks, () => {
  it('вынимает ссылку из текста', () => {
    expect(extractLinks('см. [[Планы на неделю]] и дальше')).toEqual(['Планы на неделю']);
  });

  it('находит несколько ссылок в одной строке', () => {
    expect(extractLinks('[[a]], [[b]] и [[c]]')).toEqual(['a', 'b', 'c']);
  });

  it('схлопывает повторы, сравнивая без регистра и лишних пробелов', () => {
    expect(extractLinks('[[Идеи]] … [[идеи]] … [[  Идеи  ]]')).toEqual(['Идеи']);
  });

  it('обрезает пробелы внутри скобок', () => {
    expect(extractLinks('[[  Дневник  ]]')).toEqual(['Дневник']);
  });

  it('пустые скобки ссылкой не считает', () => {
    expect(extractLinks('[[]] и [[   ]]')).toEqual([]);
  });

  it('незакрытая скобка не даёт ссылки', () => {
    expect(extractLinks('[[Начал и бросил')).toEqual([]);
  });

  it('незакрытая скобка не тянется на следующую строку', () => {
    expect(extractLinks('[[Начал\nи закрыл не тем]]')).toEqual([]);
  });

  it('во вложенных скобках выигрывает внутренняя пара', () => {
    expect(extractLinks('[[a [[b]] c]]')).toEqual(['b']);
  });

  it('одиночные скобки и markdown-ссылки не трогает', () => {
    expect(extractLinks('[текст](https://example.com) и [сноска]')).toEqual([]);
  });

  it('лишние закрывающие скобки не создают пустых ссылок', () => {
    expect(extractLinks('[[Тема]]]] хвост')).toEqual(['Тема']);
  });

  it('у ссылки с подписью адресом остаётся заголовок', () => {
    expect(extractLinks('[[Планы на неделю|планы]]')).toEqual(['Планы на неделю']);
  });

  it('ссылка в начале и в конце тела', () => {
    expect(extractLinks('[[раз]] середина [[два]]')).toEqual(['раз', 'два']);
  });

  it('пустое тело даёт пустой список', () => {
    expect(extractLinks('')).toEqual([]);
    expect(extractLinks('[')).toEqual([]);
  });
});

describe(linkKey, () => {
  it('гасит регистр и схлопывает пробелы', () => {
    expect(linkKey('  Планы   НА неделю ')).toBe('планы на неделю');
  });

  it('пустой заголовок даёт пустой ключ', () => {
    expect(linkKey('   ')).toBe('');
  });
});
