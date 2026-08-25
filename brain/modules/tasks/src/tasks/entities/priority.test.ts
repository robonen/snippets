import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRIORITY,
  PRIORITIES,
  PRIORITY_LABELS,
  comparePriority,
  isNotable,
  isPriority,
  priorityRank,
  priorityTone,
} from './priority';
import type { Priority } from './priority';

describe('ступени приоритета', () => {
  it('у каждой ступени есть подпись и тон', () => {
    for (const priority of PRIORITIES) {
      expect(PRIORITY_LABELS[priority]).not.toBe('');
      expect(priorityTone(priority)).not.toBe('');
    }
  });

  it('распознаются только известные ступени', () => {
    expect(isPriority('urgent')).toBeTruthy();
    expect(isPriority('normal')).toBeTruthy();
    expect(isPriority('высокий')).toBeFalsy();
    expect(isPriority('')).toBeFalsy();
    // Имя из прототипа объекта ступенью не является.
    expect(isPriority('toString')).toBeFalsy();
  });
});

describe('сравнение приоритетов', () => {
  it('срочное выше высокого, высокое — обычного, обычное — низкого', () => {
    expect(comparePriority('urgent', 'high')).toBeLessThan(0);
    expect(comparePriority('high', 'normal')).toBeLessThan(0);
    expect(comparePriority('normal', 'low')).toBeLessThan(0);
  });

  it('отсутствие приоритета равно «обычному»', () => {
    expect(comparePriority(undefined, DEFAULT_PRIORITY)).toBe(0);
    expect(priorityRank(undefined)).toBe(priorityRank(DEFAULT_PRIORITY));
    expect(comparePriority(undefined, 'low')).toBeLessThan(0);
    expect(comparePriority(undefined, 'high')).toBeGreaterThan(0);
  });

  it('свойство: сравнение антисимметрично и транзитивно', () => {
    for (const a of PRIORITIES) {
      for (const b of PRIORITIES) {
        // `+ 0` убирает минус-ноль: `-Math.sign(0)` — это `-0`, и `Object.is`
        // считает его отличным от нуля, хотя сравнение вернуло «равны».
        expect(Math.sign(comparePriority(a, b))).toBe(-Math.sign(comparePriority(b, a)) + 0);
      }
    }
    const sorted: Priority[] = [...PRIORITIES].sort(comparePriority);
    expect(sorted).toEqual(['urgent', 'high', 'normal', 'low']);
  });
});

describe('метка приоритета', () => {
  it('«обычный» молчит: иначе метка на каждой строке перестаёт быть меткой', () => {
    expect(isNotable(undefined)).toBeFalsy();
    expect(isNotable('normal')).toBeFalsy();
    expect(isNotable('low')).toBeTruthy();
    expect(isNotable('urgent')).toBeTruthy();
  });

  it('тон — роль, а не цвет', () => {
    expect(priorityTone('urgent')).toBe('danger');
    expect(priorityTone('high')).toBe('warning');
    expect(priorityTone(undefined)).toBe('neutral');
  });
});
