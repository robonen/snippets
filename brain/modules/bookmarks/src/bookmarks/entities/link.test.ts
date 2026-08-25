import { describe, expect, it } from 'vitest';
import {
  countByStatus,
  draftLink,
  groupByDomain,
  hasEveryTag,
  matchesQuery,
  nextStatus,
  sortLinks,
  tagCounts,
  withStatus,
} from './link';
import type { Bookmark } from './link';

const NOW = 1_700_000_000;

const LINK: Bookmark = {
  id: 'l1',
  url: 'https://example.com/blog/crdt',
  title: 'Crdt',
  tags: ['vue', 'crdt'],
  status: 'unread',
  addedAt: NOW,
};

describe(draftLink, () => {
  it('derives a title from the address when none is given', () => {
    expect(draftLink({ url: 'example.com/blog/how-to-cook-pasta' }, 'l1', NOW)).toEqual({
      id: 'l1',
      url: 'https://example.com/blog/how-to-cook-pasta',
      title: 'How to cook pasta',
      tags: [],
      status: 'unread',
      addedAt: NOW,
    });
  });

  it('own title and tags win over suggested ones', () => {
    const draft = draftLink(
      { url: 'https://example.com/x', title: '  Своё название  ', note: ' зачем ', tags: ['#Vue', 'vue'] },
      'l2',
      NOW,
    );
    expect(draft).toMatchObject({ title: 'Своё название', note: 'зачем', tags: ['vue'] });
  });

  it('empty note does not become a field', () => {
    expect(Object.hasOwn(draftLink({ url: 'example.com', note: '   ' }, 'l3', NOW) ?? {}, 'note')).toBeFalsy();
  });

  it('created as "read" right away — together with the finished date', () => {
    expect(draftLink({ url: 'example.com', status: 'done' }, 'l4', NOW)?.readAt).toBe(NOW);
  });

  it('unparseable address — null, not an empty bookmark', () => {
    expect(draftLink({ url: 'мусор с пробелами' }, 'l5', NOW)).toBeNull();
  });
});

describe(nextStatus, () => {
  it('cycles through statuses in a circle', () => {
    expect(nextStatus('unread')).toBe('reading');
    expect(nextStatus('reading')).toBe('done');
    expect(nextStatus('done')).toBe('unread');
  });
});

describe(withStatus, () => {
  it('"read" sets the date, reverting clears it', () => {
    const done = withStatus(LINK, 'done', NOW + 10);
    expect(done.readAt).toBe(NOW + 10);
    expect(Object.hasOwn(withStatus(done, 'reading', NOW + 20), 'readAt')).toBeFalsy();
  });

  it('re-marking does not overwrite the first finished date', () => {
    const done = withStatus(LINK, 'done', NOW + 10);
    expect(withStatus(done, 'done', NOW + 99).readAt).toBe(NOW + 10);
  });
});

describe(matchesQuery, () => {
  it('searches by title, address, note, and tags', () => {
    expect(matchesQuery(LINK, 'crd')).toBeTruthy();
    expect(matchesQuery(LINK, 'EXAMPLE.com')).toBeTruthy();
    expect(matchesQuery({ ...LINK, note: 'про файберы' }, 'файбер')).toBeTruthy();
    expect(matchesQuery(LINK, 'vue')).toBeTruthy();
    expect(matchesQuery(LINK, 'rust')).toBeFalsy();
  });

  it('empty query matches nothing: otherwise search would return the whole catalog', () => {
    expect(matchesQuery(LINK, '   ')).toBeFalsy();
  });
});

/** Три сайта, разные даты и заголовки — материал для порядка и группировки. */
const CATALOG: Bookmark[] = [
  link('a', 'https://vuejs.org/guide/intro', 'Guide', NOW + 30, ['vue']),
  link('b', 'https://example.com/blog/crdt', 'Аврора', NOW + 20, ['vue', 'crdt']),
  link('c', 'https://example.com/blog/fibers', 'Ящик', NOW + 10, ['crdt']),
  link('d', 'https://example.com/notes', 'Балкон', NOW + 40, []),
];

describe(sortLinks, () => {
  it('newest first by default', () => {
    expect(sortLinks(CATALOG, 'added').map(item => item.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('by name — Russian alphabet, not code-point order', () => {
    // Кириллица у ru-сравнения идёт перед латиницей; по кодам «Guide» был бы
    // первым, а «Ящик» — последним из-за позиции буквы в Unicode.
    expect(sortLinks(CATALOG, 'title').map(item => item.title))
      .toEqual(['Аврора', 'Балкон', 'Ящик', 'Guide']);
  });

  it('by domain — links of one site together, freshest first inside', () => {
    expect(sortLinks(CATALOG, 'domain').map(item => item.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('source list is untouched: the screen shows the same one', () => {
    const before = CATALOG.map(item => item.id);
    sortLinks(CATALOG, 'title');
    expect(CATALOG.map(item => item.id)).toEqual(before);
  });

  it('empty list sorts into an empty one', () => {
    expect(sortLinks([], 'domain')).toEqual([]);
  });
});

describe(groupByDomain, () => {
  it('large sites first, order within a group is the input order', () => {
    const groups = groupByDomain(sortLinks(CATALOG, 'added'));
    expect(groups.map(group => group.domain)).toEqual(['example.com', 'vuejs.org']);
    expect(groups[0]?.items.map(item => item.id)).toEqual(['d', 'b', 'c']);
  });

  it('with equal link counts sites go alphabetically: rows do not jump', () => {
    const groups = groupByDomain([
      link('1', 'https://b.example/x', 'X', NOW, []),
      link('2', 'https://a.example/y', 'Y', NOW, []),
    ]);
    expect(groups.map(group => group.domain)).toEqual(['a.example', 'b.example']);
  });

  it('no link is lost or duplicated', () => {
    const groups = groupByDomain(CATALOG);
    expect(groups.flatMap(group => group.items).map(item => item.id).sort())
      .toEqual(['a', 'b', 'c', 'd']);
  });

  it('empty list — empty grouping, not a site without a name', () => {
    expect(groupByDomain([])).toEqual([]);
  });
});

describe(countByStatus, () => {
  it('counts all three statuses, including zeros', () => {
    expect(countByStatus([
      { ...LINK, status: 'unread' },
      { ...LINK, status: 'unread' },
      { ...LINK, status: 'done' },
    ])).toEqual({ unread: 2, reading: 0, done: 1 });
  });

  it('empty list — zeros, not an empty object: tabs always have a counter', () => {
    expect(countByStatus([])).toEqual({ unread: 0, reading: 0, done: 0 });
  });
});

describe(tagCounts, () => {
  it('frequent tags first, ties broken alphabetically', () => {
    expect(tagCounts(CATALOG)).toEqual([
      { tag: 'crdt', count: 2 },
      { tag: 'vue', count: 2 },
    ]);
  });

  it('links without tags are not counted', () => {
    expect(tagCounts([link('x', 'https://a.example/', 'X', NOW, [])])).toEqual([]);
  });
});

describe(hasEveryTag, () => {
  it('filter narrows: ALL selected tags are required', () => {
    expect(hasEveryTag(LINK, ['vue'])).toBeTruthy();
    expect(hasEveryTag(LINK, ['vue', 'crdt'])).toBeTruthy();
    expect(hasEveryTag(LINK, ['vue', 'rust'])).toBeFalsy();
  });

  it('empty filter lets everything through', () => {
    expect(hasEveryTag(LINK, [])).toBeTruthy();
  });
});

function link(id: string, url: string, title: string, addedAt: number, tags: string[]): Bookmark {
  return { id, url, title, tags, status: 'unread', addedAt };
}
