/**
 * Теги заметки: в домене — массив, в ленде — одна строка «работа, идеи».
 *
 * Плоская строка вместо `list`-канала выбрана намеренно. Теги правятся целиком,
 * одним полем ввода: порядок и позиция вставки смысла не несут, а значит,
 * посимвольное слияние покупало бы конфликты там, где хватает «победил
 * последний писавший». Список тегов переедет в `list`, когда у него появится
 * ручной порядок.
 *
 * Цена формата — запятая в самом теге невозможна. Это ограничение, а не потеря:
 * тег с запятой не набирается в поле, где запятая — разделитель.
 */

const SEPARATOR = ', ';

/**
 * Нормализация тега: нижний регистр, без решётки и лишних пробелов.
 *
 * Регистр и «#» — это ввод, а не данные: «#Работа», «работа» и «Работа  »
 * обязаны попадать в одну корзину, иначе фильтр по тегу делит заметки надвое.
 */
export function normalizeTag(raw: string): string {
  return raw
    .replace(/^[#\s]+/u, '')
    .trim()
    .replaceAll(/\s+/gu, ' ')
    .toLowerCase();
}

/** Строка ленда или поля ввода → теги. Пустые отбрасываются, повторы схлопываются. */
export function parseTags(raw: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const piece of raw.split(',')) {
    const tag = normalizeTag(piece);
    if (tag === '' || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

/** Теги → строка. Один вид и для ленда, и для поля ввода: круг обязан замыкаться. */
export function formatTags(tags: readonly string[]): string {
  return tags.join(SEPARATOR);
}

/**
 * Добавить тег к набору. Возвращает ТОТ ЖЕ массив, если добавлять нечего.
 *
 * Тождество здесь работает: экран сравнивает снимки, и новый массив с тем же
 * содержимым выглядел бы правкой — заметка уехала бы наверх списка от нажатия,
 * которое ничего не изменило.
 */
export function addTag(tags: readonly string[], raw: string): readonly string[] {
  const tag = normalizeTag(raw);
  if (tag === '' || tags.includes(tag)) return tags;
  return [...tags, tag];
}

export function removeTag(tags: readonly string[], raw: string): readonly string[] {
  const tag = normalizeTag(raw);
  return tags.includes(tag) ? tags.filter(item => item !== tag) : tags;
}

/** Переключить тег в наборе — для фильтра с мультивыбором. */
export function toggleTag(tags: readonly string[], raw: string): readonly string[] {
  const tag = normalizeTag(raw);
  return tags.includes(tag) ? removeTag(tags, tag) : addTag(tags, tag);
}
