import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useToday } from './today';

/**
 * Полночь — единственный момент, ради которого этот композабл существует.
 * Проверяется именно переход: значение до полуночи любой `todayISO()` вернёт
 * верно, а вот через минуту после — уже нет.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('дата переезжает через полночь без перезагрузки', () => {
  vi.setSystemTime(new Date(2026, 7, 24, 23, 58));

  const today = useToday();
  expect(today.value).toBe('2026-08-24');

  // Пять минут — то есть полночь позади, а вкладку никто не трогал.
  vi.advanceTimersByTime(5 * 60_000);
  expect(today.value).toBe('2026-08-25');
});

test('часы одни на приложение', () => {
  // Иначе каждый открытый экран заводил бы свой таймер ради одного числа.
  expect(useToday()).toBe(useToday());
});
