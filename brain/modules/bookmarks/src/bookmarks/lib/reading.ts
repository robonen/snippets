/**
 * Оценка времени чтения — по тому, что известно офлайн.
 *
 * Настоящую длину статьи знает только сама страница, а модуль в сеть не ходит
 * (см. `lib/url`). Остаётся то, что написал человек: заголовок и заметка «зачем
 * сохранил». Заметка весит больше заголовка — длинную пишут к длинному, а
 * заголовок бывает длинным и у страницы на два абзаца.
 *
 * Поэтому наружу выдаются СТУПЕНИ, а не число: «7 минут» выглядит как измерение
 * и обещает точность, которой здесь нет, а «≈ 5 мин» честно читается как
 * прикидка. Ступени редкие по той же причине — между 20 и 30 минутами разницы в
 * решении «читать сейчас или потом» уже нет.
 */

/** Слова строки: непробельные куски. */
const WORDS = /\s+/;

/**
 * Заметка весит вдвое: её пишут не всегда, и если написали много — материал
 * того стоил.
 */
const NOTE_WEIGHT = 2;

/** Ступени: вес до `upTo` включительно — столько минут. */
const STEPS: ReadonlyArray<{ readonly upTo: number; readonly minutes: number }> = [
  { upTo: 4, minutes: 2 },
  { upTo: 10, minutes: 5 },
  { upTo: 20, minutes: 10 },
  { upTo: 36, minutes: 20 },
];

/** Всё, что тяжелее последней ступени. */
const LONGEST = 30;

/** Минут в часе — для печати долгих очередей. */
const PER_HOUR = 60;

/**
 * Неразрывный пробел: «5 мин» не имеет права разорваться переносом строки
 * между числом и единицей.
 */
const NBSP = ' ';

/** Что нужно от закладки для оценки: только тексты, которые написал человек. */
export interface ReadingInput {
  readonly title: string;
  readonly note?: string;
}

/** Слов в строке. Пустая строка — ноль слов, а не одно пустое. */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(WORDS).length;
}

/** Вес закладки в словах: заголовок плюс заметка с коэффициентом. */
export function readingWeight(link: ReadingInput): number {
  return countWords(link.title) + NOTE_WEIGHT * countWords(link.note ?? '');
}

/** Оценка чтения одной ссылки, минуты. Всегда одна из ступеней. */
export function estimateMinutes(link: ReadingInput): number {
  const weight = readingWeight(link);
  for (const step of STEPS) {
    if (weight <= step.upTo) return step.minutes;
  }
  return LONGEST;
}

/** Сколько времени займёт очередь целиком, минуты. */
export function totalMinutes(links: readonly ReadingInput[]): number {
  let total = 0;
  for (const link of links) total += estimateMinutes(link);
  return total;
}

/**
 * «5 мин», «1 ч 15 мин», «2 ч». Часы появляются только когда они есть: «0 ч 5
 * мин» читается медленнее, чем «5 мин», и ничего не добавляет.
 */
export function formatMinutes(minutes: number): string {
  const total = Math.max(Math.round(minutes), 0);
  const hours = Math.trunc(total / PER_HOUR);
  const rest = total % PER_HOUR;

  if (hours === 0) return `${rest}${NBSP}мин`;
  return rest === 0 ? `${hours}${NBSP}ч` : `${hours}${NBSP}ч${NBSP}${rest}${NBSP}мин`;
}

/** Подпись оценки рядом со ссылкой: тильда напоминает, что это прикидка. */
export function readingLabel(link: ReadingInput): string {
  return `≈${NBSP}${formatMinutes(estimateMinutes(link))}`;
}
