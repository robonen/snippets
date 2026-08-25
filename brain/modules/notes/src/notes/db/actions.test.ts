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

describe('адрес заметки', () => {
  it('новый адрес каждый раз свой', () => {
    expect(newNoteId()).not.toBe(newNoteId());
  });

  it('адрес заметки дня чеканится из даты', () => {
    expect(dailyId('2026-08-24')).toBe('daily:2026-08-24');
    expect(dailyDateOf(dailyId('2026-08-24'))).toBe('2026-08-24');
  });

  it('обычный адрес днём не притворяется', () => {
    expect(dailyDateOf(newNoteId())).toBeUndefined();
    expect(dailyDateOf('daily:чушь')).toBeUndefined();
    expect(dailyDateOf('daily:2026-8-4')).toBeUndefined();
  });
});

describe(blankNote, () => {
  it('по обычному адресу — пустая заметка без дня', () => {
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

  it('по адресу заметки дня — заголовок и дата из адреса', () => {
    expect(blankNote(dailyId('2026-08-24'), 500)).toMatchObject({
      title: '2026-08-24',
      daily: '2026-08-24',
    });
  });
});

describe(saveNote, () => {
  it('заводит документ по адресу, которого ещё не было', () => {
    const space = spaceOf();
    const saved = saveNote(space, { ...blankNote('n1', 500), body: 'первая строка' }, 900);

    expect(readNote('n1', space.root(NotesModel).notes('n1'))).toEqual(saved);
    expect(saved).toMatchObject({ body: 'первая строка', createdAt: 500, updatedAt: 900 });
  });

  it('поднимает метку правки, не трогая метку создания', () => {
    const space = spaceOf();
    const first = saveNote(space, blankNote('n1', 500), 500);
    const second = saveNote(space, { ...first, title: 'Тема' }, 900);

    expect(second).toMatchObject({ createdAt: 500, updatedAt: 900 });
  });

  it('заглянуть по адресу и не написать ни буквы — не завести заметку', () => {
    const space = spaceOf();
    blankNote('n1', 500);

    expect(space.root(NotesModel).notes.size()).toBe(0);
  });
});

describe(createNote, () => {
  it('заводит заметку сразу — для команды палитры', () => {
    const space = spaceOf();
    const note = createNote(space, { title: 'Тема' }, 500);

    expect(readNote(note.id, space.root(NotesModel).notes(note.id))).toEqual(note);
    expect(note).toMatchObject({ title: 'Тема', createdAt: 500, updatedAt: 500 });
  });

  it('каждой заметке — свой адрес', () => {
    const space = spaceOf();
    createNote(space);
    createNote(space);

    expect(space.root(NotesModel).notes.size()).toBe(2);
  });
});

describe(createNoteAt, () => {
  it('кладёт заготовку по готовому адресу — тому же, куда уйдёт переход', () => {
    const space = spaceOf();
    const note = createNoteAt(space, 'n7', { title: 'Встреча', tags: ['встреча'] }, 500);

    expect(note.id).toBe('n7');
    expect(readNote('n7', space.root(NotesModel).notes('n7'))).toEqual(note);
  });
});

describe(noteExists, () => {
  it('различает заведённую заметку и свободный адрес', () => {
    const space = spaceOf();
    const note = createNote(space);

    expect(noteExists(space, note.id)).toBeTruthy();
    expect(noteExists(space, newNoteId())).toBeFalsy();
  });
});

describe(removeNote, () => {
  it('убирает заметку из каталога', () => {
    const space = spaceOf();
    const note = createNote(space);
    removeNote(space, note.id);

    expect(space.root(NotesModel).notes.has(note.id)).toBeFalsy();
  });
});

describe(restoreNote, () => {
  it('возвращает удалённую заметку такой, какой она была', () => {
    const space = spaceOf();
    const note = saveNote(space, { ...blankNote('n1', 500), title: 'Тема', body: 'текст' }, 700);
    removeNote(space, note.id);
    restoreNote(space, note);

    expect(readNote('n1', space.root(NotesModel).notes('n1'))).toEqual(note);
  });

  it('метку правки не поднимает: восстановление — не правка', () => {
    const space = spaceOf();
    const note = saveNote(space, blankNote('n1', 500), 700);
    removeNote(space, note.id);

    expect(restoreNote(space, note).updatedAt).toBe(700);
  });
});

describe(archiveNote, () => {
  it('убирает с глаз, не удаляя документ', () => {
    const space = spaceOf();
    const note = createNote(space, { title: 'Тема' }, 500);
    const moved = archiveNote(space, note, true, 900);

    expect(moved).toMatchObject({ archived: true, updatedAt: 900 });
    expect(readNote(note.id, space.root(NotesModel).notes(note.id))).toEqual(moved);
  });

  it('возврат из архива — то же действие с другим знаком', () => {
    const space = spaceOf();
    const note = createNote(space, { title: 'Тема' }, 500);
    const back = archiveNote(space, archiveNote(space, note, true, 900), false, 950);

    expect(back).toMatchObject({ archived: false, title: 'Тема' });
  });
});

describe(duplicateNote, () => {
  it('копия живёт по своему адресу и несёт то же содержимое', () => {
    const space = spaceOf();
    const note = createNote(space, { title: 'Тема', body: 'текст', tags: ['работа'] }, 500);
    const copy = duplicateNote(space, note, 900);

    expect(copy.id).not.toBe(note.id);
    expect(copy).toMatchObject({ title: 'Тема (копия)', body: 'текст', tags: ['работа'] });
    expect(readNote(copy.id, space.root(NotesModel).notes(copy.id))).toEqual(copy);
  });

  it('копия не наследует ни закрепление, ни архив, ни день', () => {
    const space = spaceOf();
    const daily = dailyNote(space, '2026-08-24', 500);
    const copy = duplicateNote(space, { ...daily, pinned: true, archived: true }, 900);

    expect(copy).toMatchObject({ pinned: false, archived: false, createdAt: 900, updatedAt: 900 });
    expect(copy.daily).toBeUndefined();
    expect(copy.title).toBe('2026-08-24 (копия)');
  });

  it('теги копии — свой массив, а не общий с оригиналом', () => {
    const space = spaceOf();
    const note = createNote(space, { tags: ['работа'] }, 500);
    const copy = duplicateNote(space, note, 900);
    copy.tags.push('идеи');

    expect(note.tags).toEqual(['работа']);
  });
});

describe(dailyNote, () => {
  it('заводит заметку дня с датой в заголовке', () => {
    const space = spaceOf();
    const note = dailyNote(space, '2026-08-24', 500);

    expect(note).toMatchObject({ id: 'daily:2026-08-24', title: '2026-08-24', daily: '2026-08-24' });
    expect(readNote(note.id, space.root(NotesModel).notes(note.id))).toEqual(note);
  });

  it('второй вызов открывает ту же заметку, а не заводит вторую', () => {
    const space = spaceOf();
    const first = dailyNote(space, '2026-08-24', 500);
    const edited = saveNote(space, { ...first, body: 'записал' }, 700);
    const again = dailyNote(space, '2026-08-24', 900);

    expect(again).toEqual(edited);
    expect(space.root(NotesModel).notes.size()).toBe(1);
  });

  it('разные дни — разные заметки', () => {
    const space = spaceOf();
    dailyNote(space, '2026-08-24', 500);
    dailyNote(space, '2026-08-25', 500);

    expect(space.root(NotesModel).notes.size()).toBe(2);
  });

  it('два устройства оффлайн сходятся в ОДНУ заметку дня', () => {
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
