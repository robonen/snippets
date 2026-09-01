import { describe, expect, it } from 'vitest';
import { createNode } from '@robonen/writekit';
import { body, bullet, heading, paragraph, run, todo } from '../entities/body';
import { inlineToMarkdown, toMarkdown } from './markdown';

describe(toMarkdown, () => {
  it('renders every block kind the editor knows', () => {
    const doc = body(
      heading(1, 'Title'),
      paragraph('Plain paragraph', run('\nwith a hard break')),
      createNode('blockquote', { content: [run('quoted\ntwice')] }),
      createNode('callout', { attrs: { variant: 'warning' }, content: [run('careful')] }),
      createNode('code-block', { attrs: { language: 'ts' }, content: [run('const a = *1*;')] }),
      bullet('one'),
      createNode('bulleted-list', { attrs: { indent: 1 }, content: [run('nested')] }),
      createNode('numbered-list', { attrs: { indent: 0 }, content: [run('first')] }),
      createNode('numbered-list', { attrs: { indent: 0 }, content: [run('second')] }),
      todo('open'),
      createNode('todo-list', { attrs: { indent: 0, checked: true }, content: [run('done')] }),
      createNode('divider'),
      createNode('image', { attrs: { src: 'https://x/y.png', alt: 'alt', caption: 'caption' } }),
    );

    expect(toMarkdown(doc)).toBe([
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
      'const a = *1*;',
      '```',
      '',
      '- one',
      '  - nested',
      '1. first',
      '2. second',
      '- [ ] open',
      '- [x] done',
      '',
      '---',
      '',
      '![alt](https://x/y.png "caption")',
    ].join('\n'));
  });

  it('numbers ordered items per run and restarts after a break', () => {
    const item = (text: string): ReturnType<typeof createNode> =>
      createNode('numbered-list', { attrs: { indent: 0 }, content: [run(text)] });
    expect(toMarkdown(body(item('a'), item('b'), paragraph('break'), item('c')))).toBe('1. a\n2. b\n\nbreak\n\n1. c');
  });

  it('skips empty paragraphs and images without a source', () => {
    expect(toMarkdown(body(paragraph(''), createNode('image', { attrs: { src: '' } }), paragraph('text')))).toBe('text');
    expect(toMarkdown(body())).toBe('');
  });
});

describe(inlineToMarkdown, () => {
  it('keeps a mark open across runs instead of reopening it', () => {
    expect(inlineToMarkdown([run('bold ', 'bold'), run('both', 'bold', 'italic'), run(' bold', 'bold')]))
      .toBe('**bold *both* bold**');
  });

  it('opens the longer-lived mark outside regardless of rank', () => {
    expect(inlineToMarkdown([run('a ', 'italic'), run('b', 'italic', 'bold'), run(' c', 'italic')]))
      .toBe('*a **b** c*');
  });

  it('writes links with their href and code as backticks', () => {
    expect(inlineToMarkdown([
      run('see '),
      { text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://a.b/c' } }] },
      run(' and '),
      run('x', 'code'),
    ])).toBe('see [docs](https://a.b/c) and `x`');
  });

  it('leaves literal markers untouched: the file is for reading, not for re-parsing', () => {
    expect(inlineToMarkdown([run('2 * 3 = 6')])).toBe('2 * 3 = 6');
  });
});
