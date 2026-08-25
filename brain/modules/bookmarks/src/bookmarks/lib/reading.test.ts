import { describe, expect, it } from 'vitest';
import { estimateMinutes, formatMinutes, readingLabel, readingWeight, totalMinutes } from './reading';

/** Неразрывный пробел: число и единица не разрываются переносом строки. */
const NBSP = ' ';

describe(readingWeight, () => {
  it('note weighs twice as much as the title', () => {
    expect(readingWeight({ title: 'раз два три' })).toBe(3);
    expect(readingWeight({ title: 'раз два три', note: 'четыре пять' })).toBe(7);
  });

  it('empty strings add no words', () => {
    expect(readingWeight({ title: '', note: '   ' })).toBe(0);
    expect(readingWeight({ title: 'один' })).toBe(1);
  });

  it('extra spaces and line breaks do not double words', () => {
    expect(readingWeight({ title: '  раз   два \n три ' })).toBe(3);
  });
});

describe(estimateMinutes, () => {
  it('short title without a note — the lowest tier', () => {
    expect(estimateMinutes({ title: 'CRDT без слёз' })).toBe(2);
  });

  it('estimate grows in steps, not continuously: "7 minutes" would promise a measurement', () => {
    expect(estimateMinutes({ title: words(5) })).toBe(5);
    expect(estimateMinutes({ title: words(11) })).toBe(10);
    expect(estimateMinutes({ title: words(21) })).toBe(20);
    expect(estimateMinutes({ title: words(37) })).toBe(30);
  });

  it('tier boundaries include the upper value', () => {
    expect(estimateMinutes({ title: words(4) })).toBe(2);
    expect(estimateMinutes({ title: words(10) })).toBe(5);
    expect(estimateMinutes({ title: words(20) })).toBe(10);
    expect(estimateMinutes({ title: words(36) })).toBe(20);
  });

  it('estimate does not decrease when a note is added', () => {
    const bare = estimateMinutes({ title: words(3) });
    expect(estimateMinutes({ title: words(3), note: words(4) })).toBeGreaterThan(bare);
  });

  it('the longest queue is still bounded from above: we know no better', () => {
    expect(estimateMinutes({ title: words(500), note: words(500) })).toBe(30);
  });
});

describe(totalMinutes, () => {
  it('queue sums the estimates, empty — zero', () => {
    expect(totalMinutes([{ title: words(1) }, { title: words(5) }])).toBe(7);
    expect(totalMinutes([])).toBe(0);
  });
});

describe(formatMinutes, () => {
  it('under an hour prints as minutes', () => {
    expect(formatMinutes(5)).toBe(`5${NBSP}мин`);
    expect(formatMinutes(59)).toBe(`59${NBSP}мин`);
    expect(formatMinutes(0)).toBe(`0${NBSP}мин`);
  });

  it('hours appear only when present: "0 h 5 min" adds nothing', () => {
    expect(formatMinutes(60)).toBe(`1${NBSP}ч`);
    expect(formatMinutes(120)).toBe(`2${NBSP}ч`);
    expect(formatMinutes(75)).toBe(`1${NBSP}ч${NBSP}15${NBSP}мин`);
  });

  it('reading time is never negative', () => {
    expect(formatMinutes(-10)).toBe(`0${NBSP}мин`);
  });
});

describe(readingLabel, () => {
  it('label is marked with a tilde: it is a guess, not a measurement', () => {
    expect(readingLabel({ title: 'CRDT без слёз' })).toBe(`≈${NBSP}2${NBSP}мин`);
  });
});

/** Строка ровно из `count` слов — вес считается по ним, а не по символам. */
function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `с${index}`).join(' ');
}
