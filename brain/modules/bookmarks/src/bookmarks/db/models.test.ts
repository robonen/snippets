import { describe, expect, it } from 'vitest';
import { Land, Link, createSpace, fixedClock } from '@sync/core';
import type { Space } from '@sync/core';
import type { Bookmark } from '../entities/link';
import { BookmarksModel, readLink, writeLink } from './models';

function spaceOf(): Space {
  const land = new Land(Link.peer(new Uint8Array(8).fill(0x62)), fixedClock(1_700_000));
  return createSpace({ land });
}

const LINK: Bookmark = {
  id: 'l1',
  url: 'https://example.com/blog/crdt',
  title: 'CRDT без слёз',
  note: 'дочитать главу про файберы',
  tags: ['vue', 'crdt'],
  status: 'reading',
  addedAt: 1_700_100,
  readAt: 1_700_200,
};

describe('модели закладок на @sync/core', () => {
  it('закладка переживает круг документ → снимок, включая опциональные поля', () => {
    const root = spaceOf().root(BookmarksModel);
    writeLink(root.links(LINK.id), LINK);

    expect(readLink(LINK.id, root.links(LINK.id))).toEqual(LINK);
  });

  it('незаполненные опциональные поля отсутствуют, а не равны null', () => {
    const root = spaceOf().root(BookmarksModel);
    const bare: Bookmark = {
      id: 'l2',
      url: 'https://example.com/',
      title: 'example.com',
      tags: [],
      status: 'unread',
      addedAt: 1_700_300,
    };
    writeLink(root.links(bare.id), bare);

    const back = readLink(bare.id, root.links(bare.id));
    expect(back).toEqual(bare);
    expect(Object.hasOwn(back, 'note')).toBeFalsy();
    expect(Object.hasOwn(back, 'readAt')).toBeFalsy();
  });

  it('теги переписываются реконсиляцией: порядок и состав совпадают со снимком', () => {
    const root = spaceOf().root(BookmarksModel);
    writeLink(root.links(LINK.id), LINK);
    writeLink(root.links(LINK.id), { ...LINK, tags: ['crdt', 'rust'] });

    expect(readLink(LINK.id, root.links(LINK.id)).tags).toEqual(['crdt', 'rust']);
  });

  it('ключи каталога видны и удаляются', () => {
    const root = spaceOf().root(BookmarksModel);
    writeLink(root.links('a'), { ...LINK, id: 'a' });
    writeLink(root.links('b'), { ...LINK, id: 'b', title: 'Вторая' });

    expect([...root.links.keys()].sort()).toEqual(['a', 'b']);
    root.links.delete('a');
    expect([...root.links.keys()]).toEqual(['b']);
  });

  it('две вкладки сходятся: запись из одной видна в другой', () => {
    const clock = fixedClock(1_700_000);
    const peer = Link.peer(new Uint8Array(8).fill(0x62));
    const tabA = new Land(peer, clock, { session: 0x000100 });
    const tabB = new Land(peer, clock, { session: 0x800100 });

    const rootA = createSpace({ land: tabA }).root(BookmarksModel);
    const rootB = createSpace({ land: tabB }).root(BookmarksModel);

    writeLink(rootA.links('x'), { ...LINK, id: 'x' });
    writeLink(rootB.links('y'), { ...LINK, id: 'y', title: 'Из второй вкладки' });

    // Обмен как по каналу вкладок, только руками и детерминированно.
    tabB.apply(tabA.part().units);
    tabA.apply(tabB.part().units);

    expect(readLink('x', rootB.links('x')).title).toBe('CRDT без слёз');
    expect(readLink('y', rootA.links('y')).title).toBe('Из второй вкладки');
  });
});
