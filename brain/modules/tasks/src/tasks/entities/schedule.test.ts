import { describe, expect, it } from 'vitest';
import {
  nearestWeekday,
  nextWeekStart,
  scheduleDate,
  scheduleOptions,
  weekdayOf,
  weekendStart,
} from './schedule';
import type { ScheduleId } from './schedule';

// Неделя 24–30 августа 2026 года: понедельник — 24-е, воскресенье — 30-е.
const MONDAY = '2026-08-24';
const FRIDAY = '2026-08-28';
const SATURDAY = '2026-08-29';
const SUNDAY = '2026-08-30';

describe('weekdays', () => {
  it('counted like Date: Sunday is zero', () => {
    expect(weekdayOf(MONDAY)).toBe(1);
    expect(weekdayOf(SATURDAY)).toBe(6);
    expect(weekdayOf(SUNDAY)).toBe(0);
  });

  it('nearest weekday includes today', () => {
    expect(nearestWeekday(MONDAY, 1)).toBe(MONDAY);
    expect(nearestWeekday(MONDAY, 2)).toBe('2026-08-25');
    expect(nearestWeekday(MONDAY, 0)).toBe(SUNDAY);
  });

  it('nearest weekday steps over the month', () => {
    expect(nearestWeekday(SUNDAY, 1)).toBe('2026-08-31');
    expect(nearestWeekday('2026-08-31', 2)).toBe('2026-09-01');
  });
});

describe('quick due-date options', () => {
  it('"weekend" — the nearest Saturday', () => {
    expect(weekendStart(MONDAY)).toBe(SATURDAY);
    expect(weekendStart(FRIDAY)).toBe(SATURDAY);
    expect(weekendStart(SATURDAY)).toBe(SATURDAY);
  });

  it('on Sunday "weekend" is today, not Saturday six days away', () => {
    expect(weekendStart(SUNDAY)).toBe(SUNDAY);
  });

  it('"next week" — Monday STRICTLY after today', () => {
    expect(nextWeekStart(MONDAY)).toBe('2026-08-31');
    expect(nextWeekStart(FRIDAY)).toBe('2026-08-31');
    expect(nextWeekStart(SUNDAY)).toBe('2026-08-31');
  });

  it('every option knows its date', () => {
    expect(scheduleDate('today', MONDAY)).toBe(MONDAY);
    expect(scheduleDate('tomorrow', MONDAY)).toBe('2026-08-25');
    expect(scheduleDate('weekend', MONDAY)).toBe(SATURDAY);
    expect(scheduleDate('nextWeek', MONDAY)).toBe('2026-08-31');
    expect(scheduleDate('clear', MONDAY)).toBeNull();
  });

  it('property: no option schedules a day in the past', () => {
    const ids: ScheduleId[] = ['today', 'tomorrow', 'weekend', 'nextWeek'];
    for (const today of [MONDAY, FRIDAY, SATURDAY, SUNDAY]) {
      for (const id of ids) {
        const date = scheduleDate(id, today);
        expect(date).not.toBeNull();
        // ISO-даты сравниваются лексикографически ровно как хронологически.
        expect((date ?? '') >= today).toBeTruthy();
      }
    }
  });
});

describe('planner options list', () => {
  it('"clear due date" appears only when a due date exists', () => {
    expect(scheduleOptions(MONDAY).map(item => item.id)).not.toContain('clear');
    expect(scheduleOptions(MONDAY, '2026-09-01').map(item => item.id)).toContain('clear');
    expect(scheduleOptions(MONDAY, '').map(item => item.id)).not.toContain('clear');
  });

  it('"weekend" drops out on the weekend itself: the option would lead to today', () => {
    expect(scheduleOptions(MONDAY).map(item => item.id)).toContain('weekend');
    expect(scheduleOptions(SATURDAY).map(item => item.id)).not.toContain('weekend');
    expect(scheduleOptions(SUNDAY).map(item => item.id)).not.toContain('weekend');
  });

  it('label is a calendar date, not the name repeated', () => {
    const [today, tomorrow] = scheduleOptions(MONDAY);
    expect(today?.label).toBe('Сегодня');
    expect(today?.hint).toBe('пн, 24 августа');
    expect(tomorrow?.hint).toBe('вт, 25 августа');
  });

  it('"clear due date" has no date and no label', () => {
    const clear = scheduleOptions(MONDAY, '2026-09-01').find(item => item.id === 'clear');
    expect(clear?.dueAt).toBeNull();
    expect(Object.hasOwn(clear ?? {}, 'hint')).toBeFalsy();
  });
});
