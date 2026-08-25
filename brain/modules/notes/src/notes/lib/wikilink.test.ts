import { describe, expect, it } from 'vitest';
import { insertLink, linkQueryAt } from './wikilink';

describe(linkQueryAt, () => {
  it('пустой запрос сразу после набора скобок — «покажи все»', () => {
    expect(linkQueryAt('см. [[', 6)).toBe('');
  });

  it('отдаёт набранное внутри скобок', () => {
    expect(linkQueryAt('см. [[пла', 9)).toBe('пла');
  });

  it('курсор между самими скобками ссылку ещё не открыл', () => {
    expect(linkQueryAt('[[', 1)).toBeUndefined();
  });

  it('после закрытой ссылки подсказки нет', () => {
    expect(linkQueryAt('см. [[Планы]] и дальше', 22)).toBeUndefined();
  });

  it('внутри закрытой ссылки подсказка есть: её как раз правят', () => {
    expect(linkQueryAt('см. [[Планы]]', 11)).toBe('Планы');
  });

  it('ссылка не тянется на следующую строку', () => {
    expect(linkQueryAt('[[Начал\nи бросил', 16)).toBeUndefined();
  });

  it('вложенные скобки переоткрывают ссылку — как и в разборе тела', () => {
    expect(linkQueryAt('[[a [[b', 7)).toBe('b');
  });

  it('без скобок слева подсказывать нечего', () => {
    expect(linkQueryAt('обычный текст', 13)).toBeUndefined();
    expect(linkQueryAt('', 0)).toBeUndefined();
    expect(linkQueryAt('[текст', 6)).toBeUndefined();
  });
});

describe(insertLink, () => {
  it('дописывает незакрытую пару и ставит курсор за неё', () => {
    const edit = insertLink('см. [[пла', 9, 'Планы на неделю');
    expect(edit.text).toBe('см. [[Планы на неделю]]');
    expect(edit.caret).toBe(edit.text.length);
  });

  it('без открытой пары вставляет ссылку целиком', () => {
    const edit = insertLink('см. ', 4, 'Планы');
    expect(edit.text).toBe('см. [[Планы]]');
    expect(edit.caret).toBe(edit.text.length);
  });

  it('хвост строки после курсора остаётся на месте', () => {
    const edit = insertLink('см. [[пла и дальше', 9, 'Планы');
    expect(edit.text).toBe('см. [[Планы]] и дальше');
    expect(edit.caret).toBe('см. [[Планы]]'.length);
  });

  it('лишние пробелы в заголовке по краям не уезжают в текст', () => {
    expect(insertLink('', 0, '  Планы  ').text).toBe('[[Планы]]');
  });

  it('вставленное сразу читается разбором: круг замыкается', () => {
    const edit = insertLink('см. [[пла', 9, 'Планы');
    expect(linkQueryAt(edit.text, edit.caret)).toBeUndefined();
  });
});
