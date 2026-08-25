/**
 * Теги закладок: свободный текст, приведённый к одной форме.
 *
 * Нормализация нужна не ради красоты, а ради фильтра: «Vue», «vue» и «#vue» —
 * один тег, и без приведения список фильтров превратился бы в три чипса,
 * каждый из которых показывает свою треть ссылок.
 */

/** Разделители в строке ввода: запятая, пробел, перевод строки. */
const SPLIT = /[,\s]+/;

/** Пробелы внутри тега после замены разделителей. */
const INNER_SPACE = /\s+/g;

/**
 * Привести набор тегов к канону: без регистра, без решётки, без пустых,
 * без повторов и в порядке первого появления.
 */
export function normalizeTags(raw: Iterable<string>): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of raw) {
    const tag = item.trim().replace(/^#+/, '').replaceAll(INNER_SPACE, ' ').trim().toLowerCase();
    if (tag === '' || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

/** Строка из поля ввода → канонические теги. */
export function parseTags(input: string): string[] {
  return normalizeTags(input.split(SPLIT));
}

/** Канонические теги → строка для поля ввода. */
export function formatTags(tags: readonly string[]): string {
  return tags.join(', ');
}
