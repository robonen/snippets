import { describe, expect, it } from 'vitest';
import { Land, Link, createSpace, fixedClock } from '@sync/core';
import type { Space } from '@sync/core';
import {
  archiveNote,
  blankNote,
  createNote,
  createNoteAt,
  dailyDateOf,
  dailyId,
  dailyNote,
  duplicateNote,
  newNoteId,
  noteExists,
  removeNote,
  restoreNote,
  saveNote,
} from './actions';
import { NotesModel, readNote } from './models';

function spaceOf(session = 0x000100): Space {
  const land = new Land(Link.peer(new Uint8Array(8).fill(0x4e)), fixedClock(1_700_000), { session });
  return createSpace({ land });
}

describe('note address', () => {
  it('new address is unique every time', () => {
    expect(newNoteId()).not.toBe(newNoteId());
  });

  it('daily note address is minted from the date', () => {
    expect(dailyId('2026-08-24')).toBe('daily:2026-08-24');
    expect(dailyDateOf(dailyId('2026-08-24'))).toBe('2026-08-24');
  });

  it('ordinary address does not pretend to be a day', () => {
    expect(dailyDateOf(newNoteId())).toBeUndefined();
    expect(dailyDateOf('daily:чушь')).toBeUndefined();
    expect(dailyDateOf('daily:2026-8-4')).toBeUndefined();
  });
});

describe(blankNote, () => {
  it('ordinary address — an empty note without a day', () => {
    const blank = blankNote('n1', 500);
    expect(blank).toEqual({
      id: 'n1',
      title: '',
      body: '',
      tags: [],
      pinned: false,
      archived: false,
      createdAt: 500,
      updatedAt: 500,
    });
  });

  it('daily note address — title and date from the address', () => {
    expect(blankNote(dailyId('2026-08-24'), 500)).toMatchObject({
      title: '2026-08-24',
      daily: '2026-08-24',
    });
  });
});

describe(saveNote, () => {
  it('creates a document at an address that did not exist yet', () => {
    const space = spaceOf();
    const saved = saveNote(space, { ...blankNote('n1', 500), body: 'первая строка' }, 900);

    expect(readNote('n1', space.root(NotesModel).notes('n1'))).toEqual(saved);
    expect(saved).toMatchObject({ body: 'первая строка', createdAt: 500, updatedAt: 900 });
  });

  it('bumps the edit stamp without touching the creation stamp', () => {
    const space = spaceOf();
    const first = saveNote(space, blankNote('n1', 500), 500);
    const second = saveNote(space, { ...first, title: 'Тема' }, 900);

    expect(second).toMatchObject({ createdAt: 500, updatedAt: 900 });
  });

  it('visiting an address without typing a letter does not create a note', () => {
    const space = spaceOf();
    blankNote('n1', 500);

    expect(space.root(NotesModel).notes.size()).toBe(0);
  });
});

describe(createNote, () => {
  it('creates a note immediately — for the palette command', () => {
    const space = spaceOf();
    const note = createNote(space, { title: 'Тема' }, 500);

    expect(readNote(note.id, space.root(NotesModel).notes(note.id))).toEqual(note);
    expect(note).toMatchObject({ title: 'Тема', createdAt: 500, updatedAt: 500 });
  });

  it('every note gets its own address', () => {
    const space = spaceOf();
    createNote(space);
    createNote(space);

    expect(space.root(NotesModel).notes.size()).toBe(2);
  });
});

describe(createNoteAt, () => {
  it('puts the draft at a ready address — the same one the navigation goes to', () => {
    const space = spaceOf();
    const note = createNoteAt(space, 'n7', { title: 'Встреча', tags: ['встреча'] }, 500);

    expect(note.id).toBe('n7');
    expect(readNote('n7', space.root(NotesModel).notes('n7'))).toEqual(note);
  });
});

describe(noteExists, () => {
  it('distinguishes a created note from a free address', () => {
    const space = spaceOf();
    const note = createNote(space);

    expect(noteExists(space, note.id)).toBeTruthy();
    expect(noteExists(space, newNoteId())).toBeFalsy();
  });
});

describe(removeNote, () => {
  it('removes the note from the catalog', () => {
    const space = spaceOf();
    const note = createNote(space);
    removeNote(space, note.id);

    expect(space.root(NotesModel).notes.has(note.id)).toBeFalsy();
  });
});

describe(restoreNote, () => {
  it('returns the deleted note exactly as it was', () => {
    const space = spaceOf();
    const note = saveNote(space, { ...blankNote('n1', 500), title: 'Тема', body: 'текст' }, 700);
    removeNote(space, note.id);
    restoreNote(space, note);

    expect(readNote('n1', space.root(NotesModel).notes('n1'))).toEqual(note);
  });

  it('does not bump the edit stamp: restoring is not editing', () => {
    const space = spaceOf();
    const note = saveNote(space, blankNote('n1', 500), 700);
    removeNote(space, note.id);

    expect(restoreNote(space, note).updatedAt).toBe(700);
  });
});

describe(archiveNote, () => {
  it('hides from view without deleting the document', () => {
    const space = spaceOf();
    const note = createNote(space, { title: 'Тема' }, 500);
    const moved = archiveNote(space, note, true, 900);

    expect(moved).toMatchObject({ archived: true, updatedAt: 900 });
    expect(readNote(note.id, space.root(NotesModel).notes(note.id))).toEqual(moved);
  });

  it('return from the archive is the same action with the opposite sign', () => {
    const space = spaceOf();
    const note = createNote(space, { title: 'Тема' }, 500);
    const back = archiveNote(space, archiveNote(space, note, true, 900), false, 950);

    expect(back).toMatchObject({ archived: false, title: 'Тема' });
  });
});

describe(duplicateNote, () => {
  it('copy lives at its own address and carries the same content', () => {
    const space = spaceOf();
    const note = createNote(space, { title: 'Тема', body: 'текст', tags: ['работа'] }, 500);
    const copy = duplicateNote(space, note, 900);

    expect(copy.id).not.toBe(note.id);
    expect(copy).toMatchObject({ title: 'Тема (копия)', body: 'текст', tags: ['работа'] });
    expect(readNote(copy.id, space.root(NotesModel).notes(copy.id))).toEqual(copy);
  });

  it('copy inherits neither pin, nor archive, nor day', () => {
    const space = spaceOf();
    const daily = dailyNote(space, '2026-08-24', 500);
    const copy = duplicateNote(space, { ...daily, pinned: true, archived: true }, 900);

    expect(copy).toMatchObject({ pinned: false, archived: false, createdAt: 900, updatedAt: 900 });
    expect(copy.daily).toBeUndefined();
    expect(copy.title).toBe('2026-08-24 (копия)');
  });

  it('copy tags are their own array, not shared with the original', () => {
    const space = spaceOf();
    const note = createNote(space, { tags: ['работа'] }, 500);
    const copy = duplicateNote(space, note, 900);
    copy.tags.push('идеи');

    expect(note.tags).toEqual(['работа']);
  });
});

describe(dailyNote, () => {
  it('creates a daily note with the date in the title', () => {
    const space = spaceOf();
    const note = dailyNote(space, '2026-08-24', 500);

    expect(note).toMatchObject({ id: 'daily:2026-08-24', title: '2026-08-24', daily: '2026-08-24' });
    expect(readNote(note.id, space.root(NotesModel).notes(note.id))).toEqual(note);
  });

  it('second call opens the same note instead of creating a second one', () => {
    const space = spaceOf();
    const first = dailyNote(space, '2026-08-24', 500);
    const edited = saveNote(space, { ...first, body: 'записал' }, 700);
    const again = dailyNote(space, '2026-08-24', 900);

    expect(again).toEqual(edited);
    expect(space.root(NotesModel).notes.size()).toBe(1);
  });

  it('different days — different notes', () => {
    const space = spaceOf();
    dailyNote(space, '2026-08-24', 500);
    dailyNote(space, '2026-08-25', 500);

    expect(space.root(NotesModel).notes.size()).toBe(2);
  });

  it('two offline devices converge into ONE daily note', () => {
    const clock = fixedClock(1_700_000);
    const peer = Link.peer(new Uint8Array(8).fill(0x4e));
    const phone = new Land(peer, clock, { session: 0x000100 });
    const laptop = new Land(peer, clock, { session: 0x800100 });

    const onPhone = createSpace({ land: phone });
    const onLaptop = createSpace({ land: laptop });

    dailyNote(onPhone, '2026-08-24', 500);
    dailyNote(onLaptop, '2026-08-24', 600);

    laptop.apply(phone.part().units);
    phone.apply(laptop.part().units);

    expect(onPhone.root(NotesModel).notes.size()).toBe(1);
    expect(onLaptop.root(NotesModel).notes.size()).toBe(1);
  });
});
