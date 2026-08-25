import { describe, expect, it } from 'vitest';
import { parseQuickEntry } from './quick';

describe(parseQuickEntry, () => {
  it('whole amount and description: "250 кофе"', () => {
    expect(parseQuickEntry('250 кофе')).toEqual({ amount: 25000, note: 'кофе' });
  });

  it('fractional part via comma and via dot is the same', () => {
    expect(parseQuickEntry('1250,50 продукты')).toEqual({ amount: 125050, note: 'продукты' });
    expect(parseQuickEntry('1250.50 продукты')).toEqual({ amount: 125050, note: 'продукты' });
  });

  it('one digit after the separator means tens of kopecks, not units', () => {
    expect(parseQuickEntry('250,5 кофе')?.amount).toBe(25050);
  });

  it('extra digits are rounded, not dropped', () => {
    // 0,567 ₽ — это 57 копеек, и перенос через 100 копеек доходит до рублей.
    expect(parseQuickEntry('10,567 такси')?.amount).toBe(1057);
    expect(parseQuickEntry('1,999 такси')?.amount).toBe(200);
    expect(parseQuickEntry('1,4996 такси')?.amount).toBe(150);
  });

  it('amount only — description is empty, not invented', () => {
    expect(parseQuickEntry('250')).toEqual({ amount: 25000, note: '' });
    expect(parseQuickEntry('1250,50')).toEqual({ amount: 125050, note: '' });
  });

  it('currency sign right after the amount is consumed: it is not a description', () => {
    expect(parseQuickEntry('250₽ кофе')).toEqual({ amount: 25000, note: 'кофе' });
    expect(parseQuickEntry('250 ₽ кофе')).toEqual({ amount: 25000, note: 'кофе' });
    expect(parseQuickEntry('250 руб. кофе')).toEqual({ amount: 25000, note: 'кофе' });
    expect(parseQuickEntry('250 р')).toEqual({ amount: 25000, note: '' });
    // «рублей» — слово, а не знак валюты: описание не режется по началу.
    expect(parseQuickEntry('250 рублей кофе')?.note).toBe('рублей кофе');
  });

  it('description only, no amount — nothing to record', () => {
    expect(parseQuickEntry('кофе')).toBeNull();
    expect(parseQuickEntry('кофе 250')).toBeNull();
  });

  it('extra spaces are trimmed at the edges and collapsed inside', () => {
    expect(parseQuickEntry('   250    кофе   с   молоком  ')).toEqual({
      amount: 25000,
      note: 'кофе с молоком',
    });
    expect(parseQuickEntry('250\t\nкофе')).toEqual({ amount: 25000, note: 'кофе' });
  });

  it('garbage is null, not a zero expense', () => {
    expect(parseQuickEntry('')).toBeNull();
    expect(parseQuickEntry('   ')).toBeNull();
    expect(parseQuickEntry('...')).toBeNull();
    expect(parseQuickEntry('₽₽₽')).toBeNull();
    expect(parseQuickEntry(',50 кофе')).toBeNull();
  });

  it('zero is not recorded: the string "0 кофе" is almost always unfinished typing', () => {
    expect(parseQuickEntry('0')).toBeNull();
    expect(parseQuickEntry('0 кофе')).toBeNull();
    expect(parseQuickEntry('0,00 кофе')).toBeNull();
    // А вот полтинник — законная трата.
    expect(parseQuickEntry('0,50 кофе')?.amount).toBe(50);
  });

  it('minus is not accepted: an expense has no sign, and "-250" is a list marker or a typo', () => {
    expect(parseQuickEntry('-250 кофе')).toBeNull();
    expect(parseQuickEntry('- 250 кофе')).toBeNull();
  });

  it('amount beyond the safe integer is a typo, not money', () => {
    expect(parseQuickEntry('99999999999999999999 дом')).toBeNull();
    // Граница проходит по копейкам, поэтому крупные, но осмысленные суммы живут.
    expect(parseQuickEntry('12000000 машина')?.amount).toBe(1_200_000_000);
  });

  it('space does not separate digit groups: it separates the amount from the description', () => {
    // «1 250 кофе» было бы неотличимо от «1 ₽ на 250 кофе» — грамматика одна.
    expect(parseQuickEntry('1 250 кофе')).toEqual({ amount: 100, note: '250 кофе' });
  });
});
