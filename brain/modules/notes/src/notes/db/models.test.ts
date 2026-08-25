import { describe, expect, it } from 'vitest';
import { Land, Link, createSpace, fixedClock } from '@sync/core';
import type { Space } from '@sync/core';
import type { Note } from '../entities/note';
import { NotesModel, readNote, writeNote } from './models';

function spaceOf(session = 0x000100): Space {
  const land = new Land(Link.peer(new Uint8Array(8).fill(0x4e)), fixedClock(1_700_000), { session });
  return createSpace({ land });
}

const NOTE: Note = {
  id: 'n1',
  title: 'Планы на неделю',
  body: '- созвон\n- см. [[Дневник]]',
  tags: ['работа', 'идеи'],
  pinned: true,
  archived: false,
  createdAt: 1_699_000,
  updatedAt: 1_700_100,
};

describe('note models on @sync/core', () => {
  it('note survives the document → snapshot round-trip', () => {
    const root = spaceOf().root(NotesModel);
    writeNote(root.notes(NOTE.id), NOTE);

    expect(readNote(NOTE.id, root.notes(NOTE.id))).toEqual(NOTE);
  });

  it('ordinary note does not acquire a day field', () => {
    const root = spaceOf().root(NotesModel);
    writeNote(root.notes(NOTE.id), NOTE);

    // Опциональное поле домена отсутствует, а не равно null: доменный тип не
    // меняется из-за того, что у каналов один сентинел.
    expect(Object.hasOwn(readNote(NOTE.id, root.notes(NOTE.id)), 'daily')).toBeFalsy();
  });

  it('daily note date survives the round-trip', () => {
    const root = spaceOf().root(NotesModel);
    const daily: Note = { ...NOTE, id: 'daily:2026-08-24', title: '2026-08-24', daily: '2026-08-24' };
    writeNote(root.notes(daily.id), daily);

    expect(readNote(daily.id, root.notes(daily.id))).toEqual(daily);
  });

  it('tags are normalized on the way into the land and back', () => {
    const root = spaceOf().root(NotesModel);
    writeNote(root.notes('n2'), { ...NOTE, id: 'n2', tags: ['#Работа', 'идеи', 'идеи'] });

    expect(readNote('n2', root.notes('n2')).tags).toEqual(['работа', 'идеи']);
  });

  it('archive survives the round-trip and stays a state, not a deletion', () => {
    const root = spaceOf().root(NotesModel);
    writeNote(root.notes('n4'), { ...NOTE, id: 'n4', archived: true });

    expect(readNote('n4', root.notes('n4'))).toMatchObject({ archived: true });
    expect(root.notes.has('n4')).toBeTruthy();
  });

  it('empty note reads as empty, not as broken', () => {
    const root = spaceOf().root(NotesModel);
    const empty: Note = {
      id: 'n3',
      title: '',
      body: '',
      tags: [],
      pinned: false,
      archived: false,
      createdAt: 0,
      updatedAt: 0,
    };
    writeNote(root.notes(empty.id), empty);

    expect(readNote(empty.id, root.notes(empty.id))).toEqual(empty);
  });

  it('catalog keys are visible and deletable', () => {
    const root = spaceOf().root(NotesModel);
    writeNote(root.notes('a'), { ...NOTE, id: 'a' });
    writeNote(root.notes('b'), { ...NOTE, id: 'b', title: 'Дневник' });

    expect([...root.notes.keys()].sort()).toEqual(['a', 'b']);
    root.notes.delete('a');
    expect([...root.notes.keys()]).toEqual(['b']);
  });

  it('two tabs converge: a note from one is visible in the other', () => {
    const clock = fixedClock(1_700_000);
    const peer = Link.peer(new Uint8Array(8).fill(0x4e));
    const tabA = new Land(peer, clock, { session: 0x000100 });
    const tabB = new Land(peer, clock, { session: 0x800100 });

    const rootA = createSpace({ land: tabA }).root(NotesModel);
    const rootB = createSpace({ land: tabB }).root(NotesModel);

    writeNote(rootA.notes('x'), { ...NOTE, id: 'x' });
    writeNote(rootB.notes('y'), { ...NOTE, id: 'y', title: 'Дневник' });

    tabB.apply(tabA.part().units);
    tabA.apply(tabB.part().units);

    expect(readNote('x', rootB.notes('x')).title).toBe('Планы на неделю');
    expect(readNote('y', rootA.notes('y')).title).toBe('Дневник');
  });
});
