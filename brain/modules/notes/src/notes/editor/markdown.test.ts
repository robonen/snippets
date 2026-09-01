import { describe, expect, it } from 'vitest';
import { createDoc, inlineText } from '@robonen/writekit';
import { parseInline, parseMarkdown, serializeInline, serializeMarkdown } from './markdown';

/** Полный круг: строка → документ → строка. */
function roundTrip(markdown: string): string {
  return serializeMarkdown(createDoc(parseMarkdown(markdown)));
}

describe('markdown codec', () => {
  it('parses every block kind the editor knows', () => {
    const blocks = parseMarkdown([
      '# Title',
      '',
      'Plain paragraph',
      'with a hard break',
      '',
      '> quoted',
      '> twice',
      '',
      '> [!warning]',
      '> careful',
      '',
      '```ts',
      'const a = 1;',
      '```',
      '',
      '- one',
      '  - nested',
      '1. first',
      '2. second',
      '- [ ] todo',
      '- [x] done',
      '',
      '---',
      '',
      '![alt](https://x/y.png "caption")',
    ].join('\n'));

    expect(blocks.map(block => block.type)).toEqual([
      'heading',
      'paragraph',
      'blockquote',
      'callout',
      'code-block',
      'bulleted-list',
      'bulleted-list',
      'numbered-list',
      'numbered-list',
      'todo-list',
      'todo-list',
      'divider',
      'image',
    ]);
    expect(blocks[0]?.attrs).toEqual({ level: 1 });
    expect(inlineText(blocks[1]?.content as never)).toBe('Plain paragraph\nwith a hard break');
    expect(inlineText(blocks[2]?.content as never)).toBe('quoted\ntwice');
    expect(blocks[3]?.attrs).toEqual({ variant: 'warning' });
    expect(blocks[4]?.attrs).toEqual({ language: 'ts' });
    expect(blocks[6]?.attrs).toEqual({ indent: 1 });
    expect(blocks[9]?.attrs).toEqual({ indent: 0, checked: false });
    expect(blocks[10]?.attrs).toEqual({ indent: 0, checked: true });
    expect(blocks[12]?.attrs).toEqual({ src: 'https://x/y.png', alt: 'alt', caption: 'caption' });
  });

  it('survives a round trip unchanged', () => {
    const source = [
      '## Heading with **bold**',
      '',
      'Text with *italic*, ~~strike~~, `code`, ==mark==, <u>under</u> and [a link](https://a.b/c).',
      'Second line of the same paragraph.',
      '',
      '> [!info]',
      '> note body',
      '',
      '- item one',
      '- item two',
      '  - nested item',
      '1. first',
      '2. second',
      '- [ ] open',
      '- [x] closed',
      '',
      '```',
      'raw *stars* stay',
      '```',
      '',
      '---',
      '',
      'Wikilink [[Заметка дня]] stays a plain text.',
    ].join('\n');

    expect(roundTrip(source)).toBe(source);
    // Второй прогон обязан быть неподвижной точкой — иначе каждое сохранение
    // переписывало бы заметку.
    expect(roundTrip(roundTrip(source))).toBe(roundTrip(source));
  });

  it('keeps legacy plain text readable and stable', () => {
    const legacy = 'Just a note\nwith two lines\n\nand a path C:\\Users\\me and 2 * 3 = 6';
    const once = roundTrip(legacy);
    expect(roundTrip(once)).toBe(once);
    expect(parseMarkdown(once).map(block => inlineText(block.content as never))).toEqual([
      'Just a note\nwith two lines',
      'and a path C:\\Users\\me and 2 * 3 = 6',
    ]);
  });

  it('nests marks in a fixed order and merges adjacent runs', () => {
    const inline = parseInline('**bold *both* bold**');
    expect(inline.map(run => [run.text, run.marks.map(mark => mark.type)])).toEqual([
      ['bold ', ['bold']],
      ['both', ['bold', 'italic']],
      [' bold', ['bold']],
    ]);
    expect(serializeInline(inline)).toBe('**bold *both* bold**');
  });

  it('treats code as opaque and does not read markup inside it', () => {
    const inline = parseInline('run `a *b* c` here');
    expect(inline).toEqual([
      { text: 'run ', marks: [] },
      { text: 'a *b* c', marks: [{ type: 'code' }] },
      { text: ' here', marks: [] },
    ]);
  });

  it('escapes literal markers that would otherwise become marks', () => {
    const doc = createDoc(parseMarkdown('literal \\*stars\\* and \\`ticks\\`'));
    const text = inlineText(doc.content[0]?.content as never);
    expect(text).toBe('literal *stars* and `ticks`');
    expect(serializeMarkdown(doc)).toBe('literal \\*stars\\* and \\`ticks\\`');
  });

  it('numbers ordered items sequentially per list', () => {
    const doc = createDoc(parseMarkdown('1. a\n7. b\n\nbreak\n\n3. c'));
    expect(serializeMarkdown(doc)).toBe('1. a\n2. b\n\nbreak\n\n1. c');
  });

  it('drops empty paragraphs and yields an empty string for an empty document', () => {
    expect(serializeMarkdown(createDoc(parseMarkdown('')))).toBe('');
    expect(serializeMarkdown(createDoc(parseMarkdown('\n\n')))).toBe('');
  });
});
