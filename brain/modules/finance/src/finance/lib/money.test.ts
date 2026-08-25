import { describe, expect, it } from 'vitest';
import { formatAmount, formatMoney, formatMoneyInput, parseAmount, toKopecks, toRubles } from './money';

/** Разделитель разрядов и отбивка перед ₽ — неразрывные: число не рвётся переносом. */
const NBSP = '\u00A0';

describe(formatMoney, () => {
  it('kopecks print as rubles with digit groups and a currency sign', () => {
    expect(formatMoney(125_050)).toBe(`1${NBSP}250,50${NBSP}₽`);
    expect(formatMoney(25_000)).toBe(`250,00${NBSP}₽`);
    expect(formatMoney(0)).toBe(`0,00${NBSP}₽`);
  });

  it('kopecks are not lost and do not shift', () => {
    expect(formatAmount(5)).toBe('0,05');
    expect(formatAmount(50)).toBe('0,50');
    expect(formatAmount(99)).toBe('0,99');
    expect(formatAmount(100)).toBe('1,00');
  });

  it('digits group in threes from the end', () => {
    expect(formatAmount(100_000)).toBe(`1${NBSP}000,00`);
    expect(formatAmount(100_000_000)).toBe(`1${NBSP}000${NBSP}000,00`);
    expect(formatAmount(99_999)).toBe('999,99');
  });

  it('minus stays before the number, not before a digit group', () => {
    expect(formatAmount(-125_050)).toBe(`-1${NBSP}250,50`);
  });

  it('whole kopecks sum exactly — that is why they are whole', () => {
    // Те же 10,10 + 20,20 в рублях дали бы 30,299999999999997.
    const kopecks = [1010, 2020, 3030].reduce((sum, item) => sum + item, 0);
    expect(formatMoney(kopecks)).toBe(`60,60${NBSP}₽`);
  });
});

describe(formatMoneyInput, () => {
  it('input-field value — without grouping and without the ",00" tail', () => {
    expect(formatMoneyInput(125_050)).toBe('1250,50');
    expect(formatMoneyInput(25_000)).toBe('250');
    expect(formatMoneyInput(5)).toBe('0,05');
  });

  it('printed field parses back into the same kopecks', () => {
    for (const kopecks of [0, 5, 50, 99, 25_000, 125_050, 100_000_000]) {
      expect(parseAmount(formatMoneyInput(kopecks))).toBe(kopecks);
    }
  });
});

describe(toKopecks, () => {
  it('rubles as a number convert to whole kopecks without double tails', () => {
    // 1250.5 * 100 в double — это 125050.00000000001, и без округления запись
    // упёрлась бы в целочисленный канал.
    expect(toKopecks(1250.5)).toBe(125_050);
    expect(toKopecks(0.07)).toBe(7);
    expect(toKopecks(250)).toBe(25_000);
    expect(toKopecks(0)).toBe(0);
  });

  it('kopecks survive the round-trip', () => {
    for (const kopecks of [0, 5, 50, 99, 25_000, 125_050, 100_000_000]) {
      expect(toKopecks(toRubles(kopecks))).toBe(kopecks);
    }
  });

  it('empty field is not zero', () => {
    expect(toKopecks(null)).toBeNull();
  });

  it('non-number and an amount beyond the safe integer are not money', () => {
    expect(toKopecks(Number.NaN)).toBeNull();
    expect(toKopecks(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toKopecks(1e18)).toBeNull();
  });
});

describe(parseAmount, () => {
  it('the whole string must be an amount', () => {
    expect(parseAmount('1250,50')).toBe(125_050);
    expect(parseAmount('  250  ')).toBe(25_000);
    expect(parseAmount('0')).toBe(0);
  });

  it('tail after the number is not an amount: silently losing "кофе" is worse than showing an error', () => {
    expect(parseAmount('250 кофе')).toBeNull();
    expect(parseAmount('250 ₽')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('кофе')).toBeNull();
    expect(parseAmount('-250')).toBeNull();
  });
});
