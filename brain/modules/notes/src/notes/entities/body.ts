import { createDoc, createNode, inlineText, normalizeInline } from '@robonen/writekit';
import type { InlineNode, Node, WritekitDocument } from '@robonen/writekit';

/**
 * Тело заметки — документ редактора `@robonen/writekit` как есть: блоки,
 * inline-раны, марки. Никакого промежуточного текстового формата: что человек
 * видит в редакторе, то и лежит в ленде (как — дело `db/models.ts`).
 *
 * Здесь — всё, что нужно домену от тела без самого редактора: пустое тело,
 * текст без разметки для сниппетов и ссылок, сравнение и конструкторы блоков
 * для заготовок и тестов.
 */
export type NoteBody = WritekitDocument;

/**
 * Пустое тело — без единого блока. Редактор сам подставит абзац под курсор,
 * а домену пустота нужна ровно такой: «здесь ничего не написано».
 */
export const EMPTY_BODY: NoteBody = createDoc([]);

/** Текст без разметки, блоки построчно: у картинки остаётся подпись. */
export function bodyText(body: NoteBody): string {
  return body.content
    .map(block => (block.type === 'image'
      ? String(block.attrs['alt'] ?? '')
      : Array.isArray(block.content) ? inlineText(block.content as InlineNode[]) : ''))
    .join('\n');
}

/** Пусто ли тело для человека: ни одного символа текста. */
export function bodyEmpty(body: NoteBody): boolean {
  return bodyText(body).trim() === '';
}

/**
 * Одинаково ли содержимое. По значению, а не по ссылке: снимок из ленда и
 * снимок из формы — разные объекты одного и того же документа.
 */
export function sameBody(a: NoteBody, b: NoteBody): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

// ── Конструкторы: заготовки, тесты ───────────────────────────────────────────

/** Ран текста с марками по имени: `run('важно', 'bold')`. */
export function run(text: string, ...marks: readonly string[]): InlineNode {
  return { text, marks: marks.map(type => ({ type })) };
}

function inline(content: ReadonlyArray<string | InlineNode>): InlineNode[] {
  return [...normalizeInline(content.map(part => (typeof part === 'string' ? run(part) : part)))];
}

export function paragraph(...content: ReadonlyArray<string | InlineNode>): Node {
  return createNode('paragraph', { content: inline(content) });
}

export function heading(level: number, ...content: ReadonlyArray<string | InlineNode>): Node {
  return createNode('heading', { attrs: { level }, content: inline(content) });
}

export function bullet(...content: ReadonlyArray<string | InlineNode>): Node {
  return createNode('bulleted-list', { attrs: { indent: 0 }, content: inline(content) });
}

export function todo(...content: ReadonlyArray<string | InlineNode>): Node {
  return createNode('todo-list', { attrs: { indent: 0, checked: false }, content: inline(content) });
}

/** Собрать тело из блоков. */
export function body(...blocks: readonly Node[]): NoteBody {
  return createDoc(blocks);
}
