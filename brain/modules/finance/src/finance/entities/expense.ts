import { monthOf } from '../lib/month';
import type { Month } from '../lib/month';

/**
 * Трата и расчёты по тратам.
 *
 * Все суммы — целые копейки (см. `lib/money`): расчёты складывают и делят
 * только их, а рубли появляются на печати. Из-за этого «сумма за месяц» и
 * «сумма по категориям» сходятся до копейки при любом числе слагаемых.
 */
export interface Expense {
  id: string;
  /** Сумма в КОПЕЙКАХ. Целое — иначе сложение перестаёт быть точным. */
  amount: number;
  /** id категории. Отсутствует — трата без категории. */
  category?: string;
  /** Что купили. Отсутствует, если ввели одну сумму. */
  note?: string;
  /** День траты, «YYYY-MM-DD». */
  date: string;
  createdAt: number;
  /**
   * id повторяющейся траты, из которой запись подставилась. Отсутствует у
   * записанных руками.
   *
   * Ссылка нужна, чтобы подстановка была идемпотентной: без неё «уже записано в
   * этом месяце» пришлось бы угадывать по совпадению суммы и описания, и правка
   * суммы порождала бы второй платёж за тот же месяц.
   */
  recurring?: string;
}

/** Траты одного дня. */
export interface DayGroup {
  date: string;
  /** Сумма за день, в копейках. */
  total: number;
  items: Expense[];
}

/** Сумма по одной категории. */
export interface CategorySum {
  /** id категории; `undefined` — траты без категории. */
  category?: string;
  /** Сумма по категории, в копейках. */
  total: number;
  count: number;
}

/** Сумма трат в копейках. */
export function sumAmount(items: readonly Expense[]): number {
  let total = 0;
  for (const item of items) total += item.amount;
  return total;
}

/** Траты выбранного месяца. */
export function inMonth(items: readonly Expense[], month: Month): Expense[] {
  return items.filter(item => monthOf(item.date) === month);
}

/**
 * Траты по дням: свежий день сверху, внутри дня поздняя запись сверху.
 *
 * Порядок именно такой, потому что список открывают, чтобы дописать сегодняшнее
 * и увидеть только что записанное, а не чтобы читать историю с начала времён.
 */
export function groupByDay(items: readonly Expense[]): DayGroup[] {
  const days = new Map<string, DayGroup>();
  for (const item of items) {
    const day = days.get(item.date) ?? { date: item.date, total: 0, items: [] };
    day.total += item.amount;
    day.items.push(item);
    days.set(item.date, day);
  }

  const groups = [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
  for (const day of groups) day.items.sort((a, b) => b.createdAt - a.createdAt);
  return groups;
}

/**
 * Суммы по категориям, крупные сверху. Траты без категории — такая же строка:
 * спрятать их вниз значило бы показать сводку, которая не сходится с итогом.
 */
export function sumByCategory(items: readonly Expense[]): CategorySum[] {
  const sums = new Map<string | undefined, CategorySum>();
  for (const item of items) {
    const sum = sums.get(item.category) ?? emptySum(item.category);
    sum.total += item.amount;
    sum.count += 1;
    sums.set(item.category, sum);
  }

  // Вторая ступень сортировки — id: при равных суммах порядок обязан быть
  // устойчивым, иначе строки сводки меняются местами на каждой перерисовке.
  return [...sums.values()].sort((a, b) =>
    b.total - a.total || (a.category ?? '').localeCompare(b.category ?? ''));
}

/** Доля категории в итоге, 0…1. Пустой месяц — ноль, а не деление на ноль. */
export function shareOf(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

/**
 * Совпадение с поисковым запросом: описание и имя категории.
 *
 * Имя приходит снаружи, а не достаётся по id: трата хранит ссылку на категорию,
 * и тащить сюда весь каталог ради одной строки значило бы, что чистый расчёт
 * знает про хранилище.
 */
export function matchesQuery(expense: Expense, query: string, categoryName?: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return false;
  return (expense.note ?? '').toLowerCase().includes(needle)
    || (categoryName ?? '').toLowerCase().includes(needle);
}

function emptySum(category: string | undefined): CategorySum {
  return category === undefined ? { total: 0, count: 0 } : { category, total: 0, count: 0 };
}
