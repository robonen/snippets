import { getDay } from 'date-fns';
import { parseISODate, shiftISODate } from '@brain/std';
import { calendarDay } from '../lib/format';

/**
 * Быстрые варианты срока: «сегодня», «завтра», «выходные», «следующая неделя»,
 * «убрать».
 *
 * Живут отдельно от экрана, потому что дверей к ним ДВЕ: планировщик даты в
 * листе правки и разбор быстрого ввода (`quick.ts`, где «пн» и «выходные» —
 * такие же слова). Один и тот же вопрос «какое число у ближайшей субботы»
 * обязан иметь один ответ, иначе поповер и строка ввода назначат разные дни.
 *
 * Всё считается от переданного `today` и ничего не берёт из часов: тест не
 * должен зависеть от дня прогона, а список на экране — от того, пережила ли
 * вкладка полночь.
 */

/** День недели по числу `Date.getDay()`: воскресенье — ноль. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const SATURDAY: Weekday = 6;
const SUNDAY: Weekday = 0;
const MONDAY: Weekday = 1;

/** Неделя конечна: искомый день недели встречается максимум через шесть шагов. */
const WEEK = 7;

export function weekdayOf(iso: string): Weekday {
  return getDay(parseISODate(iso)) as Weekday;
}

/**
 * Ближайший день с таким днём недели, начиная С `from` включительно.
 *
 * Включительно — намеренно: сказанное в понедельник «пн» означает сегодня, а не
 * «через неделю». Отложить на неделю пользователь попросит словом «следующий», и
 * для этого есть {@link nextWeekStart}.
 */
export function nearestWeekday(from: string, weekday: Weekday): string {
  const shift = (weekday - weekdayOf(from) + WEEK) % WEEK;
  return shiftISODate(from, shift);
}

/**
 * «Выходные» — ближайшая суббота, но в само воскресенье это сегодня, а не
 * суббота через шесть дней: планировать выходные в воскресенье вечером на
 * следующую субботу пользователь не просил.
 */
export function weekendStart(today: string): string {
  if (weekdayOf(today) === SUNDAY) return today;
  return nearestWeekday(today, SATURDAY);
}

/** «Следующая неделя» — её первый день, то есть ближайший понедельник ПОСЛЕ сегодня. */
export function nextWeekStart(today: string): string {
  return nearestWeekday(shiftISODate(today, 1), MONDAY);
}

export type ScheduleId = 'today' | 'tomorrow' | 'weekend' | 'nextWeek' | 'clear';

export interface ScheduleOption {
  id: ScheduleId;
  label: string;
  /** Новый срок; `null` — снять срок. */
  dueAt: string | null;
  /**
   * Какое это число: «сб, 29 августа». Календарная форма, а не «Завтра»: подпись
   * существует ровно затем, чтобы перевести слово в дату, и повтор подписи
   * («Завтра — завтра») этой работы не делает. У «убрать» подписи нет.
   */
  hint?: string;
}

const LABELS: Record<ScheduleId, string> = {
  today: 'Сегодня',
  tomorrow: 'Завтра',
  weekend: 'Выходные',
  nextWeek: 'Следующая неделя',
  clear: 'Убрать срок',
};

export function scheduleDate(id: ScheduleId, today: string): string | null {
  if (id === 'today') return today;
  if (id === 'tomorrow') return shiftISODate(today, 1);
  if (id === 'weekend') return weekendStart(today);
  if (id === 'nextWeek') return nextWeekStart(today);
  return null;
}

/**
 * Варианты для планировщика. «Убрать срок» приходит, только если срок есть:
 * кнопка, которая ничего не делает, — это кнопка, после которой не понимаешь,
 * сработала ли она.
 *
 * «Выходные» отпадают в саму субботу: вариант, ведущий в сегодня, уже есть
 * первым в списке, и два разных слова для одного дня выглядят как ошибка.
 */
export function scheduleOptions(today: string, dueAt?: string): ScheduleOption[] {
  const ids: ScheduleId[] = ['today', 'tomorrow'];
  if (weekdayOf(today) !== SATURDAY && weekdayOf(today) !== SUNDAY) ids.push('weekend');
  ids.push('nextWeek');
  if (dueAt !== undefined && dueAt !== '') ids.push('clear');

  return ids.map((id) => {
    const date = scheduleDate(id, today);
    const option: ScheduleOption = { id, label: LABELS[id], dueAt: date };
    if (date !== null) option.hint = calendarDay(date);
    return option;
  });
}
