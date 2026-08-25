import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

/**
 * Сторож против прыжка рамки при переключении вкладок и состояний.
 *
 * Стоило вкладке «Обзор» просить `wide`, а соседним `list`, и клик уводил
 * страницу на 160 px вбок — вкладка уезжала из-под курсора, которым по ней
 * только что попали. То же давали состояния «загружается» и «удалена» на
 * `reading` рядом с самой заметкой на `list`.
 *
 * ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ: вычисляемая ширина (`:width`) — это прыжок по
 * построению, и разные меры внутри ОДНОГО файла экрана.
 *
 * ЧЕГО ЗДЕСЬ НЕТ, и об этом честнее сказать, чем сделать вид: разные меры у
 * СОСЕДНИХ экранов модуля (разделы ккал — каждый в своём файле) статикой не
 * ловятся, потому что «соседние» — это про переключатель разделов, а не про
 * файлы. Наивное правило «один модуль — одна мера» здесь ложно срабатывало бы
 * на заметках, где мастер и деталь стоят рядом РАЗНЫМИ колонками и меры у них
 * законно разные. Этот случай проверен вживую замером, а не тестом.
 */

const ROOT = join(import.meta.dirname, '../../../..');

function screens(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) screens(path, found);
    else if (name.endsWith('.vue')) found.push(path);
  }
  return found;
}

const files = [join(ROOT, 'modules'), join(ROOT, 'apps')].flatMap(dir => screens(dir));

test('экраны найдены — иначе тест молча проверяет пустоту', () => {
  expect(files.length).toBeGreaterThan(20);
});

test('у одного экрана одна мера, и она не вычисляется', () => {
  const offenders: string[] = [];

  for (const path of files) {
    const source = readFileSync(path, 'utf8');
    const widths = [...source.matchAll(/<Page[^>]*?\swidth="([a-z]+)"/g)].map(m => m[1]);
    const computed = /<Page[^>]*?\s:width=/.test(source);
    const short = path.slice(ROOT.length + 1);

    // Вычисляемая мера — это и есть «рамка поедет при переключении».
    if (computed) offenders.push(`${short}: ширина вычисляется`);
    if (new Set(widths).size > 1) offenders.push(`${short}: меры разъехались — ${[...new Set(widths)].join(', ')}`);
  }

  expect(offenders).toEqual([]);
});
