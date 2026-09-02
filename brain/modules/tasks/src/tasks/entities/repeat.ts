import { addDays, addMonths, addWeeks, isValid } from 'date-fns';
import { parseISODate, plural, toISODate } from '@brain/std';

/**
 * Повторяющиеся задачи: правило и вычисление следующего вхождения.
 *
 * Правило — три скаляра (шаг, единица, выключатель), а не строка вроде RRULE.
 * GTD-lite нужны четыре формы — «каждый день», «каждую неделю», «каждый месяц»
 * и «каждые N дней», — и они целиком описываются парой «единица × N». RRULE
 * умеет «второй вторник месяца», но за это пришлось бы платить разбором,
 * валидацией и экраном, который всё это показывает.
 *
 * Неделя — это НЕ семь дней, а месяц — не тридцать: `addWeeks` сохраняет день
 * недели, `addMonths` — число месяца, и оба знают про переводы часов и високосный
 * год. Ручная арифметика в миллисекундах ломается на обоих (docs/02).
 */

export type RepeatUnit = 'day' | 'week' | 'month';

export const REPEAT_UNITS: readonly RepeatUnit[] = ['day', 'week', 'month'];

export interface RepeatRule {
  unit: RepeatUnit;
  /** Каждые N единиц. Осмысленно только целое ≥ 1 — остальное правилом не является. */
  every: number;
  /**
   * Выключенное правило ХРАНИТСЯ, а не стирается: сняли галочку — настройка
   * ждёт, поставили обратно — вернулась та же, а не «каждый день» по умолчанию.
   */
  enabled: boolean;
}

const STEP: Record<RepeatUnit, (date: Date, amount: number) => Date> = {
  day: addDays,
  week: addWeeks,
  month: addMonths,
};

/** Ровно YYYY-MM-DD: `parseISO` принял бы и «2026-08», а это другой день. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Сколько шагов подряд готовы отмотать в догонялках ({@link nextAfter}).
 * Тысяча дневных шагов — почти три года просрочки; дальше ритм всё равно потерян.
 */
const CATCH_UP_LIMIT = 1000;

/**
 * Следующее вхождение после даты `from` — или `null`, если правила нет.
 *
 * Чистая функция и единственное место, где живёт арифметика повторов: экраны и
 * запись в ленд зовут её, а не считают сами.
 *
 * `null` возвращается на всё, что правилом не является: выключенное правило,
 * дробный или неположительный шаг, мусор вместо даты. Отдельного «ошибочного»
 * результата нет намеренно — вызывающему в любом случае нечего показать.
 *
 * Конец месяца: `addMonths` прижимает 31 января к 28/29 февраля, а не
 * перепрыгивает в март. Прижатие ЛИПКОЕ — следующий шаг считается уже от 28-го,
 * и «каждый месяц 31-го» после февраля становится «каждый месяц 28-го». Чинить
 * это можно только якорем в правиле (исходное число месяца), а якорь — ещё одно
 * поле, которое два устройства могут разойтись; сдвинутую дату пользователь
 * поправит одним касанием, разъехавшийся якорь — нет.
 */
export function nextOccurrence(rule: RepeatRule | undefined, from: string): string | null {
  if (rule === undefined || !rule.enabled) return null;
  if (!Number.isInteger(rule.every) || rule.every < 1) return null;
  if (!ISO_DAY.test(from)) return null;

  const start = parseISODate(from);
  if (!isValid(start)) return null;

  return toISODate(STEP[rule.unit](start, rule.every));
}

/**
 * Первое вхождение строго ПОСЛЕ дня `after`, отсчитанное от `from` по правилу.
 *
 * Нужна ровно при выполнении просроченного повтора. Один шаг от старой даты дал
 * бы задачу, которая рождается уже просроченной: ежедневная, забытая на неделю,
 * потребовала бы семи нажатий, чтобы догнать сегодня. Догоняем шагами правила, а
 * не прыжком от `after`, — так «платить 5-го числа» остаётся пятым числом.
 */
export function nextAfter(rule: RepeatRule | undefined, from: string, after: string): string | null {
  let due = nextOccurrence(rule, from);
  for (let step = 0; due !== null && due <= after && step < CATCH_UP_LIMIT; step++) {
    due = nextOccurrence(rule, due);
  }
  // Отстали больше, чем на CATCH_UP_LIMIT шагов: ритм давно потерян, и честнее
  // назначить следующее вхождение от дня выполнения.
  if (due !== null && due <= after) return nextOccurrence(rule, after);
  return due;
}

/**
 * Привести правило к тому, что можно хранить: `undefined` вместо всего, что
 * правилом не является. Единственная дверь из формы в модель — поэтому в ленде
 * не окажется «каждые 0.5 дня».
 */
export function normalizeRepeat(rule: RepeatRule | undefined): RepeatRule | undefined {
  if (rule === undefined) return undefined;
  const every = Math.trunc(rule.every);
  if (!Number.isFinite(every) || every < 1) return undefined;
  return { unit: rule.unit, every, enabled: rule.enabled };
}

/** Совпадают ли правила. `undefined` совпадает только с `undefined`. */
export function sameRepeat(a: RepeatRule | undefined, b: RepeatRule | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.unit === b.unit && a.every === b.every && a.enabled === b.enabled;
}

const UNIT_ONCE: Record<RepeatUnit, string> = {
  day: 'каждый день',
  week: 'каждую неделю',
  month: 'каждый месяц',
};

const UNIT_FORMS: Record<RepeatUnit, readonly [string, string, string]> = {
  day: ['день', 'дня', 'дней'],
  week: ['неделю', 'недели', 'недель'],
  month: ['месяц', 'месяца', 'месяцев'],
};

/** «каждый день», «каждые 3 дня», «каждые 2 недели». */
export function repeatLabel(rule: RepeatRule): string {
  if (rule.every === 1) return UNIT_ONCE[rule.unit];
  return `каждые ${rule.every} ${plural(rule.every, ...UNIT_FORMS[rule.unit])}`;
}
