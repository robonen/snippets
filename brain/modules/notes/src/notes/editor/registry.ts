import { createRegistry, defaultBlocks, defaultMarks } from '@robonen/writekit';
import type { BlockDefinition, Registry } from '@robonen/writekit';

/**
 * Реестр блоков редактора заметок: штатный набор writekit, названный
 * по-русски. Меню «/» и подсказки строятся из `meta` блоков, а поставляемые
 * тексты английские; ключевые слова остаются — по ним меню ищет тоже, и
 * «/heading» находит заголовок так же, как «/загол».
 */

interface Wording {
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
}

const WORDING: Readonly<Record<string, Wording>> = {
  paragraph: { title: 'Абзац', description: 'Обычный текст.', keywords: ['абзац', 'текст'] },
  heading: { title: 'Заголовок', description: 'Название раздела, уровни 1–6.', keywords: ['заголовок', 'раздел'] },
  blockquote: { title: 'Цитата', description: 'Отделить фрагмент от основного текста.', keywords: ['цитата'] },
  'code-block': { title: 'Код', description: 'Моноширинный текст как есть; Enter остаётся внутри.', keywords: ['код', 'пример'] },
  callout: { title: 'Врезка', description: 'Заметное примечание, которое не пропустить.', keywords: ['врезка', 'важно', 'примечание'] },
  'bulleted-list': { title: 'Список', description: 'Маркированный список.', keywords: ['список', 'пункты'] },
  'numbered-list': { title: 'Нумерованный список', description: 'Шаги по порядку.', keywords: ['нумерация', 'шаги', 'порядок'] },
  'todo-list': { title: 'Чек-лист', description: 'Пункты с галочками.', keywords: ['чеклист', 'задачи', 'галочка'] },
  divider: { title: 'Разделитель', description: 'Горизонтальная черта между частями.', keywords: ['разделитель', 'черта', 'линия'] },
  image: { title: 'Картинка', description: 'Изображение с подписью.', keywords: ['картинка', 'изображение', 'фото'] },
};

const PLACEHOLDER = 'Пишите… «/» — блоки, «[[» — ссылка на заметку';

/** Группы меню «/» — тоже из `meta`, и тоже по-русски. */
const GROUPS: Readonly<Record<string, string>> = {
  basic: 'Текст',
  lists: 'Списки',
  media: 'Вставки',
};

function localize(block: BlockDefinition): BlockDefinition {
  const wording = WORDING[block.type];
  if (wording === undefined) return block;
  const group = block.meta?.group;
  return {
    ...block,
    ...(block.type === 'paragraph' && { placeholder: PLACEHOLDER }),
    meta: {
      ...block.meta,
      title: wording.title,
      description: wording.description,
      keywords: [...(block.meta?.keywords ?? []), ...wording.keywords],
      ...(group !== undefined && { group: GROUPS[group] ?? group }),
    },
  };
}

/** Один реестр на модуль: схема неизменяема, собирать её на каждый экран незачем. */
export const notesRegistry: Registry = createRegistry({
  blocks: defaultBlocks.map(localize),
  marks: defaultMarks,
});
