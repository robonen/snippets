import { describe, expect, it } from 'vitest';
import { differenceInCalendarDays, getDate, getDay, isLastDayOfMonth } from 'date-fns';
import { parseISODate, shiftISODate } from '@brain/std';
import { REPEAT_UNITS, nextAfter, nextOccurrence, normalizeRepeat, repeatLabel } from './repeat';
import type { RepeatRule, RepeatUnit } from './repeat';

function rule(unit: RepeatUnit, every: number, enabled = true): RepeatRule {
  return { unit, every, enabled };
}

/**
 * Детерминированный генератор: свойство, которое падает раз в сто прогонов, —
 * это не тест, а лотерея. Сид фиксирован, значит падение воспроизводится.
 */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const EPOCH = '2019-12-31';
const SAMPLES = 400;

/** Случайный день в пределах примерно десяти лет от `EPOCH`. */
function sampleDate(random: () => number): string {
  return shiftISODate(EPOCH, Math.floor(random() * 3700));
}

function sampleRule(random: () => number): RepeatRule {
  const unit = REPEAT_UNITS[Math.floor(random() * REPEAT_UNITS.length)] ?? 'day';
  return rule(unit, 1 + Math.floor(random() * 12));
}

describe('следующее вхождение повтора', () => {
  it('шагает днями, неделями и месяцами', () => {
    expect(nextOccurrence(rule('day', 1), '2026-08-24')).toBe('2026-08-25');
    expect(nextOccurrence(rule('week', 1), '2026-08-24')).toBe('2026-08-31');
    expect(nextOccurrence(rule('month', 1), '2026-08-24')).toBe('2026-09-24');
    expect(nextOccurrence(rule('day', 3), '2026-08-24')).toBe('2026-08-27');
    expect(nextOccurrence(rule('week', 2), '2026-08-24')).toBe('2026-09-07');
    expect(nextOccurrence(rule('month', 6), '2026-08-24')).toBe('2027-02-24');
  });

  it('выключенное правило и отсутствие правила не дают вхождения', () => {
    expect(nextOccurrence(rule('day', 1, false), '2026-08-24')).toBeNull();
    expect(nextOccurrence(undefined, '2026-08-24')).toBeNull();
  });

  it('шагом может быть только целое ≥ 1', () => {
    expect(nextOccurrence(rule('day', 0), '2026-08-24')).toBeNull();
    expect(nextOccurrence(rule('day', -3), '2026-08-24')).toBeNull();
    expect(nextOccurrence(rule('day', 1.5), '2026-08-24')).toBeNull();
    expect(nextOccurrence(rule('day', Number.NaN), '2026-08-24')).toBeNull();
    expect(nextOccurrence(rule('month', Number.POSITIVE_INFINITY), '2026-08-24')).toBeNull();
  });

  it('дата обязана быть днём формата YYYY-MM-DD', () => {
    expect(nextOccurrence(rule('day', 1), '2026-8-24')).toBeNull();
    expect(nextOccurrence(rule('day', 1), '2026-08')).toBeNull();
    expect(nextOccurrence(rule('day', 1), '24.08.2026')).toBeNull();
    expect(nextOccurrence(rule('day', 1), '')).toBeNull();
    expect(nextOccurrence(rule('day', 1), 'завтра')).toBeNull();
    // Разбор формата мало: 30 февраля проходит регулярку и не существует.
    expect(nextOccurrence(rule('day', 1), '2026-02-30')).toBeNull();
  });

  it('конец месяца прижимается к последнему дню, а не перепрыгивает вперёд', () => {
    expect(nextOccurrence(rule('month', 1), '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence(rule('month', 1), '2026-03-31')).toBe('2026-04-30');
    expect(nextOccurrence(rule('month', 1), '2026-05-31')).toBe('2026-06-30');
    // Через месяц, минуя февраль, 31-е остаётся 31-м: прижатие считается от
    // исходной даты, а не накапливается внутри одного вызова.
    expect(nextOccurrence(rule('month', 2), '2026-01-31')).toBe('2026-03-31');
  });

  it('прижатие ЛИПКОЕ: следующий шаг считается уже от прижатой даты', () => {
    const clamped = nextOccurrence(rule('month', 1), '2026-01-31');
    expect(clamped).toBe('2026-02-28');
    expect(nextOccurrence(rule('month', 1), clamped ?? '')).toBe('2026-03-28');
  });

  it('високосный год виден и в днях, и в месяцах', () => {
    expect(nextOccurrence(rule('day', 1), '2024-02-28')).toBe('2024-02-29');
    expect(nextOccurrence(rule('day', 1), '2026-02-28')).toBe('2026-03-01');
    expect(nextOccurrence(rule('month', 1), '2024-01-31')).toBe('2024-02-29');
    expect(nextOccurrence(rule('month', 12), '2024-02-29')).toBe('2025-02-28');
    expect(nextOccurrence(rule('month', 48), '2024-02-29')).toBe('2028-02-29');
  });

  it('перевод через год и через границу месяца', () => {
    expect(nextOccurrence(rule('day', 1), '2026-12-31')).toBe('2027-01-01');
    expect(nextOccurrence(rule('day', 3), '2026-12-30')).toBe('2027-01-02');
    expect(nextOccurrence(rule('week', 1), '2026-12-28')).toBe('2027-01-04');
    expect(nextOccurrence(rule('month', 5), '2026-08-31')).toBe('2027-01-31');
  });

  it('свойство: вхождение всегда строго позже исходного дня', () => {
    const random = lcg(20_260_824);
    for (let i = 0; i < SAMPLES; i++) {
      const from = sampleDate(random);
      const next = nextOccurrence(sampleRule(random), from);
      expect(next).not.toBeNull();
      expect(next! > from).toBeTruthy();
    }
  });

  it('свойство: дневной шаг — ровно N календарных дней', () => {
    const random = lcg(7);
    for (let i = 0; i < SAMPLES; i++) {
      const from = sampleDate(random);
      const every = 1 + Math.floor(random() * 90);
      const next = nextOccurrence(rule('day', every), from);
      expect(differenceInCalendarDays(parseISODate(next!), parseISODate(from))).toBe(every);
    }
  });

  it('свойство: недельный шаг сохраняет день недели', () => {
    const random = lcg(13);
    for (let i = 0; i < SAMPLES; i++) {
      const from = sampleDate(random);
      const every = 1 + Math.floor(random() * 8);
      const next = nextOccurrence(rule('week', every), from);
      expect(differenceInCalendarDays(parseISODate(next!), parseISODate(from))).toBe(every * 7);
      expect(getDay(parseISODate(next!))).toBe(getDay(parseISODate(from)));
    }
  });

  it('свойство: месячный шаг сохраняет число месяца или прижимается к последнему дню', () => {
    const random = lcg(29);
    for (let i = 0; i < SAMPLES; i++) {
      const from = sampleDate(random);
      const next = parseISODate(nextOccurrence(rule('month', 1 + Math.floor(random() * 24)), from)!);
      const start = parseISODate(from);
      // Либо то же число месяца, либо короткий месяц — и тогда его последний день.
      const kept = getDate(next) === getDate(start);
      const clamped = getDate(next) < getDate(start) && isLastDayOfMonth(next);
      expect(kept || clamped).toBeTruthy();
    }
  });

  it('свойство: порядок дат сохраняется — более поздний день не даёт более раннего вхождения', () => {
    const random = lcg(101);
    for (let i = 0; i < SAMPLES; i++) {
      const first = sampleDate(random);
      const second = shiftISODate(first, Math.floor(random() * 400));
      const step = sampleRule(random);
      expect(nextOccurrence(step, second)! >= nextOccurrence(step, first)!).toBeTruthy();
    }
  });

  it('свойство: N дневных шагов подряд — это N дней', () => {
    const random = lcg(999);
    const daily = rule('day', 1);
    for (let i = 0; i < 40; i++) {
      const from = sampleDate(random);
      const steps = 1 + Math.floor(random() * 40);
      let walk = from;
      for (let step = 0; step < steps; step++) walk = nextOccurrence(daily, walk)!;
      expect(walk).toBe(shiftISODate(from, steps));
    }
  });
});

describe('догонялки просроченного повтора', () => {
  it('возвращает первый день строго после указанного', () => {
    expect(nextAfter(rule('day', 1), '2026-08-24', '2026-08-24')).toBe('2026-08-25');
    expect(nextAfter(rule('week', 1), '2026-08-24', '2026-08-24')).toBe('2026-08-31');
  });

  it('ежедневная задача, забытая на неделю, догоняет за один раз', () => {
    expect(nextAfter(rule('day', 1), '2026-08-17', '2026-08-24')).toBe('2026-08-25');
  });

  it('ритм числа месяца переживает опоздание', () => {
    // Платить 5-го: выполнено 7 марта, следующее — 5 апреля, а не 7-го.
    expect(nextAfter(rule('month', 1), '2026-01-05', '2026-03-07')).toBe('2026-04-05');
  });

  it('без правила догонять нечего', () => {
    expect(nextAfter(undefined, '2026-08-24', '2026-08-24')).toBeNull();
    expect(nextAfter(rule('day', 1, false), '2026-08-17', '2026-08-24')).toBeNull();
  });

  it('отставание больше предела считается от дня выполнения, а не крутит цикл', () => {
    // Двадцать шесть лет ежедневного повтора — далеко за CATCH_UP_LIMIT.
    expect(nextAfter(rule('day', 1), '2000-01-01', '2026-08-24')).toBe('2026-08-25');
  });

  it('свойство: результат всегда позже дня выполнения', () => {
    const random = lcg(4242);
    for (let i = 0; i < SAMPLES; i++) {
      const from = sampleDate(random);
      const after = shiftISODate(from, Math.floor(random() * 500));
      expect(nextAfter(sampleRule(random), from, after)! > after).toBeTruthy();
    }
  });
});

describe('нормализация и подпись правила', () => {
  it('оставляет целый положительный шаг и отбрасывает остальное', () => {
    expect(normalizeRepeat(rule('week', 2))).toEqual({ unit: 'week', every: 2, enabled: true });
    expect(normalizeRepeat(rule('day', 3.7))).toEqual({ unit: 'day', every: 3, enabled: true });
    expect(normalizeRepeat(rule('day', 0))).toBeUndefined();
    expect(normalizeRepeat(rule('day', -1))).toBeUndefined();
    expect(normalizeRepeat(rule('day', Number.NaN))).toBeUndefined();
    expect(normalizeRepeat(undefined)).toBeUndefined();
  });

  it('выключенное правило переживает нормализацию: настройка ждёт, а не стирается', () => {
    expect(normalizeRepeat(rule('month', 2, false))).toEqual({ unit: 'month', every: 2, enabled: false });
  });

  it('подпись склоняет числительные', () => {
    expect(repeatLabel(rule('day', 1))).toBe('каждый день');
    expect(repeatLabel(rule('week', 1))).toBe('каждую неделю');
    expect(repeatLabel(rule('month', 1))).toBe('каждый месяц');
    expect(repeatLabel(rule('day', 2))).toBe('каждые 2 дня');
    expect(repeatLabel(rule('day', 5))).toBe('каждые 5 дней');
    expect(repeatLabel(rule('week', 3))).toBe('каждые 3 недели');
    expect(repeatLabel(rule('month', 11))).toBe('каждые 11 месяцев');
  });
});
