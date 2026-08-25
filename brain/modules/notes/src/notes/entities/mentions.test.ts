import { describe, expect, it } from 'vitest';
import { mentionsOf } from './mentions';
import type { Note } from './note';

function note(patch: Partial<Note> & { id: string }): Note {
  return {
    title: '',
    body: '',
    tags: [],
    pinned: false,
    archived: false,
    createdAt: 1_700_000,
    updatedAt: 1_700_000,
    ...patch,
  };
}

const target = note({ id: 'target', title: 'Планы на неделю' });

describe(mentionsOf, () => {
  it('finds notes that link by title', () => {
    const linker = note({ id: 'a', body: 'см. [[Планы на неделю]]' });
    const other = note({ id: 'b', body: 'ничего общего' });
    expect(mentionsOf(target, [target, linker, other]).map(item => item.id)).toEqual(['a']);
  });

  it('case and extra spaces in the link do not interfere', () => {
    const linker = note({ id: 'a', body: '[[планы   НА неделю]]' });
    expect(mentionsOf(target, [target, linker])).toHaveLength(1);
  });

  it('link with a label counts', () => {
    const linker = note({ id: 'a', body: '[[Планы на неделю|туда]]' });
    expect(mentionsOf(target, [target, linker])).toHaveLength(1);
  });

  it('note does not mention itself', () => {
    const selfish = note({ id: 'target', title: 'Планы на неделю', body: '[[Планы на неделю]]' });
    expect(mentionsOf(selfish, [selfish])).toEqual([]);
  });

  it('untitled note has no mentions: there is nothing to link to', () => {
    const empty = note({ id: 'x' });
    const linker = note({ id: 'a', body: '[[]]' });
    expect(mentionsOf(empty, [empty, linker])).toEqual([]);
  });

  it('archived note does not count as a mention: it was hidden from view', () => {
    const linker = note({ id: 'a', body: '[[Планы на неделю]]', archived: true });
    expect(mentionsOf(target, [target, linker])).toEqual([]);
  });

  it('mention as plain text without brackets does not count', () => {
    const linker = note({ id: 'a', body: 'обсудили планы на неделю' });
    expect(mentionsOf(target, [target, linker])).toEqual([]);
  });

  it('mentions follow the list order: pinned first, then by freshness', () => {
    const all = [
      target,
      note({ id: 'a', body: '[[Планы на неделю]]', updatedAt: 10 }),
      note({ id: 'b', body: '[[планы на неделю]]', updatedAt: 30 }),
      note({ id: 'c', body: '[[Планы на неделю]]', updatedAt: 1, pinned: true }),
    ];
    expect(mentionsOf(target, all).map(item => item.id)).toEqual(['c', 'b', 'a']);
  });
});
