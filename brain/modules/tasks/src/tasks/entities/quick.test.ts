import { describe, expect, it } from 'vitest';
import { hasHints, parseQuickTask } from './quick';

/**
 * Понедельник: от него легко считать дни недели вручную и видно, что «пн» в
 * понедельник — это сегодня, а не через неделю.
 */
const MONDAY = '2026-08-24';

describe('quick input: title', () => {
  it('string without markers becomes the title entirely', () => {
    expect(parseQuickTask('купить молока', MONDAY)).toEqual({ title: 'купить молока' });
  });

  it('empty string and spaces yield an empty title, not garbage', () => {
    expect(parseQuickTask('', MONDAY)).toEqual({ title: '' });
    expect(parseQuickTask('    ', MONDAY)).toEqual({ title: '' });
    expect(parseQuickTask('\n\t ', MONDAY)).toEqual({ title: '' });
  });

  it('extra spaces collapse', () => {
    expect(parseQuickTask('  купить   молока  ', MONDAY).title).toBe('купить молока');
  });

  it('parser understood nothing — and says so', () => {
    expect(hasHints(parseQuickTask('купить молока', MONDAY))).toBeFalsy();
    expect(hasHints(parseQuickTask('завтра', MONDAY))).toBeTruthy();
  });
});

describe('quick input: the spec example', () => {
  it('"завтра купить молока #дом !высокий" parses entirely', () => {
    expect(parseQuickTask('завтра купить молока #дом !высокий', MONDAY)).toEqual({
      title: 'купить молока',
      dueAt: '2026-08-25',
      project: 'дом',
      priority: 'high',
    });
  });

  it('marker order does not matter: the same string reversed parses the same', () => {
    expect(parseQuickTask('!высокий #дом купить молока завтра', MONDAY)).toEqual({
      title: 'купить молока',
      dueAt: '2026-08-25',
      project: 'дом',
      priority: 'high',
    });
  });
});

describe('quick input: relative dates', () => {
  it('today, tomorrow, day after tomorrow', () => {
    expect(parseQuickTask('сегодня отчёт', MONDAY).dueAt).toBe('2026-08-24');
    expect(parseQuickTask('завтра отчёт', MONDAY).dueAt).toBe('2026-08-25');
    expect(parseQuickTask('послезавтра отчёт', MONDAY).dueAt).toBe('2026-08-26');
  });

  it('case does not matter', () => {
    expect(parseQuickTask('Завтра отчёт', MONDAY).dueAt).toBe('2026-08-25');
    expect(parseQuickTask('ЗАВТРА отчёт', MONDAY).dueAt).toBe('2026-08-25');
  });

  it('weekday — the nearest such day, counting today', () => {
    // Понедельник 24-го: «пн» — сегодня, «вт» — завтра, «вс» — через шесть дней.
    expect(parseQuickTask('пн планёрка', MONDAY).dueAt).toBe('2026-08-24');
    expect(parseQuickTask('вт планёрка', MONDAY).dueAt).toBe('2026-08-25');
    expect(parseQuickTask('вс планёрка', MONDAY).dueAt).toBe('2026-08-30');
    expect(parseQuickTask('пятница планёрка', MONDAY).dueAt).toBe('2026-08-28');
  });

  it('"выходные" — the nearest Saturday', () => {
    expect(parseQuickTask('выходные дача', MONDAY).dueAt).toBe('2026-08-29');
    expect(parseQuickTask('выхи дача', MONDAY).dueAt).toBe('2026-08-29');
    // В само воскресенье выходные — это сегодня, а не суббота через шесть дней.
    expect(parseQuickTask('выходные дача', '2026-08-30').dueAt).toBe('2026-08-30');
  });

  it('"следнеделя" — the nearest Monday after today', () => {
    expect(parseQuickTask('следнеделя ретро', MONDAY).dueAt).toBe('2026-08-31');
  });

  it('"+N" — in N days', () => {
    expect(parseQuickTask('+3 напомнить', MONDAY).dueAt).toBe('2026-08-27');
    expect(parseQuickTask('+0 напомнить', MONDAY).dueAt).toBe('2026-08-24');
  });

  it('ISO date is taken as is, an impossible one is not taken at all', () => {
    expect(parseQuickTask('2026-09-05 отчёт', MONDAY)).toEqual({
      title: 'отчёт',
      dueAt: '2026-09-05',
    });
    expect(parseQuickTask('2026-13-40 отчёт', MONDAY)).toEqual({ title: '2026-13-40 отчёт' });
  });

  it('"5.09" — the nearest such date not in the past', () => {
    expect(parseQuickTask('5.09 отчёт', MONDAY).dueAt).toBe('2026-09-05');
    // 5 августа уже прошло — значит, речь про следующий год.
    expect(parseQuickTask('5.08 отчёт', MONDAY).dueAt).toBe('2027-08-05');
    // Сегодняшнее число — сегодня, а не через год.
    expect(parseQuickTask('24.08 отчёт', MONDAY).dueAt).toBe('2026-08-24');
  });

  it('"05.09.2026" — with a year the year is taken', () => {
    expect(parseQuickTask('05.09.2027 отчёт', MONDAY).dueAt).toBe('2027-09-05');
  });

  it('nonexistent day does not happen: "31.02" stays text', () => {
    expect(parseQuickTask('31.02 отчёт', MONDAY)).toEqual({ title: '31.02 отчёт' });
    expect(parseQuickTask('99.99 отчёт', MONDAY)).toEqual({ title: '99.99 отчёт' });
  });

  it('the word must match whole: "завтрашний" is not a date', () => {
    expect(parseQuickTask('обсудить завтрашний план', MONDAY)).toEqual({
      title: 'обсудить завтрашний план',
    });
    expect(parseQuickTask('сегодняшняя сводка', MONDAY)).toEqual({ title: 'сегодняшняя сводка' });
  });

  it('trailing comma does not break parsing and does not ride into the title', () => {
    expect(parseQuickTask('завтра, купить молока', MONDAY)).toEqual({
      title: 'купить молока',
      dueAt: '2026-08-25',
    });
  });

  it('one due date only: the second date stays text', () => {
    expect(parseQuickTask('сегодня завтра отчёт', MONDAY)).toEqual({
      title: 'завтра отчёт',
      dueAt: '2026-08-24',
    });
  });
});

describe('quick input: project', () => {
  it('"#имя" goes to the project, not to the title', () => {
    expect(parseQuickTask('починить кран #дом', MONDAY)).toEqual({
      title: 'починить кран',
      project: 'дом',
    });
  });

  it('project is a NAME, case is preserved', () => {
    expect(parseQuickTask('отчёт #Работа', MONDAY).project).toBe('Работа');
  });

  it('lone hash is just text', () => {
    expect(parseQuickTask('# купить', MONDAY)).toEqual({ title: '# купить' });
  });

  it('hash in the middle of a word is not a marker', () => {
    expect(parseQuickTask('канал c#-разработчиков', MONDAY)).toEqual({
      title: 'канал c#-разработчиков',
    });
  });

  it('second project is NOT lost: it stays in the title', () => {
    // Иначе «купить #молока #хлеба» молча потеряло бы половину покупок.
    expect(parseQuickTask('купить #молока #хлеба', MONDAY)).toEqual({
      title: 'купить #хлеба',
      project: 'молока',
    });
  });

  it('string of a single marker yields an empty title', () => {
    expect(parseQuickTask('#дом', MONDAY)).toEqual({ title: '', project: 'дом' });
  });
});

describe('quick input: priority', () => {
  it('Russian words', () => {
    expect(parseQuickTask('отчёт !срочный', MONDAY).priority).toBe('urgent');
    expect(parseQuickTask('отчёт !срочно', MONDAY).priority).toBe('urgent');
    expect(parseQuickTask('отчёт !высокий', MONDAY).priority).toBe('high');
    expect(parseQuickTask('отчёт !важно', MONDAY).priority).toBe('high');
    expect(parseQuickTask('отчёт !обычный', MONDAY).priority).toBe('normal');
    expect(parseQuickTask('отчёт !низкий', MONDAY).priority).toBe('low');
  });

  it('digits and Latin — for those who do not switch layouts', () => {
    expect(parseQuickTask('отчёт !1', MONDAY).priority).toBe('low');
    expect(parseQuickTask('отчёт !4', MONDAY).priority).toBe('urgent');
    expect(parseQuickTask('отчёт !high', MONDAY).priority).toBe('high');
    expect(parseQuickTask('отчёт !urgent', MONDAY).priority).toBe('urgent');
  });

  it('case does not matter', () => {
    expect(parseQuickTask('отчёт !Срочный', MONDAY).priority).toBe('urgent');
  });

  it('unknown word after "!" stays text', () => {
    expect(parseQuickTask('отчёт !ассап', MONDAY)).toEqual({ title: 'отчёт !ассап' });
    expect(parseQuickTask('ура!', MONDAY)).toEqual({ title: 'ура!' });
    expect(parseQuickTask('!', MONDAY)).toEqual({ title: '!' });
  });

  it('one priority only: the second stays text', () => {
    expect(parseQuickTask('отчёт !высокий !низкий', MONDAY)).toEqual({
      title: 'отчёт !низкий',
      priority: 'high',
    });
  });
});

describe('quick input: escaping', () => {
  it('backslash disables parsing of a marker', () => {
    expect(parseQuickTask('\\#дом это тег', MONDAY)).toEqual({ title: '#дом это тег' });
    expect(parseQuickTask('\\!высокий — это слово', MONDAY)).toEqual({
      title: '!высокий — это слово',
    });
  });

  it('backslash disables parsing of a date too', () => {
    expect(parseQuickTask('песня \\завтра', MONDAY)).toEqual({ title: 'песня завтра' });
  });

  it('exactly one backslash is consumed: the rest is text', () => {
    expect(parseQuickTask('\\\\#дом', MONDAY)).toEqual({ title: '\\#дом' });
  });

  it('escaping does not stop neighbors from parsing', () => {
    expect(parseQuickTask('\\#дом купить #продукты завтра', MONDAY)).toEqual({
      title: '#дом купить',
      project: 'продукты',
      dueAt: '2026-08-25',
    });
  });
});

describe('quick input: garbage and boundaries', () => {
  it('string of only markers yields an empty title and a full parse', () => {
    expect(parseQuickTask('завтра #дом !срочно', MONDAY)).toEqual({
      title: '',
      dueAt: '2026-08-25',
      project: 'дом',
      priority: 'urgent',
    });
  });

  it('markers do not appear in the result if they were absent', () => {
    const parsed = parseQuickTask('просто задача', MONDAY);
    for (const field of ['dueAt', 'project', 'priority']) {
      expect(Object.hasOwn(parsed, field)).toBeFalsy();
    }
  });

  it('property: the title never has leading or trailing spaces', () => {
    const inputs = [
      '  завтра  ',
      '#дом   ',
      '   !срочно',
      'завтра #дом !срочно купить молока',
      '\\#дом  ',
    ];
    for (const input of inputs) {
      expect(parseQuickTask(input, MONDAY).title).toBe(parseQuickTask(input, MONDAY).title.trim());
    }
  });

  it('property: the parser invents no words — everything left was in the input', () => {
    const input = 'завтра купить молока #дом !высокий и #хлеба';
    const { title } = parseQuickTask(input, MONDAY);
    for (const word of title.split(' ')) {
      expect(input).toContain(word);
    }
  });
});
