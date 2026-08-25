import { effectScope } from 'vue';
import { expect, test } from 'vitest';
import { useTheme } from './theme';

/**
 * Тема одна на приложение, и её подписки НЕ должны принадлежать тому, кто
 * спросил первым. Без отдельной области видимости они достались бы первому
 * компоненту и снялись бы на его размонтировании — общая тема молча перестала
 * бы следовать за системной, причём в консоли об этом не сказали бы ни слова.
 */

test('Theme survives the departure of whoever asked for it first', () => {
  const caller = effectScope();
  const seen = caller.run(() => useTheme());
  caller.stop(); // компонент ушёл со сцены

  expect(seen).toBeDefined();
  // Тот же объект, а не пересозданный: состояние не потерялось вместе с областью.
  expect(useTheme().choice).toBe(seen!.choice);
  expect(useTheme().choice.value).toMatch(/^(system|light|dark)$/);
});

test('State is shared: a second call does not create a second theme', () => {
  expect(useTheme().choice).toBe(useTheme().choice);
});
