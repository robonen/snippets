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
  it('подставляет заголовок из адреса, когда своего не дали', () => {
    expect(draftLink({ url: 'example.com/blog/how-to-cook-pasta' }, 'l1', NOW)).toEqual({
      id: 'l1',
      url: 'https://example.com/blog/how-to-cook-pasta',
      title: 'How to cook pasta',
      tags: [],
      status: 'unread',
      addedAt: NOW,
    });
  });

  it('свой заголовок и теги побеждают предложенные', () => {
    const draft = draftLink(
      { url: 'https://example.com/x', title: '  Своё название  ', note: ' зачем ', tags: ['#Vue', 'vue'] },
      'l2',
      NOW,
    );
    expect(draft).toMatchObject({ title: 'Своё название', note: 'зачем', tags: ['vue'] });
  });

  it('пустая заметка полем не становится', () => {
    expect(Object.hasOwn(draftLink({ url: 'example.com', note: '   ' }, 'l3', NOW) ?? {}, 'note')).toBeFalsy();
  });

  it('сразу «прочитано» — вместе с датой дочитывания', () => {
    expect(draftLink({ url: 'example.com', status: 'done' }, 'l4', NOW)?.readAt).toBe(NOW);
  });

  it('неразбираемый адрес — null, а не пустая закладка', () => {
    expect(draftLink({ url: 'мусор с пробелами' }, 'l5', NOW)).toBeNull();
  });
});

describe(nextStatus, () => {
  it('перебирает статусы по кругу', () => {
    expect(nextStatus('unread')).toBe('reading');
    expect(nextStatus('reading')).toBe('done');
    expect(nextStatus('done')).toBe('unread');
  });
});

describe(withStatus, () => {
  it('«прочитано» ставит дату, возврат — снимает', () => {
    const done = withStatus(LINK, 'done', NOW + 10);
    expect(done.readAt).toBe(NOW + 10);
    expect(Object.hasOwn(withStatus(done, 'reading', NOW + 20), 'readAt')).toBeFalsy();
  });

  it('повторная отметка не переписывает дату первого дочитывания', () => {
    const done = withStatus(LINK, 'done', NOW + 10);
    expect(withStatus(done, 'done', NOW + 99).readAt).toBe(NOW + 10);
  });
});

describe(matchesQuery, () => {
  it('ищет по заголовку, адресу, заметке и тегам', () => {
    expect(matchesQuery(LINK, 'crd')).toBeTruthy();
    expect(matchesQuery(LINK, 'EXAMPLE.com')).toBeTruthy();
    expect(matchesQuery({ ...LINK, note: 'про файберы' }, 'файбер')).toBeTruthy();
    expect(matchesQuery(LINK, 'vue')).toBeTruthy();
    expect(matchesQuery(LINK, 'rust')).toBeFalsy();
  });

  it('пустой запрос не совпадает ни с чем: иначе поиск вернул бы весь каталог', () => {
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
  it('по умолчанию новые сверху', () => {
    expect(sortLinks(CATALOG, 'added').map(item => item.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('по названию — русский алфавит, а не порядок кодов', () => {
    // Кириллица у ru-сравнения идёт перед латиницей; по кодам «Guide» был бы
    // первым, а «Ящик» — последним из-за позиции буквы в Unicode.
    expect(sortLinks(CATALOG, 'title').map(item => item.title))
      .toEqual(['Аврора', 'Балкон', 'Ящик', 'Guide']);
  });

  it('по домену — ссылки одного сайта рядом, внутри свежие сверху', () => {
    expect(sortLinks(CATALOG, 'domain').map(item => item.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('исходный список не трогается: экран показывает его же', () => {
    const before = CATALOG.map(item => item.id);
    sortLinks(CATALOG, 'title');
    expect(CATALOG.map(item => item.id)).toEqual(before);
  });

  it('пустой список сортируется в пустой', () => {
    expect(sortLinks([], 'domain')).toEqual([]);
  });
});

describe(groupByDomain, () => {
  it('крупные сайты сверху, порядок внутри группы — входной', () => {
    const groups = groupByDomain(sortLinks(CATALOG, 'added'));
    expect(groups.map(group => group.domain)).toEqual(['example.com', 'vuejs.org']);
    expect(groups[0]?.items.map(item => item.id)).toEqual(['d', 'b', 'c']);
  });

  it('при равном числе ссылок сайты идут по алфавиту: строки не прыгают', () => {
    const groups = groupByDomain([
      link('1', 'https://b.example/x', 'X', NOW, []),
      link('2', 'https://a.example/y', 'Y', NOW, []),
    ]);
    expect(groups.map(group => group.domain)).toEqual(['a.example', 'b.example']);
  });

  it('ни одна ссылка не теряется и не двоится', () => {
    const groups = groupByDomain(CATALOG);
    expect(groups.flatMap(group => group.items).map(item => item.id).sort())
      .toEqual(['a', 'b', 'c', 'd']);
  });

  it('пустой список — пустая группировка, а не сайт без имени', () => {
    expect(groupByDomain([])).toEqual([]);
  });
});

describe(countByStatus, () => {
  it('считает все три статуса, включая нулевые', () => {
    expect(countByStatus([
      { ...LINK, status: 'unread' },
      { ...LINK, status: 'unread' },
      { ...LINK, status: 'done' },
    ])).toEqual({ unread: 2, reading: 0, done: 1 });
  });

  it('пустой список — нули, а не пустой объект: у вкладок всегда есть счётчик', () => {
    expect(countByStatus([])).toEqual({ unread: 0, reading: 0, done: 0 });
  });
});

describe(tagCounts, () => {
  it('частые теги сверху, при равной частоте — по алфавиту', () => {
    expect(tagCounts(CATALOG)).toEqual([
      { tag: 'crdt', count: 2 },
      { tag: 'vue', count: 2 },
    ]);
  });

  it('ссылки без тегов в подсчёт не попадают', () => {
    expect(tagCounts([link('x', 'https://a.example/', 'X', NOW, [])])).toEqual([]);
  });
});

describe(hasEveryTag, () => {
  it('фильтр сужает: нужны ВСЕ выбранные теги', () => {
    expect(hasEveryTag(LINK, ['vue'])).toBeTruthy();
    expect(hasEveryTag(LINK, ['vue', 'crdt'])).toBeTruthy();
    expect(hasEveryTag(LINK, ['vue', 'rust'])).toBeFalsy();
  });

  it('пустой фильтр пропускает всё', () => {
    expect(hasEveryTag(LINK, [])).toBeTruthy();
  });
});

function link(id: string, url: string, title: string, addedAt: number, tags: string[]): Bookmark {
  return { id, url, title, tags, status: 'unread', addedAt };
}
