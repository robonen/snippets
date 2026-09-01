import { describe, expect, it } from 'vitest';
import { blankProject } from '../entities/project';
import type { Project } from '../entities/project';
import { importMarkdown, projectToMarkdown, projectsToMarkdown } from './markdown';

const SAMPLE = `# Проекты 2023

## Forma Media (февраль - март)

::: warning
Проект приостановлен. Базовый функционал отображения готов, но отсутствует возможность загрузки и обработки видео.
:::

### Что это?
Forma Media - медиа-платформа, позволяющая публиковать видео и фильмы.
Загруженный контент будет доступен только для владельца.

### Стек
* Nuxt
* Laravel

### Команда
* [Андрей](https://github.com/robonen) - бэкенд
* [Рома](https://github.com/RomaFedoro) - фронтенд

## Chemodan CRM (февраль - май)

::: danger
Проект не был реализован.
:::

### Что это?
CRM для управления продажами и клиентами.

### Команда
* [Андрей](https://github.com/robonen) - бэкенд
* Кирилл - аналитик

## Cyrille (март 2023 - октябрь 2024)

### Что это?
Cyrille - приложение для чтения электронных книг.

### Стек
* React -> Nuxt
* Capacitor

### Команда
* [Андрей](https://github.com/robonen) - бэкенд

### Оплата
|    Дата    |           Сумма           |            Этап            |
|:----------:|:-------------------------:|:--------------------------:|
| 01.04.2023 | 50 000 руб. (25 000 руб.) |  Первая итерация проекта   |
| 16.08.2023 |        3 900 руб.         |       Оплата хостинга      |
| 09.09.2024 |          7500 руб.        |        Перенос книги       |
|            |                           |   Остаток - 152 500 руб.   |

## WGconf (ноябрь - январь 2024)

### Что это?
Конфигуратор wireguard.

## Стажировка (февраль - март)

::: info
Стажировка завершена. Все задания выполнены.
:::

## Podborka (с мая 2023)

### Что это?
Идёт.
`;

describe(importMarkdown, () => {
  const projects = importMarkdown(SAMPLE, 2023);

  it('reads every project of the file', () => {
    expect(projects.map(project => project.title)).toEqual([
      'Forma Media',
      'Chemodan CRM',
      'Cyrille',
      'WGconf',
      'Стажировка',
      'Podborka',
    ]);
  });

  it('takes the status and its note from the callout', () => {
    expect(projects[0]).toMatchObject({ status: 'paused', statusNote: expect.stringContaining('приостановлен') });
    expect(projects[1]).toMatchObject({ status: 'dropped' });
    expect(projects[4]).toMatchObject({ status: 'done', statusNote: 'Стажировка завершена. Все задания выполнены.' });
  });

  it('without a callout a finished period means done and an open one means active', () => {
    expect(projects[2]?.status).toBe('done');
    expect(projects[5]).toMatchObject({ status: 'active', startedAt: '2023-05' });
    expect(projects[5]?.endedAt).toBeUndefined();
  });

  it('resolves periods against the year heading, including a New Year crossing', () => {
    expect(projects[0]).toMatchObject({ startedAt: '2023-02', endedAt: '2023-03' });
    expect(projects[2]).toMatchObject({ startedAt: '2023-03', endedAt: '2024-10' });
    expect(projects[3]).toMatchObject({ startedAt: '2023-11', endedAt: '2024-01' });
  });

  it('keeps multi-line summaries, the stack and the team with links and roles', () => {
    expect(projects[0]?.summary).toBe(
      'Forma Media - медиа-платформа, позволяющая публиковать видео и фильмы.\nЗагруженный контент будет доступен только для владельца.',
    );
    expect(projects[0]?.stack).toEqual(['Nuxt', 'Laravel']);
    expect(projects[0]?.members).toEqual([
      { name: 'Андрей', role: 'бэкенд', link: 'https://github.com/robonen' },
      { name: 'Рома', role: 'фронтенд', link: 'https://github.com/RomaFedoro' },
    ]);
    expect(projects[1]?.members[1]).toEqual({ name: 'Кирилл', role: 'аналитик' });
  });

  it('reads the payments table: full amount, my share, note and the remainder as a budget', () => {
    expect(projects[2]?.payments).toEqual([
      { date: '2023-04-01', amount: 50_000, share: 25_000, note: 'Первая итерация проекта' },
      { date: '2023-08-16', amount: 3_900, note: 'Оплата хостинга' },
      { date: '2024-09-09', amount: 7_500, note: 'Перенос книги' },
    ]);
    expect(projects[2]?.budget).toBe(61_400 + 152_500);
  });

  it('a project without sections is still a project', () => {
    expect(projects[4]?.stack).toEqual([]);
    expect(projects[4]?.payments).toEqual([]);
  });
});

describe(projectToMarkdown, () => {
  const project: Project = {
    ...blankProject('p', 'Геобот', '2023-05', 'done', 1),
    endedAt: '2023-12',
    statusNote: 'Сдан заказчику.',
    summary: 'Бот для справок о земельных участках.',
    stack: ['Nest', 'Nuxt'],
    members: [{ id: 'm', name: 'Андрей', role: 'фуллстек', link: 'https://github.com/robonen', addedAt: 1 }],
    payments: [
      { id: 'a', date: '2023-06-05', amount: 10_000, note: 'Предоплата', addedAt: 1 },
      { id: 'b', date: '2023-12-29', amount: 27_000, share: 20_000, note: 'Полная оплата', addedAt: 2 },
    ],
    links: [{ id: 'l', title: 'Репозиторий', url: 'https://example.com/geo', addedAt: 1 }],
    journal: [{ id: 'j', date: '2023-12-29', text: 'Завершён — Сдан заказчику.', addedAt: 3 }],
    budget: 40_000,
  };

  it('writes the dialect the file was kept in', () => {
    expect(projectToMarkdown(project)).toBe([
      '## Геобот (май — декабрь)',
      '',
      '::: info',
      'Сдан заказчику.',
      ':::',
      '',
      '### Что это?',
      'Бот для справок о земельных участках.',
      '',
      '### Стек',
      '* Nest',
      '* Nuxt',
      '',
      '### Команда',
      '* [Андрей](https://github.com/robonen) — фуллстек',
      '',
      '### Ссылки',
      '* [Репозиторий](https://example.com/geo)',
      '',
      '### Оплата',
      '| Дата | Сумма | Этап |',
      '|:---:|:---:|:---:|',
      '| 05.06.2023 | 10 000 руб. | Предоплата |',
      '| 29.12.2023 | 27 000 руб. (20 000 руб.) | Полная оплата |',
      '| | | Остаток — 3 000 руб. |',
      '',
      '### Журнал',
      '* 29.12.2023 — Завершён — Сдан заказчику.',
    ].join('\n'));
  });

  it('survives a round trip through the importer', () => {
    const back = importMarkdown(`# Проекты 2023\n\n${projectToMarkdown(project)}\n`, 2023)[0];
    expect(back).toMatchObject({
      title: 'Геобот',
      status: 'done',
      statusNote: 'Сдан заказчику.',
      startedAt: '2023-05',
      endedAt: '2023-12',
      stack: ['Nest', 'Nuxt'],
      budget: 40_000,
    });
    expect(back?.payments.map(payment => payment.amount)).toEqual([10_000, 27_000]);
    expect(back?.journal).toEqual([{ date: '2023-12-29', text: 'Завершён — Сдан заказчику.' }]);
  });

  it('an ongoing project is written as «с месяца», an active one without a note has no callout', () => {
    const ongoing = { ...blankProject('o', 'Идёт', '2024-03', 'active', 1) };
    expect(projectToMarkdown(ongoing)).toBe('## Идёт (с марта 2024)');
  });

  it('groups the whole catalog by year, newest year first', () => {
    const older = { ...blankProject('x', 'Старый', '2022-01', 'done', 1), endedAt: '2022-02' };
    const md = projectsToMarkdown([older, project]);
    expect(md.startsWith('# Проекты 2023\n\n## Геобот')).toBeTruthy();
    expect(md).toContain('# Проекты 2022\n\n## Старый (январь — февраль)');
    expect(md.endsWith('\n')).toBeTruthy();
  });
});
