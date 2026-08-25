import { describe, expect, it } from 'vitest';
import { parseQuickEntry } from './quick';

describe(parseQuickEntry, () => {
  it('целая сумма и описание: «250 кофе»', () => {
    expect(parseQuickEntry('250 кофе')).toEqual({ amount: 25000, note: 'кофе' });
  });

  it('дробная часть через запятую и через точку — одно и то же', () => {
    expect(parseQuickEntry('1250,50 продукты')).toEqual({ amount: 125050, note: 'продукты' });
    expect(parseQuickEntry('1250.50 продукты')).toEqual({ amount: 125050, note: 'продукты' });
  });

  it('один знак после разделителя — это десятки копеек, а не единицы', () => {
    expect(parseQuickEntry('250,5 кофе')?.amount).toBe(25050);
  });

  it('лишние знаки округляются, а не отбрасываются', () => {
    // 0,567 ₽ — это 57 копеек, и перенос через 100 копеек доходит до рублей.
    expect(parseQuickEntry('10,567 такси')?.amount).toBe(1057);
    expect(parseQuickEntry('1,999 такси')?.amount).toBe(200);
    expect(parseQuickEntry('1,4996 такси')?.amount).toBe(150);
  });

  it('только сумма — описание пустое, а не выдуманное', () => {
    expect(parseQuickEntry('250')).toEqual({ amount: 25000, note: '' });
    expect(parseQuickEntry('1250,50')).toEqual({ amount: 125050, note: '' });
  });

  it('знак валюты сразу за суммой съедается: он не описание', () => {
    expect(parseQuickEntry('250₽ кофе')).toEqual({ amount: 25000, note: 'кофе' });
    expect(parseQuickEntry('250 ₽ кофе')).toEqual({ amount: 25000, note: 'кофе' });
    expect(parseQuickEntry('250 руб. кофе')).toEqual({ amount: 25000, note: 'кофе' });
    expect(parseQuickEntry('250 р')).toEqual({ amount: 25000, note: '' });
    // «рублей» — слово, а не знак валюты: описание не режется по началу.
    expect(parseQuickEntry('250 рублей кофе')?.note).toBe('рублей кофе');
  });

  it('только описание без суммы — записывать нечего', () => {
    expect(parseQuickEntry('кофе')).toBeNull();
    expect(parseQuickEntry('кофе 250')).toBeNull();
  });

  it('лишние пробелы срезаются по краям и схлопываются внутри', () => {
    expect(parseQuickEntry('   250    кофе   с   молоком  ')).toEqual({
      amount: 25000,
      note: 'кофе с молоком',
    });
    expect(parseQuickEntry('250\t\nкофе')).toEqual({ amount: 25000, note: 'кофе' });
  });

  it('мусор — это null, а не трата на ноль', () => {
    expect(parseQuickEntry('')).toBeNull();
    expect(parseQuickEntry('   ')).toBeNull();
    expect(parseQuickEntry('...')).toBeNull();
    expect(parseQuickEntry('₽₽₽')).toBeNull();
    expect(parseQuickEntry(',50 кофе')).toBeNull();
  });

  it('ноль не записывается: строка «0 кофе» почти всегда недонабрана', () => {
    expect(parseQuickEntry('0')).toBeNull();
    expect(parseQuickEntry('0 кофе')).toBeNull();
    expect(parseQuickEntry('0,00 кофе')).toBeNull();
    // А вот полтинник — законная трата.
    expect(parseQuickEntry('0,50 кофе')?.amount).toBe(50);
  });

  it('минус не принимается: у траты нет знака, а «-250» — маркер списка или опечатка', () => {
    expect(parseQuickEntry('-250 кофе')).toBeNull();
    expect(parseQuickEntry('- 250 кофе')).toBeNull();
  });

  it('сумма за пределами безопасного целого — опечатка, а не деньги', () => {
    expect(parseQuickEntry('99999999999999999999 дом')).toBeNull();
    // Граница проходит по копейкам, поэтому крупные, но осмысленные суммы живут.
    expect(parseQuickEntry('12000000 машина')?.amount).toBe(1_200_000_000);
  });

  it('пробел не разделяет разряды: он отделяет сумму от описания', () => {
    // «1 250 кофе» было бы неотличимо от «1 ₽ на 250 кофе» — грамматика одна.
    expect(parseQuickEntry('1 250 кофе')).toEqual({ amount: 100, note: '250 кофе' });
  });
});
