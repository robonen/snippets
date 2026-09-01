import { markEq } from '@robonen/writekit';
import type { Inline, Mark, Node } from '@robonen/writekit';
import type { NoteBody } from '../entities/body';

/**
 * Выгрузка тела заметки в markdown — в одну сторону.
 *
 * Обратного разбора нет: тело живёт документом редактора (`entities/body.ts`),
 * а markdown нужен ровно затем, чтобы унести заметки из приложения в файл,
 * который прочтёт человек и откроет чужой редактор. Поэтому и экранирования
 * нет: `*` в тексте останется `*` — файл для чтения, а не для повторного ввода.
 *
 * Диалект — то, что умеет редактор: заголовки `#`, цитата `>`, врезка
 * `> [!вид]`, код в тройных кавычках, списки `-` / `1.` / `- [ ]`, `---`,
 * картинка; марки `**` `*` `~~` `` ` `` `==` `<u>` и `[текст](href)`.
 */
export function toMarkdown(body: NoteBody): string {
  const out: string[] = [];
  let ordinal = 0;

  for (const [index, block] of body.content.entries()) {
    const previous = body.content[index - 1];
    ordinal = block.type === 'numbered-list' && previous?.type === 'numbered-list' && attr(previous, 'indent') === attr(block, 'indent')
      ? ordinal + 1
      : 1;
    const chunk = blockToMarkdown(block, ordinal);
    if (chunk === null) continue;
    // Пункты одного списка стоят вплотную; всё остальное — через пустую строку.
    const glue = out.length === 0 ? '' : LISTS.has(block.type) && previous !== undefined && LISTS.has(previous.type) ? '\n' : '\n\n';
    out.push(glue + chunk);
  }

  return out.join('');
}

const LISTS = new Set(['bulleted-list', 'numbered-list', 'todo-list']);

function blockToMarkdown(block: Node, ordinal: number): string | null {
  const text = inlineToMarkdown(inlineOf(block));
  switch (block.type) {
    case 'heading':
      return `${'#'.repeat(clamp(attr(block, 'level'), 1, 6))} ${text.replaceAll('\n', ' ')}`;
    case 'blockquote':
      return prefixLines(text, '> ');
    case 'callout':
      return `> [!${String(block.attrs['variant'] ?? 'info')}]\n${prefixLines(text, '> ')}`;
    case 'code-block': {
      const language = String(block.attrs['language'] ?? '');
      return `\`\`\`${language === 'plain' ? '' : language}\n${inlineOf(block).map(part => part.text).join('')}\n\`\`\``;
    }
    case 'bulleted-list':
      return listItem(block, '- ', text);
    case 'numbered-list':
      return listItem(block, `${ordinal}. `, text);
    case 'todo-list':
      return listItem(block, block.attrs['checked'] === true ? '- [x] ' : '- [ ] ', text);
    case 'divider':
      return '---';
    case 'image': {
      const src = String(block.attrs['src'] ?? '');
      if (src === '') return null;
      const caption = String(block.attrs['caption'] ?? '');
      return `![${String(block.attrs['alt'] ?? '')}](${src}${caption === '' ? '' : ` "${caption}"`})`;
    }
    default:
      // Пустой абзац в файле — просто лишняя пустая строка; не пишем его.
      return text === '' ? null : text;
  }
}

function listItem(block: Node, marker: string, text: string): string {
  const indent = '  '.repeat(clamp(attr(block, 'indent'), 0, 8));
  // Жёсткие переносы внутри пункта продолжаются под текстом, а не под маркером.
  // Пустой пункт — голый маркер: пробел после него был бы хвостовым.
  return (indent + marker + text.replaceAll('\n', `\n${indent}${' '.repeat(marker.length)}`)).trimEnd();
}

/**
 * Inline-раны → строка с разметкой.
 *
 * Марки открываются и закрываются ЧЕРЕЗ границы ранов, а не вокруг каждого:
 * «жирный, а внутри курсив» — это `**a *b* c**`, а не `**a *****b***** c**`.
 * Порядок открытия — по дальности: марка, живущая дольше в последующих ранах,
 * открывается снаружи, и вложенность остаётся правильной скобочной.
 */
export function inlineToMarkdown(inline: Inline): string {
  let out = '';
  const open: Mark[] = [];

  const extent = (mark: Mark, from: number): number => {
    let count = 0;
    while (inline[from + count]?.marks.some(other => markEq(other, mark)) === true) count++;
    return count;
  };

  for (const [index, run] of inline.entries()) {
    let keep = 0;
    while (keep < open.length && run.marks.some(mark => markEq(mark, open[keep] as Mark))) keep++;
    for (let at = open.length - 1; at >= keep; at--) out += closingOf(open[at] as Mark);
    open.length = keep;

    const opening = run.marks
      .filter(mark => !open.some(other => markEq(other, mark)))
      .sort((a, b) => extent(b, index) - extent(a, index) || rank(a.type) - rank(b.type));
    for (const mark of opening) {
      out += openingOf(mark);
      open.push(mark);
    }
    out += run.text;
  }

  for (let at = open.length - 1; at >= 0; at--) out += closingOf(open[at] as Mark);
  return out;
}

const DELIMITERS: Readonly<Record<string, readonly [open: string, close: string]>> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strike: ['~~', '~~'],
  highlight: ['==', '=='],
  underline: ['<u>', '</u>'],
  code: ['`', '`'],
};

/** Добивка порядка при равной дальности: ссылка снаружи, код внутри. */
const RANK = ['link', 'highlight', 'underline', 'strike', 'bold', 'italic', 'code'];

function openingOf(mark: Mark): string {
  return mark.type === 'link' ? '[' : (DELIMITERS[mark.type]?.[0] ?? '');
}

function closingOf(mark: Mark): string {
  return mark.type === 'link' ? `](${String(mark.attrs?.['href'] ?? '')})` : (DELIMITERS[mark.type]?.[1] ?? '');
}

function rank(type: string): number {
  const at = RANK.indexOf(type);
  return at === -1 ? RANK.length : at;
}

function inlineOf(block: Node): Inline {
  return Array.isArray(block.content) ? block.content as Inline : [];
}

function attr(block: Node, name: string): number {
  const value = block.attrs[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function prefixLines(source: string, prefix: string): string {
  return source.split('\n').map(line => (line === '' ? prefix.trimEnd() : prefix + line)).join('\n');
}
