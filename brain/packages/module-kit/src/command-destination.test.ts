import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

/**
 * Сторож: команда модуля обязана сказать, КУДА вести.
 *
 * Команда, которая ничего не возвращает, с места человека неотличима от
 * неработающей. «Новая заметка», позванная из закладок, заводила заметку в
 * чужом ленде и оставляла его на месте; задачи, закладки и финансы поднимали
 * заявку, которую забирает их собственный экран при монтировании, — а экран не
 * открыт, и забирать её было некому.
 *
 * Проверяется исходник: `module.ts` тянет `.vue`, а прогон идёт в окружении
 * `node`, поэтому позвать `run` по-настоящему здесь нечем. Правило всё же
 * формулируется статически — в теле `run` должен быть `return`.
 *
 * ИСКЛЮЧЕНИЯ — только те, у кого результат не на экране. Список именно здесь, а
 * не флагом в модуле: исключение должно требовать правки общего файла, иначе им
 * начнут пользоваться вместо перехода.
 */
const NO_DESTINATION = new Set([
  // Скачивает файл: вести никуда не нужно, человек и так видит загрузку.
  'export',
]);

const ROOT = join(import.meta.dirname, '../../..');

function moduleFiles(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) moduleFiles(path, found);
    else if (name === 'module.ts') found.push(path);
  }
  return found;
}

const files = moduleFiles(join(ROOT, 'modules'));

test('декларации модулей найдены', () => {
  expect(files.length).toBeGreaterThanOrEqual(4);
});

test('каждая команда возвращает, куда вести', () => {
  const mute: string[] = [];

  for (const path of files) {
    const source = readFileSync(path, 'utf8');
    const block = /commands:\s*\[([\s\S]*?)\n {2}\],/.exec(source);
    if (block === null) continue;

    // Команды разделены объявлением id — режем по нему, чтобы тела не слиплись.
    for (const chunk of block[1]!.split(/\n\s*\{\s*\n/)) {
      const id = /id: '([^']+)'/.exec(chunk)?.[1];
      if (id === undefined || !chunk.includes('run:')) continue;
      if (NO_DESTINATION.has(id)) continue;

      const body = chunk.slice(chunk.indexOf('run:'));
      /*
       * Стрелка без тела (`run: ctx => ({…})`) возвращает по построению.
       * Скобки вокруг единственного аргумента необязательны — линтер их снимает,
       * поэтому шаблон обязан принимать обе записи.
       */
      const arrow = /^run:\s*(?:\([^)]*\)|[\w$]+)\s*=>\s*\(/.test(body);
      const returns = body.includes('return') || arrow;
      if (!returns) mute.push(`${path.slice(ROOT.length + 1)} → «${id}» ничего не возвращает`);
    }
  }

  expect(mute).toEqual([]);
});
