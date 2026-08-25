import { describe, expect, it } from 'vitest';
import { insertLink, linkQueryAt } from './wikilink';

describe(linkQueryAt, () => {
  it('empty query right after typing brackets — "show all"', () => {
    expect(linkQueryAt('см. [[', 6)).toBe('');
  });

  it('returns what was typed inside the brackets', () => {
    expect(linkQueryAt('см. [[пла', 9)).toBe('пла');
  });

  it('cursor between the brackets themselves has not opened a link yet', () => {
    expect(linkQueryAt('[[', 1)).toBeUndefined();
  });

  it('no suggestion after a closed link', () => {
    expect(linkQueryAt('см. [[Планы]] и дальше', 22)).toBeUndefined();
  });

  it('suggestion inside a closed link exists: that is what is being edited', () => {
    expect(linkQueryAt('см. [[Планы]]', 11)).toBe('Планы');
  });

  it('link does not span to the next line', () => {
    expect(linkQueryAt('[[Начал\nи бросил', 16)).toBeUndefined();
  });

  it('nested brackets reopen the link — same as in body parsing', () => {
    expect(linkQueryAt('[[a [[b', 7)).toBe('b');
  });

  it('nothing to suggest without brackets to the left', () => {
    expect(linkQueryAt('обычный текст', 13)).toBeUndefined();
    expect(linkQueryAt('', 0)).toBeUndefined();
    expect(linkQueryAt('[текст', 6)).toBeUndefined();
  });
});

describe(insertLink, () => {
  it('completes the unclosed pair and puts the cursor after it', () => {
    const edit = insertLink('см. [[пла', 9, 'Планы на неделю');
    expect(edit.text).toBe('см. [[Планы на неделю]]');
    expect(edit.caret).toBe(edit.text.length);
  });

  it('without an open pair inserts the whole link', () => {
    const edit = insertLink('см. ', 4, 'Планы');
    expect(edit.text).toBe('см. [[Планы]]');
    expect(edit.caret).toBe(edit.text.length);
  });

  it('line tail after the cursor stays in place', () => {
    const edit = insertLink('см. [[пла и дальше', 9, 'Планы');
    expect(edit.text).toBe('см. [[Планы]] и дальше');
    expect(edit.caret).toBe('см. [[Планы]]'.length);
  });

  it('edge spaces of the title do not leak into the text', () => {
    expect(insertLink('', 0, '  Планы  ').text).toBe('[[Планы]]');
  });

  it('inserted text parses right back: the loop closes', () => {
    const edit = insertLink('см. [[пла', 9, 'Планы');
    expect(linkQueryAt(edit.text, edit.caret)).toBeUndefined();
  });
});
