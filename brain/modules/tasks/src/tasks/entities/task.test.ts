import { describe, expect, it } from 'vitest';
import {
  BUCKETS,
  bucketOf,
  createTask,
  draftFor,
  followUp,
  followUpSteps,
  isOverdue,
  matchesQuery,
  nextOrder,
  sameTask,
  sortTasks,
} from './task';
import type { Bucket, Task } from './task';

const TODAY = '2026-08-24';

function task(patch: Partial<Task> = {}): Task {
  return {
    id: 'a',
    title: 'Задача',
    status: 'active',
    createdAt: 1_700_000,
    updatedAt: 1_700_000,
    order: 1,
    ...patch,
  };
}

describe('раскладка задачи по корзинам', () => {
  it('без срока и без отсрочки — инбокс', () => {
    expect(bucketOf(task(), TODAY)).toBe('inbox');
  });

  it('сегодняшний и просроченный срок — «Сегодня»', () => {
    expect(bucketOf(task({ dueAt: TODAY }), TODAY)).toBe('today');
    expect(bucketOf(task({ dueAt: '2026-08-23' }), TODAY)).toBe('today');
    expect(bucketOf(task({ dueAt: '2020-01-01' }), TODAY)).toBe('today');
  });

  it('срок в будущем — «Запланировано»', () => {
    expect(bucketOf(task({ dueAt: '2026-08-25' }), TODAY)).toBe('scheduled');
  });

  it('отложенная без срока — «Когда-нибудь»', () => {
    expect(bucketOf(task({ status: 'someday' }), TODAY)).toBe('someday');
  });

  it('выполненная — «Выполнено», чем бы она ни была раньше', () => {
    expect(bucketOf(task({ doneAt: 1_700_100 }), TODAY)).toBe('done');
    expect(bucketOf(task({ dueAt: '2020-01-01', doneAt: 1_700_100 }), TODAY)).toBe('done');
    expect(bucketOf(task({ status: 'someday', doneAt: 1_700_100 }), TODAY)).toBe('done');
  });

  it('после слияния срок сильнее «когда-нибудь»: дело с датой не прячется', () => {
    // Одно устройство отложило задачу, второе назначило ей день — в ленде
    // окажутся оба поля, и раскладка обязана быть предсказуемой.
    expect(bucketOf(task({ status: 'someday', dueAt: '2026-08-25' }), TODAY)).toBe('scheduled');
    expect(bucketOf(task({ status: 'someday', dueAt: '2026-08-23' }), TODAY)).toBe('today');
  });

  it('раскладка меняется от смены дня, а не от записи в ленд', () => {
    const planned = task({ dueAt: '2026-08-25' });
    expect(bucketOf(planned, '2026-08-24')).toBe('scheduled');
    expect(bucketOf(planned, '2026-08-25')).toBe('today');
    expect(bucketOf(planned, '2026-08-26')).toBe('today');
  });

  it('просрочка — только у невыполненных', () => {
    expect(isOverdue(task({ dueAt: '2026-08-23' }), TODAY)).toBeTruthy();
    expect(isOverdue(task({ dueAt: TODAY }), TODAY)).toBeFalsy();
    expect(isOverdue(task({ dueAt: '2026-08-23', doneAt: 1 }), TODAY)).toBeFalsy();
    expect(isOverdue(task(), TODAY)).toBeFalsy();
  });
});

describe('заготовка новой задачи', () => {
  it('свойство: задача остаётся в той корзине, в которой её набрали', () => {
    const open = BUCKETS.filter((bucket): bucket is Bucket => bucket !== 'done');
    for (const bucket of open) {
      const created = createTask(
        { title: 'Дело', ...draftFor(bucket, TODAY) },
        { id: 'x', at: 1_700_000, order: 1 },
      );
      expect(bucketOf(created, TODAY)).toBe(bucket);
    }
  });

  it('обрезает пробелы и не заводит пустых полей', () => {
    const created = createTask({ title: '  Купить хлеб  ', note: '   ' }, { id: 'x', at: 5, order: 2 });
    expect(created.title).toBe('Купить хлеб');
    expect(Object.hasOwn(created, 'note')).toBeFalsy();
    expect(Object.hasOwn(created, 'dueAt')).toBeFalsy();
    expect(created.status).toBe('active');
    expect(created.createdAt).toBe(5);
    expect(created.updatedAt).toBe(5);
  });

  it('негодное правило повтора в задачу не попадает', () => {
    const created = createTask(
      { title: 'Дело', repeat: { unit: 'day', every: 0, enabled: true } },
      { id: 'x', at: 5, order: 2 },
    );
    expect(Object.hasOwn(created, 'repeat')).toBeFalsy();
  });

  it('следующее место в порядке — за последним', () => {
    expect(nextOrder([])).toBe(1);
    expect(nextOrder([1, 7, 3])).toBe(8);
    expect(nextOrder([-4])).toBe(1);
  });
});

describe('следующая задача повторяющейся серии', () => {
  const at = Date.parse('2026-08-24T10:00:00');

  it('рождается новой задачей, а выполненная остаётся в истории', () => {
    const source = task({ dueAt: '2026-08-24', repeat: { unit: 'day', every: 1, enabled: true } });
    const next = followUp(source, { id: 'b', at, order: 9 });

    expect(next).not.toBeNull();
    expect(next?.id).toBe('b');
    expect(next?.dueAt).toBe('2026-08-25');
    expect(next?.title).toBe(source.title);
    expect(next?.repeat).toEqual(source.repeat);
    expect(next?.order).toBe(9);
    // Наследовать отметку о выполнении новая задача не может — иначе серия
    // мгновенно закрывается сама.
    expect(next === null || Object.hasOwn(next, 'doneAt')).toBeFalsy();
  });

  it('без правила и с выключенным правилом следующей нет', () => {
    expect(followUp(task({ dueAt: '2026-08-24' }), { id: 'b', at, order: 2 })).toBeNull();
    expect(followUp(
      task({ dueAt: '2026-08-24', repeat: { unit: 'day', every: 1, enabled: false } }),
      { id: 'b', at, order: 2 },
    )).toBeNull();
  });

  it('бессрочная повторяющаяся задача считается от дня выполнения', () => {
    const source = task({ repeat: { unit: 'week', every: 1, enabled: true } });
    expect(followUp(source, { id: 'b', at, order: 2 })?.dueAt).toBe('2026-08-31');
  });

  it('просроченная серия догоняет сегодня, сохраняя ритм', () => {
    const source = task({ dueAt: '2026-01-05', repeat: { unit: 'month', every: 1, enabled: true } });
    expect(followUp(source, { id: 'b', at, order: 2 })?.dueAt).toBe('2026-09-05');
  });

  it('конец месяца в серии: 31-е прижимается и дальше идёт прижатым', () => {
    const source = task({ dueAt: '2026-01-31', repeat: { unit: 'month', every: 1, enabled: true } });
    const first = followUp(source, { id: 'b', at: Date.parse('2026-01-31T09:00:00'), order: 2 });
    expect(first?.dueAt).toBe('2026-02-28');

    const second = followUp(
      { ...source, dueAt: first?.dueAt ?? '' },
      { id: 'c', at: Date.parse('2026-02-28T09:00:00'), order: 3 },
    );
    expect(second?.dueAt).toBe('2026-03-28');
  });
});

describe('порядок и поиск', () => {
  it('в датированных корзинах ближний срок выше', () => {
    const list = [
      task({ id: 'c', dueAt: '2026-08-26' }),
      task({ id: 'a', dueAt: '2026-08-24' }),
      task({ id: 'b', dueAt: '2026-08-25' }),
    ];
    expect(sortTasks(list, 'scheduled').map(item => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('в инбоксе порядок ручной, затем по времени создания', () => {
    const list = [
      task({ id: 'c', order: 3, createdAt: 1 }),
      task({ id: 'a', order: 1, createdAt: 9 }),
      task({ id: 'b', order: 2, createdAt: 5 }),
    ];
    expect(sortTasks(list, 'inbox').map(item => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('в «Выполнено» — свежие сверху', () => {
    const list = [
      task({ id: 'a', doneAt: 10 }),
      task({ id: 'c', doneAt: 30 }),
      task({ id: 'b', doneAt: 20 }),
    ];
    expect(sortTasks(list, 'done').map(item => item.id)).toEqual(['c', 'b', 'a']);
  });

  it('в смешанном списке выполненные уходят вниз', () => {
    const list = [
      task({ id: 'a', doneAt: 10 }),
      task({ id: 'b' }),
    ];
    expect(sortTasks(list, 'today').map(item => item.id)).toEqual(['b', 'a']);
  });

  it('порядок полный: перемешанный вход даёт тот же результат', () => {
    // Снимок коллекции приезжает в порядке ключей ленда, и на двух устройствах
    // он разный — список обязан выглядеть одинаково.
    const list = [
      task({ id: 'b', order: 1, createdAt: 1 }),
      task({ id: 'a', order: 1, createdAt: 1 }),
      task({ id: 'c', order: 1, createdAt: 1 }),
    ];
    const straight = sortTasks(list, 'inbox').map(item => item.id);
    const shuffled = sortTasks([...list].reverse(), 'inbox').map(item => item.id);
    expect(straight).toEqual(['a', 'b', 'c']);
    expect(shuffled).toEqual(straight);
  });

  it('бессрочные — в хвосте датированных', () => {
    const list = [task({ id: 'b' }), task({ id: 'a', dueAt: '2026-08-25' })];
    expect(sortTasks(list, 'today').map(item => item.id)).toEqual(['a', 'b']);
  });

  it('равенство по существу не смотрит на время правки', () => {
    const item = task({ dueAt: '2026-08-25', repeat: { unit: 'day', every: 2, enabled: true } });
    expect(sameTask(item, { ...item, updatedAt: item.updatedAt + 1000 })).toBeTruthy();
    expect(sameTask(item, { ...item, title: 'Другое' })).toBeFalsy();
    expect(sameTask(item, { ...item, dueAt: undefined })).toBeFalsy();
    expect(sameTask(item, { ...item, repeat: { unit: 'day', every: 3, enabled: true } })).toBeFalsy();
    expect(sameTask(item, { ...item, repeat: undefined })).toBeFalsy();
    expect(sameTask(task(), { ...task(), note: '' })).toBeFalsy();
  });

  it('поиск идёт по заголовку и заметке и не замечает регистра', () => {
    const item = task({ title: 'Позвонить Маше', note: 'Про Отпуск' });
    expect(matchesQuery(item, 'маш')).toBeTruthy();
    expect(matchesQuery(item, 'ОТПУСК')).toBeTruthy();
    expect(matchesQuery(item, '  позвонить ')).toBeTruthy();
    expect(matchesQuery(item, 'банк')).toBeFalsy();
    expect(matchesQuery(item, '   ')).toBeFalsy();
    expect(matchesQuery(task({ title: 'Дело' }), 'дел')).toBeTruthy();
  });

  it('поиск находит и по пунктам чек-листа', () => {
    const item = task({
      title: 'Собраться в поход',
      steps: [{ id: 's1', title: 'Купить батарейки', order: 1 }],
    });
    expect(matchesQuery(item, 'батарей')).toBeTruthy();
    expect(matchesQuery(item, 'палатка')).toBeFalsy();
  });
});

describe('приоритет в задаче', () => {
  it('«обычный» в задачу не записывается: он и есть отсутствие приоритета', () => {
    const created = createTask({ title: 'Дело', priority: 'normal' }, { id: 'x', at: 1, order: 1 });
    expect(Object.hasOwn(created, 'priority')).toBeFalsy();

    const high = createTask({ title: 'Дело', priority: 'high' }, { id: 'x', at: 1, order: 1 });
    expect(high.priority).toBe('high');
  });

  it('внутри одной даты срочное выше обычного', () => {
    const list = [
      task({ id: 'b', dueAt: '2026-08-24' }),
      task({ id: 'a', dueAt: '2026-08-24', priority: 'urgent' }),
      task({ id: 'c', dueAt: '2026-08-24', priority: 'low' }),
    ];
    expect(sortTasks(list, 'today').map(item => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('СРОК СИЛЬНЕЕ ПРИОРИТЕТА: просроченное не прячется за срочным на пятницу', () => {
    const list = [
      task({ id: 'urgent-later', dueAt: '2026-08-28', priority: 'urgent' }),
      task({ id: 'plain-overdue', dueAt: '2026-08-20' }),
    ];
    expect(sortTasks(list, 'today').map(item => item.id)).toEqual(['plain-overdue', 'urgent-later']);
  });

  it('в корзинах без дат приоритет решает всё: там сравнивать больше нечего', () => {
    const list = [
      task({ id: 'b', order: 1 }),
      task({ id: 'a', order: 9, priority: 'urgent' }),
    ];
    expect(sortTasks(list, 'inbox').map(item => item.id)).toEqual(['a', 'b']);
  });

  it('в «Выполнено» приоритет не влияет: очереди больше нет, есть журнал', () => {
    const list = [
      task({ id: 'a', doneAt: 10, priority: 'urgent' }),
      task({ id: 'b', doneAt: 20 }),
    ];
    expect(sortTasks(list, 'done').map(item => item.id)).toEqual(['b', 'a']);
  });

  it('равенство по существу видит приоритет, но не отличает «обычный» от пустого', () => {
    const item = task();
    expect(sameTask(item, { ...item, priority: 'normal' })).toBeTruthy();
    expect(sameTask(item, { ...item, priority: 'high' })).toBeFalsy();
  });
});

describe('чек-лист в задаче', () => {
  const STEPS = [
    { id: 's2', title: 'Второй', order: 2, doneAt: 1_700_100 },
    { id: 's1', title: 'Первый', order: 1 },
  ];

  it('приезжает в задачу уже упорядоченным', () => {
    const created = createTask({ title: 'Дело', steps: STEPS }, { id: 'x', at: 1, order: 1 });
    expect(created.steps?.map(item => item.id)).toEqual(['s1', 's2']);
  });

  it('пустой список полем не становится', () => {
    const created = createTask({ title: 'Дело', steps: [] }, { id: 'x', at: 1, order: 1 });
    expect(Object.hasOwn(created, 'steps')).toBeFalsy();
  });

  it('равенство по существу видит правку пункта', () => {
    const item = task({ steps: [{ id: 's1', title: 'Первый', order: 1 }] });
    expect(sameTask(item, { ...item, steps: [{ id: 's1', title: 'Другой', order: 1 }] })).toBeFalsy();
    expect(sameTask(item, { ...item, steps: [{ id: 's1', title: 'Первый', order: 1 }] })).toBeTruthy();
    expect(sameTask(item, { ...item, steps: undefined })).toBeFalsy();
  });

  it('следующее вхождение повтора получает ЧИСТЫЙ чек-лист под своими ключами', () => {
    const source = task({
      dueAt: '2026-08-24',
      repeat: { unit: 'week', every: 1, enabled: true },
      steps: [
        { id: 's1', title: 'Форма', order: 1, doneAt: 1_700_100 },
        { id: 's2', title: 'Бутылка', order: 2, doneAt: 1_700_200 },
      ],
    });
    expect(followUpSteps(source)).toBe(2);

    const next = followUp(source, {
      id: 'b',
      at: Date.parse('2026-08-24T10:00:00'),
      order: 9,
      steps: ['n1', 'n2'],
    });

    expect(next?.steps).toEqual([
      { id: 'n1', title: 'Форма', order: 1 },
      { id: 'n2', title: 'Бутылка', order: 2 },
    ]);
  });

  it('задача без чек-листа не получает пустого поля при повторе', () => {
    const source = task({ dueAt: '2026-08-24', repeat: { unit: 'day', every: 1, enabled: true } });
    expect(followUpSteps(source)).toBe(0);
    const next = followUp(source, { id: 'b', at: Date.parse('2026-08-24T10:00:00'), order: 2 });
    expect(next === null || Object.hasOwn(next, 'steps')).toBeFalsy();
  });
});
