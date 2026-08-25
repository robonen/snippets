/**
 * Незакрытая ссылка под курсором — то, что превращает набор `[[` в подсказку.
 *
 * Логика отделена от экрана и от DOM намеренно: попадание курсора внутрь
 * `[[…` — это разбор строки, а не работа с `<textarea>`. Так же, как и в
 * `links.ts`, разбора markdown здесь нет: тело лежит простой строкой, и
 * отличить ссылку от `[[…]]` внутри кодового блока этот слой не может.
 */

export interface LinkEdit {
  readonly text: string;
  /** Куда встать курсору после вставки: сразу за закрывающими скобками. */
  readonly caret: number;
}

const OPEN = '[[';

/**
 * Начало незакрытой ссылки слева от курсора или `-1`.
 *
 * Ссылка не переносится на другую строку — как и в `extractLinks`: иначе
 * подсказка всплывала бы над абзацем, в котором квадратная скобка осталась
 * абзацем выше.
 */
function openAt(text: string, caret: number): number {
  const from = Math.max(0, Math.min(caret, text.length) - OPEN.length);
  const open = text.lastIndexOf(OPEN, from);
  // Курсор между самими скобками (`[|[`) ссылку ещё не открыл: подсказка там
  // всплыла бы на середине набранной пары.
  if (open === -1 || open + OPEN.length > caret) return -1;

  const inside = text.slice(open + OPEN.length, caret);
  // Любая скобка внутри означает, что ссылку уже закрыли или начали заново, —
  // подсказывать по такому куску нечего.
  if (/[[\]\n]/u.test(inside)) return -1;
  return open;
}

/**
 * Что человек уже набрал внутри `[[`, если курсор стоит внутри незакрытой
 * ссылки. `undefined` — курсор снаружи, подсказку показывать не за что.
 *
 * Пустая строка — законный ответ: `[[` без единой буквы значит «покажи все».
 */
export function linkQueryAt(text: string, caret: number): string | undefined {
  const open = openAt(text, caret);
  return open === -1 ? undefined : text.slice(open + OPEN.length, caret);
}

/**
 * Вставить ссылку на заголовок, дописав незакрытую пару скобок, если она есть.
 *
 * Без открытой пары ссылка вставляется целиком: так одна функция обслуживает и
 * подсказку по набору `[[`, и кнопку «Ссылка» с пустым текстом под курсором.
 */
export function insertLink(text: string, caret: number, title: string): LinkEdit {
  const at = Math.max(0, Math.min(caret, text.length));
  const open = openAt(text, at);
  const start = open === -1 ? at : open;
  const link = `${OPEN}${title.trim()}]]`;

  return {
    text: text.slice(0, start) + link + text.slice(at),
    caret: start + link.length,
  };
}
