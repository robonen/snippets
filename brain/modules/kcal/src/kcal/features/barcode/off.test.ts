import { describe, expect, it } from 'vitest';
import { digitsOnly, draftFromOff, isBarcode, normalizeOffProduct } from './off';

// Фикстуры — реальные ответы API от 2026-08-07 (curl, поля обрезаны до запрошенных).

describe(normalizeOffProduct, () => {
  it('barcode-API: Coca-Cola 5449000000996', () => {
    const product = normalizeOffProduct({
      code: '5449000000996',
      brands: 'Coca-Cola',
      product_name: 'coca-cola',
      product_name_ru: 'Coca Cola',
      serving_quantity: 330,
      nutriments: {
        'energy-kcal_100g': 42,
        energy_100g: 180,
        carbohydrates_100g: 10.6,
        fat_100g: 0,
      },
    });
    expect(product).toEqual({
      code: '5449000000996',
      name: 'Coca Cola',
      brand: 'Coca-Cola',
      kcal: 42,
      protein: 0,
      fat: 0,
      carbs: 10.6,
      servingGrams: 330,
    });
  });

  it('brands-массив и строковые числа', () => {
    const product = normalizeOffProduct({
      code: '5900951310935',
      brands: ['Snickers'],
      product_name_ru: 'Сникерс Тройной',
      nutriments: { 'energy-kcal_100g': '435', proteins_100g: '0', fat_100g: 20.4, carbohydrates_100g: 53.3 },
    });
    expect(product?.brand).toBe('Snickers');
    expect(product?.kcal).toBe(435);
    expect(product?.fat).toBe(20.4);
  });

  it('без kcal, но с кДж — пересчитывает', () => {
    const product = normalizeOffProduct({
      code: '123',
      product_name: 'Test',
      nutriments: { energy_100g: 180 },
    });
    expect(product?.kcal).toBe(43); // 180 кДж / 4.184
  });

  it('запись без калорийности отбрасывается', () => {
    expect(normalizeOffProduct({ code: '1', product_name: 'X', nutriments: {} })).toBeNull();
  });

  it('запись без имени отбрасывается', () => {
    expect(normalizeOffProduct({ code: '1', nutriments: { 'energy-kcal_100g': 100 } })).toBeNull();
  });

  it('нереалистичный вес порции не попадает в servingGrams', () => {
    const product = normalizeOffProduct({
      code: '1',
      product_name: 'X',
      serving_quantity: 5000,
      nutriments: { 'energy-kcal_100g': 100 },
    });
    expect(product?.servingGrams).toBeUndefined();
  });

  it('пустое русское имя пропускает вперёд общее', () => {
    const product = normalizeOffProduct({
      code: '1',
      product_name: 'Oat milk',
      product_name_ru: '   ',
      nutriments: { 'energy-kcal_100g': 45 },
    });
    expect(product?.name).toBe('Oat milk');
  });
});

describe('цифры штрихкода', () => {
  it('оставляет только цифры: с упаковки их набирают с пробелами', () => {
    expect(digitsOnly('5449 0000 00996')).toBe('5449000000996');
  });

  it('длина EAN/UPC: от восьми до четырнадцати цифр', () => {
    expect(isBarcode('54490000')).toBeTruthy();
    expect(isBarcode('5449000000996')).toBeTruthy();
    expect(isBarcode('5449')).toBeFalsy();
    expect(isBarcode('544900000099612345')).toBeFalsy();
    expect(isBarcode('')).toBeFalsy();
  });
});

describe(draftFromOff, () => {
  const product = { code: '1', name: 'Сникерс Тройной', brand: 'Snickers', kcal: 435, protein: 8, fat: 20.4, carbs: 53.3 };

  it('бренд дописывается к имени и штрихкод остаётся в карточке', () => {
    expect(draftFromOff({ ...product, servingGrams: 50 })).toEqual({
      name: 'Сникерс Тройной (Snickers)',
      category: 'Упакованное',
      kcal: 435,
      protein: 8,
      fat: 20.4,
      carbs: 53.3,
      barcode: '1',
      pieceGrams: 50,
    });
  });

  it('бренд уже в имени — второй раз не дописывается', () => {
    expect(draftFromOff({ ...product, name: 'Snickers Тройной' }).name).toBe('Snickers Тройной');
  });

  it('вес порции с этикетки не указан — вес штуки не выдумываем', () => {
    expect(Object.hasOwn(draftFromOff(product), 'pieceGrams')).toBeFalsy();
  });
});
