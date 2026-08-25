/**
 * Wikilinks `[[…]]` в теле заметки.
 *
 * Разбор идёт сканером, а не регуляркой `/\[\[([^\]]*)\]\]/g`: у регулярки нет
 * ответа на вложенность — в «[[a [[b]] c]]» она найдёт «a [[b», то есть ссылку,
 * которой в тексте нет. Сканер на каждом «[[» переоткрывает ссылку, поэтому
 * внутренняя пара выигрывает у внешней, а внешняя остаётся текстом.
 *
 * Разбора markdown здесь нет и не будет: тело заметки временно лежит простой
 * строкой (см. `db/models.ts`), и отличить ссылку от `[[…]]` внутри кодового
 * блока этот слой не может. Когда тело переедет в writekit, ссылка станет
 * маркой документа — и догадки уйдут вместе с этим файлом.
 */

/**
 * Ключ сравнения ссылки с заголовком: регистр и лишние пробелы не считаются.
 *
 * Иначе «[[Планы на неделю]]» и заметка «Планы  на  неделю» не нашли бы друг
 * друга, хотя человек написал одно и то же.
 */
export function linkKey(text: string): string {
  return text.trim().replaceAll(/\s+/gu, ' ').toLowerCase();
}

/**
 * Заголовки, на которые ссылается текст, в порядке первого появления.
 *
 * Повторы схлопываются: две ссылки на одну заметку — это одна связь, а не две.
 */
export function extractLinks(body: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  let open = -1;

  for (let i = 0; i < body.length - 1; i++) {
    if (body[i] === '[' && body[i + 1] === '[') {
      open = i + 2;
      i++;
      continue;
    }

    if (body[i] === ']' && body[i + 1] === ']') {
      if (open >= 0) {
        take(body.slice(open, i), links, seen);
        open = -1;
      }
      i++;
      continue;
    }

    // Ссылка не переносится на другую строку: незакрытая скобка — это опечатка,
    // и без сброса она склеила бы полтекста до первого случайного «]]».
    if (body[i] === '\n') open = -1;
  }

  return links;
}

function take(inside: string, links: string[], seen: Set<string>): void {
  const target = titleOf(inside);
  const key = linkKey(target);
  if (key === '' || seen.has(key)) return;
  seen.add(key);
  links.push(target);
}

/** «[[Заголовок|подпись]]»: адресует заголовок, подпись — только для показа. */
function titleOf(inside: string): string {
  const bar = inside.indexOf('|');
  return (bar === -1 ? inside : inside.slice(0, bar)).trim();
}
