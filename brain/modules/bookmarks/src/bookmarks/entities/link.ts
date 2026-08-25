import { domainOfUrl, parseUrl } from '../lib/url';
import { normalizeTags } from '../lib/tags';

/** Стадия чтения. Три состояния, потому что «начал и бросил» — тоже ответ. */
export type LinkStatus = 'unread' | 'reading' | 'done';

export const LINK_STATUSES: readonly LinkStatus[] = ['unread', 'reading', 'done'];

export const STATUS_LABELS: Record<LinkStatus, string> = {
  unread: 'К прочтению',
  reading: 'Читаю',
  done: 'Прочитано',
};

/** Короткая подпись для чипса статуса — в списке место дороже полноты. */
export const STATUS_SHORT: Record<LinkStatus, string> = {
  unread: 'потом',
  reading: 'читаю',
  done: 'прочитано',
};

/** Сохранённая ссылка. */
export interface Bookmark {
  id: string;
  /** Абсолютный адрес после нормализации `parseUrl`. */
  url: string;
  title: string;
  /** Зачем сохранил. Отсутствует, пока не написали. */
  note?: string;
  /** Канонические теги: без регистра, без повторов. */
  tags: string[];
  status: LinkStatus;
  addedAt: number;
  /** Момент перехода в «прочитано». Отсутствует, пока не дочитали. */
  readAt?: number;
}

/** Следующий статус по кругу: смена одним нажатием, без меню. */
export function nextStatus(status: LinkStatus): LinkStatus {
  const index = LINK_STATUSES.indexOf(status);
  return LINK_STATUSES[(index + 1) % LINK_STATUSES.length] ?? 'unread';
}

/** Домен ссылки для подписи рядом с заголовком. */
export function domainOf(link: Bookmark): string {
  return domainOfUrl(link.url);
}

export interface DraftInput {
  /** Что ввели в поле адреса. */
  url: string;
  /** Свой заголовок; пустой — возьмём предложенный адресом. */
  title?: string;
  note?: string;
  tags?: readonly string[];
  status?: LinkStatus;
}

/**
 * Черновик закладки из ввода формы. `null` — адрес не разбирается, сохранять
 * нечего.
 *
 * Чистая функция, а не метод экрана: то же самое понадобится команде палитры и
 * будущему разбору инбокса, а форма — только один из входов.
 */
export function draftLink(input: DraftInput, id: string, now: number): Bookmark | null {
  const parsed = parseUrl(input.url);
  if (parsed === null) return null;

  const title = (input.title ?? '').trim();
  const note = (input.note ?? '').trim();
  const status = input.status ?? 'unread';

  const link: Bookmark = {
    id,
    url: parsed.url,
    title: title === '' ? parsed.title : title,
    tags: normalizeTags(input.tags ?? []),
    status,
    addedAt: now,
  };
  if (note !== '') link.note = note;
  if (status === 'done') link.readAt = now;
  return link;
}

/**
 * Перевести закладку в новый статус. `readAt` ставится вместе с «прочитано» и
 * снимается при возврате: иначе дата дочитывания переживёт сам факт.
 */
export function withStatus(link: Bookmark, status: LinkStatus, now: number): Bookmark {
  const next: Bookmark = { ...link, status };
  if (status === 'done') next.readAt = link.readAt ?? now;
  else delete next.readAt;
  return next;
}

// ── Порядок, группировка и счётчики ─────────────────────────────────────────
// Всё это — чистые функции над готовым списком, а не запросы к хранилищу:
// снимок каталога уже в памяти (см. `db/composables`), а сортировка и фильтры
// живут на Vue-рефах, которых файберный наблюдатель не видит.

/** По чему сортируется список. */
export type LinkSort = 'added' | 'domain' | 'title';

export const LINK_SORTS: readonly LinkSort[] = ['added', 'domain', 'title'];

export const SORT_LABELS: Record<LinkSort, string> = {
  added: 'Добавлено',
  domain: 'Домен',
  title: 'Название',
};

/** Закладки одного сайта. */
export interface DomainGroup {
  domain: string;
  items: Bookmark[];
}

/** Тег и сколько ссылок им помечено. */
export interface TagCount {
  tag: string;
  count: number;
}

/**
 * Отсортированная копия списка. Вторая ступень везде — дата добавления: при
 * равных ключах порядок обязан быть устойчивым, иначе строки меняются местами
 * на каждой перерисовке.
 */
export function sortLinks(links: readonly Bookmark[], sort: LinkSort): Bookmark[] {
  const sorted = [...links];

  if (sort === 'title') {
    sorted.sort((a, b) => a.title.localeCompare(b.title, 'ru') || b.addedAt - a.addedAt);
    return sorted;
  }

  if (sort === 'domain') {
    // Домен считается по одному разу на закладку: `domainOf` разбирает адрес
    // целиком, а компаратор зовут порядка n·log n раз.
    const domains = new Map(links.map(link => [link.id, domainOf(link)]));
    sorted.sort((a, b) =>
      (domains.get(a.id) ?? '').localeCompare(domains.get(b.id) ?? '', 'ru') || b.addedAt - a.addedAt);
    return sorted;
  }

  sorted.sort((a, b) => b.addedAt - a.addedAt);
  return sorted;
}

/**
 * Закладки по сайтам: крупные группы сверху. Порядок внутри группы приходит с
 * входным списком — группировка не имеет права переставлять то, что уже
 * отсортировали.
 */
export function groupByDomain(links: readonly Bookmark[]): DomainGroup[] {
  const groups = new Map<string, DomainGroup>();
  for (const link of links) {
    const domain = domainOf(link);
    const group = groups.get(domain) ?? { domain, items: [] };
    group.items.push(link);
    groups.set(domain, group);
  }

  return [...groups.values()].sort((a, b) =>
    b.items.length - a.items.length || a.domain.localeCompare(b.domain, 'ru'));
}

/** Сколько ссылок в каждом статусе. Считается по ВСЕМУ списку: счётчик вкладки
 * не должен обнуляться от фильтра, который эта же вкладка и показывает. */
export function countByStatus(links: readonly Bookmark[]): Record<LinkStatus, number> {
  const counts: Record<LinkStatus, number> = { unread: 0, reading: 0, done: 0 };
  for (const link of links) counts[link.status] += 1;
  return counts;
}

/** Теги с частотой: частые сверху, при равной частоте — по алфавиту. */
export function tagCounts(links: readonly Bookmark[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const link of links) {
    for (const tag of link.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }

  return [...counts].map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ru'));
}

/**
 * Есть ли у закладки ВСЕ выбранные теги. Именно «и», а не «или»: фильтр
 * добавляют, чтобы сузить выборку, и второй тег, расширяющий её, был бы
 * противоположностью ожидаемого.
 */
export function hasEveryTag(link: Bookmark, tags: readonly string[]): boolean {
  return tags.every(tag => link.tags.includes(tag));
}

/** Совпадение с поисковым запросом: заголовок, домен, заметка и теги. */
export function matchesQuery(link: Bookmark, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return false;
  return link.title.toLowerCase().includes(needle)
    || link.url.toLowerCase().includes(needle)
    || (link.note ?? '').toLowerCase().includes(needle)
    || link.tags.some(tag => tag.includes(needle));
}
