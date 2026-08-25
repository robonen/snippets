import { describe, expect, it } from 'vitest';
import { formatAmount, formatMoney, formatMoneyInput, parseAmount, toKopecks, toRubles } from './money';

/** Разделитель разрядов и отбивка перед ₽ — неразрывные: число не рвётся переносом. */
const NBSP = '\u00A0';

describe(formatMoney, () => {
  it('копейки печатаются рублями с разрядами и знаком валюты', () => {
    expect(formatMoney(125_050)).toBe(`1${NBSP}250,50${NBSP}₽`);
    expect(formatMoney(25_000)).toBe(`250,00${NBSP}₽`);
    expect(formatMoney(0)).toBe(`0,00${NBSP}₽`);
  });

  it('копейки не теряются и не съезжают', () => {
    expect(formatAmount(5)).toBe('0,05');
    expect(formatAmount(50)).toBe('0,50');
    expect(formatAmount(99)).toBe('0,99');
    expect(formatAmount(100)).toBe('1,00');
  });

  it('разряды бьются по три с конца', () => {
    expect(formatAmount(100_000)).toBe(`1${NBSP}000,00`);
    expect(formatAmount(100_000_000)).toBe(`1${NBSP}000${NBSP}000,00`);
    expect(formatAmount(99_999)).toBe('999,99');
  });

  it('минус остаётся перед числом, а не перед разрядом', () => {
    expect(formatAmount(-125_050)).toBe(`-1${NBSP}250,50`);
  });

  it('сумма целых копеек складывается точно — ради этого они и целые', () => {
    // Те же 10,10 + 20,20 в рублях дали бы 30,299999999999997.
    const kopecks = [1010, 2020, 3030].reduce((sum, item) => sum + item, 0);
    expect(formatMoney(kopecks)).toBe(`60,60${NBSP}₽`);
  });
});

describe(formatMoneyInput, () => {
  it('значение для поля ввода — без группировки и без хвоста «,00»', () => {
    expect(formatMoneyInput(125_050)).toBe('1250,50');
    expect(formatMoneyInput(25_000)).toBe('250');
    expect(formatMoneyInput(5)).toBe('0,05');
  });

  it('напечатанное поле разбирается обратно в те же копейки', () => {
    for (const kopecks of [0, 5, 50, 99, 25_000, 125_050, 100_000_000]) {
      expect(parseAmount(formatMoneyInput(kopecks))).toBe(kopecks);
    }
  });
});

describe(toKopecks, () => {
  it('рубли числом переводятся в целые копейки без хвостов double', () => {
    // 1250.5 * 100 в double — это 125050.00000000001, и без округления запись
    // упёрлась бы в целочисленный канал.
    expect(toKopecks(1250.5)).toBe(125_050);
    expect(toKopecks(0.07)).toBe(7);
    expect(toKopecks(250)).toBe(25_000);
    expect(toKopecks(0)).toBe(0);
  });

  it('копейки переживают круг туда-обратно', () => {
    for (const kopecks of [0, 5, 50, 99, 25_000, 125_050, 100_000_000]) {
      expect(toKopecks(toRubles(kopecks))).toBe(kopecks);
    }
  });

  it('пустое поле — это не ноль', () => {
    expect(toKopecks(null)).toBeNull();
  });

  it('нечисло и сумма за пределом безопасного целого — не деньги', () => {
    expect(toKopecks(Number.NaN)).toBeNull();
    expect(toKopecks(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toKopecks(1e18)).toBeNull();
  });
});

describe(parseAmount, () => {
  it('строка целиком обязана быть суммой', () => {
    expect(parseAmount('1250,50')).toBe(125_050);
    expect(parseAmount('  250  ')).toBe(25_000);
    expect(parseAmount('0')).toBe(0);
  });

  it('хвост после числа — не сумма: молча потерять «кофе» хуже, чем показать ошибку', () => {
    expect(parseAmount('250 кофе')).toBeNull();
    expect(parseAmount('250 ₽')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('кофе')).toBeNull();
    expect(parseAmount('-250')).toBeNull();
  });
});
