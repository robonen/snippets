import { describe, expect, it } from 'vitest';
import { hasHints, parseQuickTask } from './quick';

/**
 * Понедельник: от него легко считать дни недели вручную и видно, что «пн» в
 * понедельник — это сегодня, а не через неделю.
 */
const MONDAY = '2026-08-24';

describe('быстрый ввод: заголовок', () => {
  it('строка без меток целиком становится заголовком', () => {
    expect(parseQuickTask('купить молока', MONDAY)).toEqual({ title: 'купить молока' });
  });

  it('пустая строка и пробелы дают пустой заголовок, а не мусор', () => {
    expect(parseQuickTask('', MONDAY)).toEqual({ title: '' });
    expect(parseQuickTask('    ', MONDAY)).toEqual({ title: '' });
    expect(parseQuickTask('\n\t ', MONDAY)).toEqual({ title: '' });
  });

  it('лишние пробелы схлопываются', () => {
    expect(parseQuickTask('  купить   молока  ', MONDAY).title).toBe('купить молока');
  });

  it('разбор ничего не понял — так и говорит', () => {
    expect(hasHints(parseQuickTask('купить молока', MONDAY))).toBeFalsy();
    expect(hasHints(parseQuickTask('завтра', MONDAY))).toBeTruthy();
  });
});

describe('быстрый ввод: пример из ТЗ', () => {
  it('«завтра купить молока #дом !высокий» разбирается целиком', () => {
    expect(parseQuickTask('завтра купить молока #дом !высокий', MONDAY)).toEqual({
      title: 'купить молока',
      dueAt: '2026-08-25',
      project: 'дом',
      priority: 'high',
    });
  });

  it('порядок меток не важен: та же строка задом наперёд даёт то же самое', () => {
    expect(parseQuickTask('!высокий #дом купить молока завтра', MONDAY)).toEqual({
      title: 'купить молока',
      dueAt: '2026-08-25',
      project: 'дом',
      priority: 'high',
    });
  });
});

describe('быстрый ввод: относительные даты', () => {
  it('сегодня, завтра, послезавтра', () => {
    expect(parseQuickTask('сегодня отчёт', MONDAY).dueAt).toBe('2026-08-24');
    expect(parseQuickTask('завтра отчёт', MONDAY).dueAt).toBe('2026-08-25');
    expect(parseQuickTask('послезавтра отчёт', MONDAY).dueAt).toBe('2026-08-26');
  });

  it('регистр не важен', () => {
    expect(parseQuickTask('Завтра отчёт', MONDAY).dueAt).toBe('2026-08-25');
    expect(parseQuickTask('ЗАВТРА отчёт', MONDAY).dueAt).toBe('2026-08-25');
  });

  it('день недели — ближайший такой день, считая сегодняшний', () => {
    // Понедельник 24-го: «пн» — сегодня, «вт» — завтра, «вс» — через шесть дней.
    expect(parseQuickTask('пн планёрка', MONDAY).dueAt).toBe('2026-08-24');
    expect(parseQuickTask('вт планёрка', MONDAY).dueAt).toBe('2026-08-25');
    expect(parseQuickTask('вс планёрка', MONDAY).dueAt).toBe('2026-08-30');
    expect(parseQuickTask('пятница планёрка', MONDAY).dueAt).toBe('2026-08-28');
  });

  it('«выходные» — ближайшая суббота', () => {
    expect(parseQuickTask('выходные дача', MONDAY).dueAt).toBe('2026-08-29');
    expect(parseQuickTask('выхи дача', MONDAY).dueAt).toBe('2026-08-29');
    // В само воскресенье выходные — это сегодня, а не суббота через шесть дней.
    expect(parseQuickTask('выходные дача', '2026-08-30').dueAt).toBe('2026-08-30');
  });

  it('«следнеделя» — ближайший понедельник после сегодня', () => {
    expect(parseQuickTask('следнеделя ретро', MONDAY).dueAt).toBe('2026-08-31');
  });

  it('«+N» — через N дней', () => {
    expect(parseQuickTask('+3 напомнить', MONDAY).dueAt).toBe('2026-08-27');
    expect(parseQuickTask('+0 напомнить', MONDAY).dueAt).toBe('2026-08-24');
  });

  it('дата в ISO берётся как есть, а невозможная — не берётся вовсе', () => {
    expect(parseQuickTask('2026-09-05 отчёт', MONDAY)).toEqual({
      title: 'отчёт',
      dueAt: '2026-09-05',
    });
    expect(parseQuickTask('2026-13-40 отчёт', MONDAY)).toEqual({ title: '2026-13-40 отчёт' });
  });

  it('«5.09» — ближайшее такое число не в прошлом', () => {
    expect(parseQuickTask('5.09 отчёт', MONDAY).dueAt).toBe('2026-09-05');
    // 5 августа уже прошло — значит, речь про следующий год.
    expect(parseQuickTask('5.08 отчёт', MONDAY).dueAt).toBe('2027-08-05');
    // Сегодняшнее число — сегодня, а не через год.
    expect(parseQuickTask('24.08 отчёт', MONDAY).dueAt).toBe('2026-08-24');
  });

  it('«05.09.2026» — с годом берётся год', () => {
    expect(parseQuickTask('05.09.2027 отчёт', MONDAY).dueAt).toBe('2027-09-05');
  });

  it('несуществующего дня не бывает: «31.02» остаётся текстом', () => {
    expect(parseQuickTask('31.02 отчёт', MONDAY)).toEqual({ title: '31.02 отчёт' });
    expect(parseQuickTask('99.99 отчёт', MONDAY)).toEqual({ title: '99.99 отчёт' });
  });

  it('слово опознаётся целиком: «завтрашний» — не дата', () => {
    expect(parseQuickTask('обсудить завтрашний план', MONDAY)).toEqual({
      title: 'обсудить завтрашний план',
    });
    expect(parseQuickTask('сегодняшняя сводка', MONDAY)).toEqual({ title: 'сегодняшняя сводка' });
  });

  it('хвостовая запятая разбору не мешает и в заголовок не едет', () => {
    expect(parseQuickTask('завтра, купить молока', MONDAY)).toEqual({
      title: 'купить молока',
      dueAt: '2026-08-25',
    });
  });

  it('срок один: вторая дата остаётся текстом', () => {
    expect(parseQuickTask('сегодня завтра отчёт', MONDAY)).toEqual({
      title: 'завтра отчёт',
      dueAt: '2026-08-24',
    });
  });
});

describe('быстрый ввод: проект', () => {
  it('«#имя» уезжает в проект, а не в заголовок', () => {
    expect(parseQuickTask('починить кран #дом', MONDAY)).toEqual({
      title: 'починить кран',
      project: 'дом',
    });
  });

  it('проект — это НАЗВАНИЕ, регистр сохраняется', () => {
    expect(parseQuickTask('отчёт #Работа', MONDAY).project).toBe('Работа');
  });

  it('одинокая решётка — просто текст', () => {
    expect(parseQuickTask('# купить', MONDAY)).toEqual({ title: '# купить' });
  });

  it('решётка в середине слова не считается меткой', () => {
    expect(parseQuickTask('канал c#-разработчиков', MONDAY)).toEqual({
      title: 'канал c#-разработчиков',
    });
  });

  it('второй проект НЕ теряется: он остаётся в заголовке', () => {
    // Иначе «купить #молока #хлеба» молча потеряло бы половину покупок.
    expect(parseQuickTask('купить #молока #хлеба', MONDAY)).toEqual({
      title: 'купить #хлеба',
      project: 'молока',
    });
  });

  it('строка из одной метки даёт пустой заголовок', () => {
    expect(parseQuickTask('#дом', MONDAY)).toEqual({ title: '', project: 'дом' });
  });
});

describe('быстрый ввод: приоритет', () => {
  it('русские слова', () => {
    expect(parseQuickTask('отчёт !срочный', MONDAY).priority).toBe('urgent');
    expect(parseQuickTask('отчёт !срочно', MONDAY).priority).toBe('urgent');
    expect(parseQuickTask('отчёт !высокий', MONDAY).priority).toBe('high');
    expect(parseQuickTask('отчёт !важно', MONDAY).priority).toBe('high');
    expect(parseQuickTask('отчёт !обычный', MONDAY).priority).toBe('normal');
    expect(parseQuickTask('отчёт !низкий', MONDAY).priority).toBe('low');
  });

  it('цифры и латиница — для тех, кто не переключает раскладку', () => {
    expect(parseQuickTask('отчёт !1', MONDAY).priority).toBe('low');
    expect(parseQuickTask('отчёт !4', MONDAY).priority).toBe('urgent');
    expect(parseQuickTask('отчёт !high', MONDAY).priority).toBe('high');
    expect(parseQuickTask('отчёт !urgent', MONDAY).priority).toBe('urgent');
  });

  it('регистр не важен', () => {
    expect(parseQuickTask('отчёт !Срочный', MONDAY).priority).toBe('urgent');
  });

  it('незнакомое слово после «!» остаётся текстом', () => {
    expect(parseQuickTask('отчёт !ассап', MONDAY)).toEqual({ title: 'отчёт !ассап' });
    expect(parseQuickTask('ура!', MONDAY)).toEqual({ title: 'ура!' });
    expect(parseQuickTask('!', MONDAY)).toEqual({ title: '!' });
  });

  it('приоритет один: второй остаётся текстом', () => {
    expect(parseQuickTask('отчёт !высокий !низкий', MONDAY)).toEqual({
      title: 'отчёт !низкий',
      priority: 'high',
    });
  });
});

describe('быстрый ввод: экранирование', () => {
  it('косая снимает разбор с метки', () => {
    expect(parseQuickTask('\\#дом это тег', MONDAY)).toEqual({ title: '#дом это тег' });
    expect(parseQuickTask('\\!высокий — это слово', MONDAY)).toEqual({
      title: '!высокий — это слово',
    });
  });

  it('косая снимает разбор и с даты', () => {
    expect(parseQuickTask('песня \\завтра', MONDAY)).toEqual({ title: 'песня завтра' });
  });

  it('снимается ровно одна косая: остальные — текст', () => {
    expect(parseQuickTask('\\\\#дом', MONDAY)).toEqual({ title: '\\#дом' });
  });

  it('экранирование не мешает соседям разбираться', () => {
    expect(parseQuickTask('\\#дом купить #продукты завтра', MONDAY)).toEqual({
      title: '#дом купить',
      project: 'продукты',
      dueAt: '2026-08-25',
    });
  });
});

describe('быстрый ввод: мусор и границы', () => {
  it('строка из одних меток даёт пустой заголовок и полный разбор', () => {
    expect(parseQuickTask('завтра #дом !срочно', MONDAY)).toEqual({
      title: '',
      dueAt: '2026-08-25',
      project: 'дом',
      priority: 'urgent',
    });
  });

  it('метки не появляются в ответе, если их не было', () => {
    const parsed = parseQuickTask('просто задача', MONDAY);
    for (const field of ['dueAt', 'project', 'priority']) {
      expect(Object.hasOwn(parsed, field)).toBeFalsy();
    }
  });

  it('свойство: заголовок никогда не содержит ведущих или хвостовых пробелов', () => {
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

  it('свойство: разбор не выдумывает слов — всё, что осталось, было во вводе', () => {
    const input = 'завтра купить молока #дом !высокий и #хлеба';
    const { title } = parseQuickTask(input, MONDAY);
    for (const word of title.split(' ')) {
      expect(input).toContain(word);
    }
  });
});
