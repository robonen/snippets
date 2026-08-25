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

describe('дни недели', () => {
  it('считаются как у Date: воскресенье — ноль', () => {
    expect(weekdayOf(MONDAY)).toBe(1);
    expect(weekdayOf(SATURDAY)).toBe(6);
    expect(weekdayOf(SUNDAY)).toBe(0);
  });

  it('ближайший день недели включает сегодняшний', () => {
    expect(nearestWeekday(MONDAY, 1)).toBe(MONDAY);
    expect(nearestWeekday(MONDAY, 2)).toBe('2026-08-25');
    expect(nearestWeekday(MONDAY, 0)).toBe(SUNDAY);
  });

  it('ближайший день недели перешагивает месяц', () => {
    expect(nearestWeekday(SUNDAY, 1)).toBe('2026-08-31');
    expect(nearestWeekday('2026-08-31', 2)).toBe('2026-09-01');
  });
});

describe('быстрые варианты срока', () => {
  it('«выходные» — ближайшая суббота', () => {
    expect(weekendStart(MONDAY)).toBe(SATURDAY);
    expect(weekendStart(FRIDAY)).toBe(SATURDAY);
    expect(weekendStart(SATURDAY)).toBe(SATURDAY);
  });

  it('в воскресенье «выходные» — сегодня, а не суббота через шесть дней', () => {
    expect(weekendStart(SUNDAY)).toBe(SUNDAY);
  });

  it('«следующая неделя» — понедельник СТРОГО после сегодня', () => {
    expect(nextWeekStart(MONDAY)).toBe('2026-08-31');
    expect(nextWeekStart(FRIDAY)).toBe('2026-08-31');
    expect(nextWeekStart(SUNDAY)).toBe('2026-08-31');
  });

  it('каждый вариант знает свою дату', () => {
    expect(scheduleDate('today', MONDAY)).toBe(MONDAY);
    expect(scheduleDate('tomorrow', MONDAY)).toBe('2026-08-25');
    expect(scheduleDate('weekend', MONDAY)).toBe(SATURDAY);
    expect(scheduleDate('nextWeek', MONDAY)).toBe('2026-08-31');
    expect(scheduleDate('clear', MONDAY)).toBeNull();
  });

  it('свойство: ни один вариант не назначает день в прошлом', () => {
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

describe('список вариантов для планировщика', () => {
  it('«убрать срок» появляется, только когда срок есть', () => {
    expect(scheduleOptions(MONDAY).map(item => item.id)).not.toContain('clear');
    expect(scheduleOptions(MONDAY, '2026-09-01').map(item => item.id)).toContain('clear');
    expect(scheduleOptions(MONDAY, '').map(item => item.id)).not.toContain('clear');
  });

  it('«выходные» отпадают в сами выходные: вариант вёл бы в сегодня', () => {
    expect(scheduleOptions(MONDAY).map(item => item.id)).toContain('weekend');
    expect(scheduleOptions(SATURDAY).map(item => item.id)).not.toContain('weekend');
    expect(scheduleOptions(SUNDAY).map(item => item.id)).not.toContain('weekend');
  });

  it('подпись — календарная дата, а не повтор названия', () => {
    const [today, tomorrow] = scheduleOptions(MONDAY);
    expect(today?.label).toBe('Сегодня');
    expect(today?.hint).toBe('пн, 24 августа');
    expect(tomorrow?.hint).toBe('вт, 25 августа');
  });

  it('у «убрать срок» даты и подписи нет', () => {
    const clear = scheduleOptions(MONDAY, '2026-09-01').find(item => item.id === 'clear');
    expect(clear?.dueAt).toBeNull();
    expect(Object.hasOwn(clear ?? {}, 'hint')).toBeFalsy();
  });
});
