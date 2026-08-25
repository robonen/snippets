import { dayShort } from '@brain/std';

/**
 * Заготовки новой заметки.
 *
 * Шаблон — чистая функция «дата → заготовка», а не сохранённый где-то документ.
 * Хранить их в ленде значило бы синхронизировать между устройствами то, что
 * меняется вместе с кодом, и получить у человека версию шаблона годичной
 * давности, которую он никогда не правил.
 *
 * Заголовок и теги — часть заготовки наравне с телом: заметка со встречи без
 * тега «встреча» через месяц ничем не отличается от любой другой.
 */

export type TemplateId = 'blank' | 'daily' | 'meeting' | 'idea';

export interface NoteTemplate {
  readonly id: TemplateId;
  readonly title: string;
  readonly description: string;
}

/** Порядок — как в выборе: пустая первой, дальше по частоте применения. */
export const NOTE_TEMPLATES: readonly NoteTemplate[] = [
  { id: 'blank', title: 'Пустая', description: 'Чистый лист: заголовок и текст.' },
  { id: 'daily', title: 'Заметка дня', description: 'Планы, сделанное и мысли за день.' },
  { id: 'meeting', title: 'Встреча', description: 'Участники, повестка, решения и задачи.' },
  { id: 'idea', title: 'Идея', description: 'Суть, зачем и что делать дальше.' },
];

export interface TemplateDraft {
  readonly title: string;
  readonly body: string;
  /** Свой массив на каждый вызов: заготовка уходит прямо в заметку. */
  readonly tags: string[];
}

/**
 * Заготовка по шаблону и дате.
 *
 * Дата приходит аргументом, а не берётся из часов: шаблон обязан быть проверяем
 * без подмены времени, и «заметка дня за вчера» — законный случай.
 */
export function templateDraft(id: TemplateId, date: string): TemplateDraft {
  switch (id) {
    case 'daily':
      return {
        // Заголовок заметки дня — ISO-дата: он стабилен и адресуем из текста
        // (`[[2026-08-24]]`), тогда как «Сегодня» назавтра стало бы враньём.
        title: date,
        body: lines('## Планы', '', '-', '', '## Сделано', '', '-', '', '## Мысли', ''),
        tags: ['дневник'],
      };

    case 'meeting':
      return {
        title: `Встреча ${dayShort(date)}`,
        body: lines(
          `**Дата:** ${date}`,
          '**Кто был:**',
          '',
          '## Повестка',
          '-',
          '',
          '## Решения',
          '-',
          '',
          '## Задачи',
          '- [ ]',
          '',
        ),
        tags: ['встреча'],
      };

    case 'idea':
      return {
        // Заголовок пустой намеренно: идею называют, когда сформулировали, а
        // проставленное за человека «Идея 24.08» так и остаётся в списке.
        title: '',
        body: lines('## Суть', '', '## Зачем', '', '## Что дальше', '- [ ]', ''),
        tags: ['идея'],
      };

    default:
      return { title: '', body: '', tags: [] };
  }
}

function lines(...rows: readonly string[]): string {
  return rows.join('\n');
}
