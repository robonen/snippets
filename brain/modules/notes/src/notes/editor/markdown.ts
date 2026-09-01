import { createNode, inlineText, markEq, normalizeInline } from '@robonen/writekit';
import type { Inline, InlineNode, Mark, Node, WritekitDocument } from '@robonen/writekit';

/**
 * Кодек «markdown ⇄ документ writekit».
 *
 * Тело заметки по-прежнему лежит в ленде строкой markdown (`db/models.ts`):
 * так работают ссылки `[[…]]`, упоминания, поиск, выгрузка и все старые
 * заметки — им не нужен ни редактор, ни миграция. Редактор же живёт в своём
 * документе: блоки, inline-раны и марки. Этот файл — единственное место, где
 * одно превращается в другое, и его главный закон — **устойчивость к
 * повторному прогону**: `serialize(parse(serialize(doc)))` обязан дать ту же
 * строку, иначе каждое сохранение понемногу переписывало бы заметку.
 *
 * Диалект намеренно узкий и предсказуемый — ровно то, что умеет редактор:
 *
 *   блоки    абзац; `#…######` заголовок; `>` цитата; `> [!вид]` врезка;
 *            ``` код; `-` список; `1.` нумерация; `- [ ]` чек-лист; `---`
 *            разделитель; `![alt](src "подпись")` картинка;
 *   марки    `**жирный**`, `*курсив*`, `~~зачёркнутый~~`, `` `код` ``,
 *            `==выделение==`, `<u>подчёркнутый</u>`, `[текст](href)`.
 *
 * Одиночный перенос строки внутри абзаца — жёсткий перенос, а не «мягкий»,
 * как в CommonMark: старые заметки набирались в `<textarea>`, и человек видел
 * каждый Enter именно переносом. Курсив только через `*`: `_` в текстах
 * слишком часто встречается в идентификаторах, чтобы считать его разметкой.
 * Двойные скобки `[[…]]` для кодека — обычный текст: ссылку на заметку ищет
 * `lib/links.ts` по строке, как и раньше.
 */

// ── Модель ───────────────────────────────────────────────────────────────────

const PARAGRAPH = 'paragraph';
const HEADING = 'heading';
const QUOTE = 'blockquote';
const CODE = 'code-block';
const CALLOUT = 'callout';
const BULLETED = 'bulleted-list';
const NUMBERED = 'numbered-list';
const TODO = 'todo-list';
const DIVIDER = 'divider';
const IMAGE = 'image';

const LISTS = new Set([BULLETED, NUMBERED, TODO]);

/** Добивка порядка открытия марок при равной дальности: меньший ранг — снаружи. */
const MARK_ORDER = ['link', 'highlight', 'underline', 'strike', 'bold', 'italic', 'code'] as const;

interface Delimiter {
  readonly type: string;
  readonly open: string;
  readonly close: string;
}

/** Парные ограничители — длинные раньше коротких, иначе `**` читался бы как два `*`. */
const DELIMITERS: readonly Delimiter[] = [
  { type: 'bold', open: '**', close: '**' },
  { type: 'strike', open: '~~', close: '~~' },
  { type: 'highlight', open: '==', close: '==' },
  { type: 'underline', open: '<u>', close: '</u>' },
  { type: 'italic', open: '*', close: '*' },
];

// ── Разбор: markdown → блоки ─────────────────────────────────────────────────

const FENCE = /^```([\w+-]*)\s*$/u;
// Текст после пробелов начинается с непробела (`\S.*`): иначе `\s+` и `.*`
// делили бы пробелы между собой, и строка из одних пробелов давала бы
// полиномиальный перебор — линтер прав, а заголовков из пробелов не бывает.
const HEADING_LINE = /^(#{1,6}) +(\S.*)?$/u;
const RULE = /^(?:-{3,}|\*{3,})\s*$/u;
const CALLOUT_HEAD = /^>\s*\[!([\w-]+)\]\s*$/u;
const QUOTE_LINE = /^>\s?(.*)$/u;
// Маркер и остаток строки — раздельно, а чек-бокс ищется уже в остатке:
// одной регуляркой пустой пункт «-», «- [ ]» без текста и «-   текст»
// с лишними пробелами не описать без обменивающихся квантификаторов.
const LIST_LINE = /^( *)(?:([-*+])|(\d+)[.)])(?: (.*))?$/u;
const CHECKBOX = /^\[([ x])\] ?(.*)$/iu;
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/u;

/** Тело заметки → блоки документа. Пустая строка даёт пустой список: редактор сам добавит абзац. */
export function parseMarkdown(markdown: string): Node[] {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const blocks: Node[] = [];
  let paragraph: string[] = [];

  const flush = (): void => {
    if (paragraph.length === 0) return;
    blocks.push(text(PARAGRAPH, paragraph.join('\n')));
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    const fence = FENCE.exec(line);
    if (fence !== null) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i++;
      }
      const language = fence[1] ?? '';
      blocks.push(createNode(CODE, {
        attrs: { language: language === '' ? 'plain' : language },
        content: [{ text: body.join('\n'), marks: [] }],
      }));
      continue;
    }

    if (line.trim() === '') {
      flush();
      continue;
    }

    const heading = HEADING_LINE.exec(line);
    if (heading !== null) {
      flush();
      blocks.push(text(HEADING, heading[2] ?? '', { level: (heading[1] ?? '#').length }));
      continue;
    }

    if (RULE.test(line)) {
      flush();
      blocks.push(createNode(DIVIDER));
      continue;
    }

    const image = IMAGE_LINE.exec(line);
    if (image !== null) {
      flush();
      blocks.push(createNode(IMAGE, {
        attrs: { src: image[2] ?? '', alt: image[1] ?? '', caption: image[3] ?? '' },
      }));
      continue;
    }

    const callout = CALLOUT_HEAD.exec(line);
    if (callout !== null) {
      flush();
      const body: string[] = [];
      while (i + 1 < lines.length && QUOTE_LINE.test(lines[i + 1] ?? '')) {
        i++;
        body.push(QUOTE_LINE.exec(lines[i] ?? '')?.[1] ?? '');
      }
      blocks.push(text(CALLOUT, body.join('\n'), { variant: callout[1] ?? 'info' }));
      continue;
    }

    const quote = QUOTE_LINE.exec(line);
    if (quote !== null) {
      flush();
      const body = [quote[1] ?? ''];
      while (i + 1 < lines.length && QUOTE_LINE.test(lines[i + 1] ?? '') && !CALLOUT_HEAD.test(lines[i + 1] ?? '')) {
        i++;
        body.push(QUOTE_LINE.exec(lines[i] ?? '')?.[1] ?? '');
      }
      blocks.push(text(QUOTE, body.join('\n')));
      continue;
    }

    const item = LIST_LINE.exec(line);
    if (item !== null) {
      flush();
      const indent = Math.floor((item[1] ?? '').length / 2);
      const rest = (item[4] ?? '').trimStart();
      const checkbox = CHECKBOX.exec(rest);
      if (checkbox !== null) {
        blocks.push(text(TODO, checkbox[2] ?? '', { indent, checked: checkbox[1] !== ' ' }));
      }
      else {
        blocks.push(text(item[3] !== undefined ? NUMBERED : BULLETED, rest, { indent }));
      }
      continue;
    }

    paragraph.push(line);
  }

  flush();
  return blocks;
}

function text(type: string, source: string, attrs: Record<string, string | number | boolean> = {}): Node {
  return createNode(type, { attrs, content: parseInline(source) });
}

/** Строка с разметкой → нормализованные inline-раны. */
export function parseInline(source: string): Inline {
  return normalizeInline(parseSpan(source, []));
}

const ESCAPABLE = new Set(['*', '`', '~', '=', '<', '\\', '[', ']', '(']);

function parseSpan(source: string, marks: readonly Mark[]): InlineNode[] {
  const out: InlineNode[] = [];
  let buffer = '';
  const flush = (): void => {
    if (buffer !== '') out.push({ text: buffer, marks: [...marks] });
    buffer = '';
  };

  for (let i = 0; i < source.length;) {
    const char = source[i] ?? '';

    // Экранирование: `\*` — звёздочка, а не курсив.
    if (char === '\\' && ESCAPABLE.has(source[i + 1] ?? '')) {
      buffer += source[i + 1] ?? '';
      i += 2;
      continue;
    }

    // Код — сильнее всего: внутри него разметки нет.
    if (char === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ text: source.slice(i + 1, end), marks: [...marks, { type: 'code' }] });
        i = end + 1;
        continue;
      }
    }

    // Ссылка `[текст](href)`. `[[` — не ссылка, а wikilink, он остаётся текстом.
    if (char === '[' && source[i + 1] !== '[') {
      const link = /^\[([^[\]\n]*)\]\(([^)\s]*)\)/u.exec(source.slice(i));
      if (link !== null) {
        flush();
        out.push(...parseSpan(link[1] ?? '', [...marks, { type: 'link', attrs: { href: link[2] ?? '' } }]));
        i += link[0].length;
        continue;
      }
    }

    const delimiter = DELIMITERS.find(candidate => source.startsWith(candidate.open, i));
    if (delimiter !== undefined) {
      const from = i + delimiter.open.length;
      const end = closeOf(source, from, delimiter.close);
      if (end > from) {
        flush();
        out.push(...parseSpan(source.slice(from, end), [...marks, { type: delimiter.type }]));
        i = end + delimiter.close.length;
        continue;
      }
    }

    buffer += char;
    i++;
  }

  flush();
  return out;
}

/** Ближайший закрывающий ограничитель, не экранированный и не в конце строки. */
function closeOf(source: string, from: number, close: string): number {
  for (let at = source.indexOf(close, from); at !== -1; at = source.indexOf(close, at + 1)) {
    if (source[at - 1] !== '\\' && source[at - 1] !== '\n') return at;
  }
  return -1;
}

// ── Запись: документ → markdown ──────────────────────────────────────────────

/** Документ редактора → тело заметки. */
export function serializeMarkdown(doc: WritekitDocument): string {
  const out: string[] = [];
  let ordinal = 0;

  for (const [index, block] of doc.content.entries()) {
    const previous = doc.content[index - 1];
    ordinal = block.type === NUMBERED && previous?.type === NUMBERED && attr(previous, 'indent') === attr(block, 'indent')
      ? ordinal + 1
      : 1;
    const chunk = serializeBlock(block, ordinal);
    if (chunk === null) continue;
    // Пункты одного списка стоят вплотную; всё остальное — через пустую строку.
    const glue = out.length === 0 ? '' : LISTS.has(block.type) && previous !== undefined && LISTS.has(previous.type) ? '\n' : '\n\n';
    out.push(glue + chunk);
  }

  return out.join('');
}

function serializeBlock(block: Node, ordinal: number): string | null {
  const body = inlineOf(block);
  switch (block.type) {
    case HEADING:
      return `${'#'.repeat(clamp(attr(block, 'level'), 1, 6))} ${serializeInline(body).replaceAll('\n', ' ')}`;
    case QUOTE:
      return prefixLines(serializeInline(body), '> ');
    case CALLOUT:
      return `> [!${String(block.attrs['variant'] ?? 'info')}]\n${prefixLines(serializeInline(body), '> ')}`;
    case CODE:
      return `\`\`\`${codeLanguage(block)}\n${body.map(run => run.text).join('')}\n\`\`\``;
    case BULLETED:
      return listItem(block, '- ', serializeInline(body));
    case NUMBERED:
      return listItem(block, `${ordinal}. `, serializeInline(body));
    case TODO:
      return listItem(block, block.attrs['checked'] === true ? '- [x] ' : '- [ ] ', serializeInline(body));
    case DIVIDER:
      return '---';
    case IMAGE: {
      const src = String(block.attrs['src'] ?? '');
      if (src === '') return null;
      const caption = String(block.attrs['caption'] ?? '');
      return `![${String(block.attrs['alt'] ?? '')}](${src}${caption === '' ? '' : ` "${caption.replaceAll('"', '\\"')}"`})`;
    }
    default: {
      const line = serializeInline(body);
      // Пустой абзац при чтении растворился бы в пустой строке — не пишем его вовсе.
      return line === '' ? null : line;
    }
  }
}

function listItem(block: Node, marker: string, line: string): string {
  const indent = '  '.repeat(clamp(attr(block, 'indent'), 0, 8));
  // Жёсткие переносы внутри пункта продолжаются под текстом, а не под маркером.
  return indent + marker + line.replaceAll('\n', `\n${indent}${' '.repeat(marker.length)}`);
}

/**
 * Inline-раны → строка с разметкой.
 *
 * Марки открываются и закрываются ЧЕРЕЗ границы ранов, а не вокруг каждого:
 * «жирный, а внутри курсив» — это `**a *b* c**`, а не `**a *****b***** c**`.
 * Порядок открытия — по дальности: марка, живущая дольше в последующих ранах,
 * открывается снаружи. Так и `*a **b** c*`, и `**a *b* c**` записываются как
 * набирались — без лишних ограничителей и без потери марок при чтении.
 */
export function serializeInline(inline: Inline): string {
  let out = '';
  const open: Mark[] = [];

  /** На сколько ранов подряд, начиная с `from`, хватает марки. */
  const extent = (mark: Mark, from: number): number => {
    let count = 0;
    while (inline[from + count]?.marks.some(other => markEq(other, mark)) === true) count++;
    return count;
  };

  for (const [index, run] of inline.entries()) {
    // Открытые марки, которые ран продолжает, остаются; остальные закрываются
    // изнутри наружу — вложенность обязана быть правильной скобочной.
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

    const inCode = open.some(mark => mark.type === 'code');
    const inLink = open.some(mark => mark.type === 'link');
    out += inCode ? run.text : escape(run.text, inLink);
  }

  for (let at = open.length - 1; at >= 0; at--) out += closingOf(open[at] as Mark);
  return out;
}

function openingOf(mark: Mark): string {
  if (mark.type === 'link') return '[';
  if (mark.type === 'code') return '`';
  return DELIMITERS.find(candidate => candidate.type === mark.type)?.open ?? '';
}

function closingOf(mark: Mark): string {
  if (mark.type === 'link') return `](${String(mark.attrs?.['href'] ?? '')})`;
  if (mark.type === 'code') return '`';
  return DELIMITERS.find(candidate => candidate.type === mark.type)?.close ?? '';
}

/**
 * Экранировать то, что при чтении сошло бы за разметку. Точечно, а не всё
 * подряд: `[[ссылка]]`, пути и формулы обязаны остаться читаемыми глазом.
 */
function escape(source: string, inLink = false): string {
  const plain = source
    // Бэкслеш перед экранируемым знаком сам нуждается в экранировании —
    // иначе при чтении он «съел» бы следующий символ. Прочие остаются как есть.
    .replaceAll(/\\(?=[*`~=<[\]()\\])/gu, '\\\\')
    .replaceAll('*', '\\*')
    .replaceAll('`', '\\`')
    .replaceAll('~~', '\\~~')
    .replaceAll('==', '\\==')
    .replaceAll('<u>', '\\<u>')
    .replaceAll('](', ']\\(');
  // Внутри `[текст](…)` квадратные скобки закрыли бы ссылку раньше времени.
  return inLink ? plain.replaceAll('[', '\\[').replaceAll(']', '\\]') : plain;
}

/**
 * Тело без разметки — для сниппетов в списке и счётчика слов: блоки построчно,
 * марки сняты, у картинки остаётся подпись. Тот же разбор, что у редактора,
 * поэтому список и экран считают слова одинаково.
 */
export function plainText(markdown: string): string {
  return parseMarkdown(markdown)
    .map(block => (block.type === IMAGE ? String(block.attrs['alt'] ?? '') : inlineText(inlineOf(block))))
    .join('\n');
}

// ── Служебное ────────────────────────────────────────────────────────────────

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

function codeLanguage(block: Node): string {
  const language = String(block.attrs['language'] ?? '');
  return language === 'plain' ? '' : language;
}

function prefixLines(source: string, prefix: string): string {
  return source.split('\n').map(line => (line === '' ? prefix.trimEnd() : prefix + line)).join('\n');
}

function rank(type: string): number {
  const at = MARK_ORDER.indexOf(type as (typeof MARK_ORDER)[number]);
  return at === -1 ? MARK_ORDER.length : at;
}
