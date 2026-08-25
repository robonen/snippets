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

describe('priority tiers', () => {
  it('every tier has a label and a tone', () => {
    for (const priority of PRIORITIES) {
      expect(PRIORITY_LABELS[priority]).not.toBe('');
      expect(priorityTone(priority)).not.toBe('');
    }
  });

  it('only known tiers are recognized', () => {
    expect(isPriority('urgent')).toBeTruthy();
    expect(isPriority('normal')).toBeTruthy();
    expect(isPriority('высокий')).toBeFalsy();
    expect(isPriority('')).toBeFalsy();
    // Имя из прототипа объекта ступенью не является.
    expect(isPriority('toString')).toBeFalsy();
  });
});

describe('priority comparison', () => {
  it('urgent above high, high above normal, normal above low', () => {
    expect(comparePriority('urgent', 'high')).toBeLessThan(0);
    expect(comparePriority('high', 'normal')).toBeLessThan(0);
    expect(comparePriority('normal', 'low')).toBeLessThan(0);
  });

  it('missing priority equals "normal"', () => {
    expect(comparePriority(undefined, DEFAULT_PRIORITY)).toBe(0);
    expect(priorityRank(undefined)).toBe(priorityRank(DEFAULT_PRIORITY));
    expect(comparePriority(undefined, 'low')).toBeLessThan(0);
    expect(comparePriority(undefined, 'high')).toBeGreaterThan(0);
  });

  it('property: comparison is antisymmetric and transitive', () => {
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

describe('priority badge', () => {
  it('"normal" stays silent: otherwise a badge on every row stops being a badge', () => {
    expect(isNotable(undefined)).toBeFalsy();
    expect(isNotable('normal')).toBeFalsy();
    expect(isNotable('low')).toBeTruthy();
    expect(isNotable('urgent')).toBeTruthy();
  });

  it('tone is a role, not a color', () => {
    expect(priorityTone('urgent')).toBe('danger');
    expect(priorityTone('high')).toBe('warning');
    expect(priorityTone(undefined)).toBe('neutral');
  });
});
