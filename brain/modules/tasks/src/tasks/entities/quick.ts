import { isValid } from 'date-fns';
import { parseISODate, shiftISODate, toISODate, todayISO } from '@brain/std';
import { isPriority } from './priority';
import type { Priority } from './priority';
import { nearestWeekday, nextWeekStart, weekendStart } from './schedule';
import type { Weekday } from './schedule';

/**
 * Разбор строки быстрого ввода: `завтра купить молока #дом !высокий`.
 *
 * ЧТО ЗДЕСЬ ГЛАВНОЕ. Разбор идёт ПОТОКЕННО, и непонятый токен остаётся в
 * заголовке дословно. Это не мягкость реализации, а единственный способ не
 * потерять данные: пользователь не знает грамматику наизусть, и `#` в середине
 * ссылки или `!` в конце фразы обязаны доехать до задачи, а не исчезнуть. Обратная
 * сторона того же правила — заголовок всегда виден целиком, и любое непонимание
 * заметно сразу, ещё до нажатия Enter.
 *
 * ПЕРВЫЙ ПОБЕЖДАЕТ, и съедается только он. У задачи один срок, один проект и
 * один приоритет, поэтому второй `#` не имеет смысла — но и молча выбрасывать
 * его нельзя: `купить #молока #хлеба` потеряло бы половину покупок. Поэтому
 * лишние метки остаются текстом: видно, что их не приняли.
 *
 * ЭКРАНИРОВАНИЕ — обратной косой перед токеном: `\#дом` попадает в заголовок как
 * `#дом`. Экранируется весь токен, а не символ: разбор всё равно потокенный, и
 * правило «косая в начале слова снимает с него разбор» объясняется одной
 * фразой.
 *
 * Дата НЕ обязана стоять первой: `купить молока завтра` — такая же нормальная
 * фраза. Слово опознаётся ЦЕЛИКОМ (с точностью до хвостовой запятой), поэтому
 * «завтрашний» датой не считается и остаётся в заголовке.
 */

export interface QuickTask {
  title: string;
  dueAt?: string;
  /**
   * НАЗВАНИЕ проекта, а не идентификатор: строка ввода про идентификаторы ленда
   * ничего не знает. Сопоставить с существующим проектом или завести новый —
   * работа вызывающего.
   */
  project?: string;
  priority?: Priority;
}

/** Ровно YYYY-MM-DD: `parseISO` принял бы и «2026-08», а это другой день. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** «5.09» и «05.09.2026» — привычная русская запись даты. */
const DOT_DAY = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/;

/** «+3» — через три дня. Годится там, где у дня нет своего слова. */
const OFFSET = /^\+(\d{1,3})$/;

/**
 * Хвостовая пунктуация, которую снимаем перед опознанием слова: «завтра, купить
 * молока» — обычная фраза, и запятая не должна отменять разбор. Точка сюда НЕ
 * входит: она значащая в «5.09».
 */
const TAIL = /[,;:]+$/;

const WEEKDAYS: Record<string, Weekday> = {
  вс: 0, воскресенье: 0,
  пн: 1, понедельник: 1,
  вт: 2, вторник: 2,
  ср: 3, среда: 3,
  чт: 4, четверг: 4,
  пт: 5, пятница: 5,
  сб: 6, суббота: 6,
};

/** Сдвиги «на N дней вперёд», у которых есть своё слово. */
const SHIFTS: Record<string, number> = {
  сегодня: 0,
  завтра: 1,
  послезавтра: 2,
};

/**
 * Синонимы приоритетов. Цифры — потому что `!1` набирается вслепую и одинаково
 * на любой раскладке; латиница — потому что раскладку иногда не переключают.
 */
const PRIORITY_WORDS: Record<string, Priority> = {
  низкий: 'low', низ: 'low', low: 'low', 1: 'low',
  обычный: 'normal', обычно: 'normal', norm: 'normal', normal: 'normal', 2: 'normal',
  высокий: 'high', выс: 'high', важно: 'high', high: 'high', 3: 'high',
  срочный: 'urgent', срочно: 'urgent', urgent: 'urgent', 4: 'urgent',
};

export function parseQuickTask(input: string, today: string = todayISO()): QuickTask {
  const words: string[] = [];
  let dueAt: string | undefined;
  let project: string | undefined;
  let priority: Priority | undefined;

  for (const token of input.split(/\s+/)) {
    if (token === '') continue;

    // Экранированный токен не разбирается вовсе — включая случай, когда он
    // выглядит как дата: `\завтра` пишут ровно затем, чтобы слово осталось.
    if (token.startsWith('\\')) {
      words.push(token.slice(1));
      continue;
    }

    if (project === undefined && token.startsWith('#') && token.length > 1) {
      project = token.slice(1);
      continue;
    }

    if (priority === undefined && token.startsWith('!')) {
      const found = priorityOf(token.slice(1));
      if (found !== null) {
        priority = found;
        continue;
      }
    }

    if (dueAt === undefined) {
      const found = dateOf(token.replace(TAIL, ''), today);
      if (found !== null) {
        dueAt = found;
        continue;
      }
    }

    words.push(token);
  }

  const task: QuickTask = { title: words.join(' ') };
  if (dueAt !== undefined) task.dueAt = dueAt;
  if (project !== undefined) task.project = project;
  if (priority !== undefined) task.priority = priority;
  return task;
}

/** Понял ли разбор в строке хоть что-то, кроме заголовка. */
export function hasHints(parsed: QuickTask): boolean {
  return parsed.dueAt !== undefined || parsed.project !== undefined || parsed.priority !== undefined;
}

function priorityOf(word: string): Priority | null {
  const key = word.toLocaleLowerCase('ru');
  // Прямое имя ступени (`!urgent`) работает и без словаря синонимов — иначе
  // добавленная ступень молча перестала бы разбираться.
  if (isPriority(key)) return key;
  return PRIORITY_WORDS[key] ?? null;
}

function dateOf(token: string, today: string): string | null {
  if (token === '') return null;

  const word = token.toLocaleLowerCase('ru');

  const shift = SHIFTS[word];
  if (shift !== undefined) return shiftISODate(today, shift);

  const weekday = WEEKDAYS[word];
  if (weekday !== undefined) return nearestWeekday(today, weekday);

  if (word === 'выходные' || word === 'выхи') return weekendStart(today);
  // Одиночного слова «неделя» здесь нет намеренно: «планёрка неделя» — не срок,
  // а «следующая неделя» — два токена, и ради них пришлось бы разбирать
  // словосочетания со всеми падежами. Ту же дату даёт `пн`, и она однозначна.
  if (word === 'следнеделя') return nextWeekStart(today);

  const offset = OFFSET.exec(token);
  if (offset !== null) return shiftISODate(today, Number(offset[1]));

  if (ISO_DAY.test(token)) return isValid(parseISODate(token)) ? token : null;

  return dottedDate(token, today);
}

/**
 * «5.09» и «05.09.2026». Без года берётся ближайшее такое число НЕ В ПРОШЛОМ:
 * набранное в декабре «5.01» — это январь следующего года, и предлагать вместо
 * него прошлогоднюю дату бессмысленно.
 */
function dottedDate(token: string, today: string): string | null {
  const match = DOT_DAY.exec(token);
  if (match === null) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const explicit = match[3];

  if (explicit !== undefined) return exactDate(Number(explicit), month, day);

  const thisYear = exactDate(Number(today.slice(0, 4)), month, day);
  if (thisYear === null) return null;
  return thisYear >= today ? thisYear : exactDate(Number(today.slice(0, 4)) + 1, month, day);
}

/**
 * Дата из чисел — или `null`, если такого дня нет. Проверка обратным
 * преобразованием: `new Date(2026, 1, 31)` молча даёт 3 марта, и без сверки
 * «31.02» превратилось бы в срок, которого пользователь не называл.
 */
function exactDate(year: number, month: number, day: number): string | null {
  const date = new Date(year, month - 1, day);
  if (!isValid(date)) return null;
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return toISODate(date);
}
