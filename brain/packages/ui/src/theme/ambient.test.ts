import { expect, test } from 'vitest';
import { initAmbient, lightAt } from './ambient';

/**
 * Свет меняется весь день и обязан менять его НЕПРЕРЫВНО: рывок между 11:59 и
 * 12:01 читался бы как сбой отрисовки, а не как полдень.
 */

test('Morning and evening are warm, noon and night are cool', () => {
  // Проверяются СВОЙСТВА, а не литералы: точные градусы подкручиваются при
  // каждой правке палитры, и тест, прибитый к ним, ломался бы на косметике,
  // ничего при этом не защищая.
  const warm = (hue: number): boolean => hue < 90 || hue > 330;
  const cool = (hue: number): boolean => hue > 180 && hue < 300;

  expect(warm(lightAt(7).hue)).toBeTruthy();
  expect(warm(lightAt(19).hue)).toBeTruthy();
  expect(cool(lightAt(13).hue)).toBeTruthy();
  expect(cool(lightAt(0).hue)).toBeTruthy();
});

test('Light stays muted: graphite tolerates no color patch', () => {
  for (let hour = 0; hour < 24; hour++) {
    expect(lightAt(hour).strength).toBeLessThanOrEqual(0.07);
  }
});

test('Between anchor points values are intermediate, not stepped', () => {
  const morning = lightAt(7);
  const noon = lightAt(13);
  const between = lightAt(10);

  expect(between.x).toBeGreaterThan(morning.x);
  expect(between.x).toBeLessThan(noon.x);
});

test('Adjacent minutes produce no discontinuity', () => {
  // Шаг в минуту не должен двигать пятно больше, чем на доли процента.
  for (let hour = 0; hour < 24; hour++) {
    const a = lightAt(hour);
    const b = lightAt(hour + 1 / 60);
    expect(Math.abs(b.x - a.x)).toBeLessThan(2);
    expect(Math.abs(b.strength - a.strength)).toBeLessThan(0.01);
  }
});

test('Crossing midnight goes around the circle, not back through the day', () => {
  const late = lightAt(23.5);
  const early = lightAt(0.5);
  expect(Math.abs(early.strength - late.strength)).toBeLessThan(0.02);
});

test('Hue interpolates along the short path', () => {
  // От 19:00 (25°) к полуночи (285°) короткий путь идёт ЧЕРЕЗ НОЛЬ вниз,
  // а не через 150° — иначе вечер по дороге позеленел бы.
  const evening = lightAt(21);
  expect(evening.hue > 300 || evening.hue < 30).toBeTruthy();
});

test('At night the light is nearly off, by day it is noticeable', () => {
  expect(lightAt(2).strength).toBeLessThan(lightAt(13).strength);
  expect(lightAt(19).strength).toBeGreaterThan(lightAt(2).strength);
});

/**
 * Ветка пробуждения. Тест подставляет минимальный `document` вместо jsdom:
 * весь прогон workspace идёт в окружении `node`, и тянуть браузерный полигон
 * ради трёх строк склейки — дороже, чем сама склейка.
 */
test('Returning to the tab recomputes the light, and stopping removes the subscription', () => {
  const applied: string[] = [];
  const listeners = new Map<string, () => void>();
  const previous = (globalThis as { document?: unknown }).document;

  (globalThis as { document?: unknown }).document = {
    visibilityState: 'visible',
    documentElement: { style: { setProperty: (name: string) => applied.push(name) } },
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  };

  try {
    const stop = initAmbient();
    const atStart = applied.length;
    expect(atStart).toBeGreaterThan(0); // первый проход — синхронный

    listeners.get('visibilitychange')?.();
    expect(applied.length).toBeGreaterThan(atStart);

    stop();
    expect(listeners.has('visibilitychange')).toBeFalsy();
  }
  finally {
    (globalThis as { document?: unknown }).document = previous;
  }
});
