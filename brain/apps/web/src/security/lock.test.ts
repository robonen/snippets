import { expect, test } from 'vitest';
import { lockedByAway } from './lock';

/**
 * Замок после отлучки. Проверяется именно решение, а не проводка к событию
 * `visibilitychange`: решение — это и есть требование безопасности, а проводка
 * в компоненте — три строки, которые видно глазом.
 */

const IDLE = 15 * 60 * 1000;

test('tab in background longer than the timeout — lock', () => {
  const hiddenAt = 1_000_000;
  expect(lockedByAway(hiddenAt, hiddenAt + IDLE + 1, IDLE)).toBeTruthy();
});

test('a short absence does not touch the lock', () => {
  const hiddenAt = 1_000_000;
  // Ровно таймаут — ещё не «дольше»: граница отдана пользователю, иначе
  // приложение запиралось бы в секунду, когда он уже тянется к клавиатуре.
  expect(lockedByAway(hiddenAt, hiddenAt + IDLE, IDLE)).toBeFalsy();
  expect(lockedByAway(hiddenAt, hiddenAt + 60_000, IDLE)).toBeFalsy();
});

test('tab was never hidden — nothing to lock', () => {
  // Иначе первое же переключение окна на свежей вкладке захлопывало бы замок:
  // ноль как «давным-давно» дал бы разницу в полвека.
  expect(lockedByAway(0, Date.now(), IDLE)).toBeFalsy();
});

test('machine sleep does not cancel the absence', () => {
  // Ровно случай, ради которого правило считает часы, а не тики таймера:
  // ноутбук закрыли на восемь часов, таймеры всё это время стояли.
  const hiddenAt = 1_000_000;
  expect(lockedByAway(hiddenAt, hiddenAt + 8 * 60 * 60 * 1000, IDLE)).toBeTruthy();
});
