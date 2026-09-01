import { describe, expect, it } from 'vitest';
import { Land, Link, createSpace, fixedClock } from '@sync/core';
import type { Space } from '@sync/core';
import { EMPTY_BODY, body, bullet, paragraph, run } from '../entities/body';
import type { Note } from '../entities/note';
import { NotesModel, readNote, writeNote } from './models';

function spaceOf(session = 0x000100): Space {
  const land = new Land(Link.peer(new Uint8Array(8).fill(0x4e)), fixedClock(1_700_000), { session });
  return createSpace({ land });
}

const NOTE: Note = {
  id: 'n1',
  title: 'Планы на неделю',
  body: body(bullet('созвон'), bullet('см. ', run('[[Дневник]]', 'italic'))),
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

  it('body keeps blocks, attrs and marks through the land', () => {
    const root = spaceOf().root(NotesModel);
    writeNote(root.notes(NOTE.id), NOTE);

    const back = readNote(NOTE.id, root.notes(NOTE.id)).body;
    expect(back.content.map(block => block.type)).toEqual(['bulleted-list', 'bulleted-list']);
    expect(back.content[1]?.content).toEqual([
      { text: 'см. ', marks: [] },
      { text: '[[Дневник]]', marks: [{ type: 'italic' }] },
    ]);
  });

  it('a body that is not a document reads as empty, not as a crash', () => {
    const root = spaceOf().root(NotesModel);
    writeNote(root.notes('n9'), { ...NOTE, id: 'n9', body: 'not a document' as never });

    expect(readNote('n9', root.notes('n9')).body).toEqual(EMPTY_BODY);
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
      body: EMPTY_BODY,
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
    writeNote(rootB.notes('y'), { ...NOTE, id: 'y', title: 'Дневник', body: body(paragraph('другой текст')) });

    // Тело документа крупнее инлайнового санда и едет «шаром» рядом с юнитами —
    // как и в настоящем синке, пачка применяется вместе с шарами.
    const partA = tabA.part();
    const partB = tabB.part();
    tabB.apply(partA.units, partA.balls);
    tabA.apply(partB.units, partB.balls);

    expect(readNote('x', rootB.notes('x')).title).toBe('Планы на неделю');
    expect(readNote('y', rootA.notes('y')).body.content[0]?.content).toEqual([{ text: 'другой текст', marks: [] }]);
  });
});
