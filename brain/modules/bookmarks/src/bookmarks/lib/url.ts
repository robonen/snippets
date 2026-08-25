/**
 * Разбор адреса ссылки — целиком офлайн.
 *
 * Заголовок и домен берутся ИЗ САМОГО адреса, а не из `<title>` страницы: brain
 * работает без сети, и обещать заголовок, который приедет «когда-нибудь потом»,
 * означало бы список закладок, наполовину состоящий из пустых строк.
 */

/** Разобранный адрес: то, что можно узнать о ссылке, не открывая её. */
export interface ParsedUrl {
  /** Нормализованный абсолютный адрес — его и сохраняем. */
  readonly url: string;
  /** Домен без `www.`, с портом, если он не стандартный: «example.com:8443». */
  readonly domain: string;
  /** Заголовок, выведенный из пути. Подставляется, если свой не дали. */
  readonly title: string;
}

/**
 * Схемы, которые пускаем в хранилище. Список белый, а не чёрный: сохранённый
 * `javascript:` или `data:` однажды окажется в `href` — и это уже не закладка,
 * а исполнение чужого кода по клику.
 */
const SCHEMES = new Set(['http:', 'https:']);

/** Что-то похожее на схему в начале строки: «https://», «mailto:», «ftp://». */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Разделители слов в сегменте пути. */
const SEPARATORS = /[-_+]+/g;

/** Сегмент из одних цифр — это id записи, а не заголовок. */
const ONLY_DIGITS = /^\d+$/;

/** Расширение файла в конце сегмента: «.html», «.pdf». */
const EXTENSION = /\.[a-z0-9]{1,5}$/i;

/**
 * Разобрать введённый адрес. `null` — ввод не адрес: пусто, мусор или схема,
 * которую мы не храним.
 */
export function parseUrl(input: string): ParsedUrl | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  // Пробел внутри — это не адрес, а фраза: `new URL` его бы проглотил, закодировав.
  if (/\s/.test(trimmed)) return null;

  // «example.com/blog» — самый частый способ дать ссылку. Схему дописываем сами,
  // причём https: подставленный http: молча понизил бы защищённость адреса.
  const absolute = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(absolute);
  }
  catch {
    return null;
  }

  if (!SCHEMES.has(parsed.protocol)) return null;
  // `https://` без хоста разбирается, но закладкой не является.
  if (parsed.hostname === '') return null;

  return { url: parsed.href, domain: domainOf(parsed), title: titleOf(parsed) };
}

/** Домен для подписи рядом с заголовком. */
export function domainOf(parsed: URL): string {
  // `www.` — не часть имени сайта, а привычка: в списке из полусотни строк
  // четыре лишних символа в каждой съедают место, где виден сам домен.
  const host = parsed.host.startsWith('www.') ? parsed.host.slice(4) : parsed.host;
  return host;
}

/** Домен из строки адреса. Пустая строка, если адрес не разбирается. */
export function domainOfUrl(url: string): string {
  return parseUrl(url)?.domain ?? '';
}

/**
 * Заголовок из пути: последний осмысленный сегмент, очищенный от расширения и
 * разделителей. Если пути нет или он состоит из идентификаторов — домен.
 */
function titleOf(parsed: URL): string {
  const segments = parsed.pathname.split('/');
  for (let i = segments.length - 1; i >= 0; i--) {
    const guess = humanize(segments[i] ?? '');
    if (guess !== '') return guess;
  }
  return domainOf(parsed);
}

/** «how-to-cook_pasta.html» → «How to cook pasta». Пустая строка — не заголовок. */
function humanize(segment: string): string {
  if (segment === '') return '';

  let text = segment;
  try {
    text = decodeURIComponent(segment);
  }
  catch {
    // Битая процентная последовательность — берём сегмент как есть: заголовок
    // это подсказка, и падать из-за неё нечестно.
  }

  text = text.replace(EXTENSION, '').replaceAll(SEPARATORS, ' ').trim();
  if (text === '' || ONLY_DIGITS.test(text)) return '';

  return text.charAt(0).toUpperCase() + text.slice(1);
}
