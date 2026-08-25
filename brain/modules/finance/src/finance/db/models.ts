import { atom, model, parts, t } from '@sync/core';
import { scoped } from '@brain/module-kit';
import type { Doc } from '@sync/core';
import { CATEGORY_COLORS } from '../entities/category';
import type { Category } from '../entities/category';
import type { Expense } from '../entities/expense';
import type { Recurring } from '../entities/recurring';

/**
 * Модели финансов на `@sync/core`: схема — данные, документ — объект каналов,
 * поле — атом.
 *
 * Имена несут префикс модуля: реестр `Models` один на приложение, и без него
 * `finance/entry` и `kcal/entry` молча склеили бы схемы.
 */

const scope = scoped('finance');

export const EntryModel = model(scope('entry'), {
  /**
   * Сумма в КОПЕЙКАХ целым числом.
   *
   * Не рубли с дробной частью: у double нет точного представления для 0,1 и
   * 0,2, поэтому «10,10 + 20,20» даёт 30,299999999999997. На одной трате это
   * незаметно, а месячная сводка из трёхсот сложений уезжает от чеков на
   * копейки, которые невозможно ни объяснить, ни списать. `t.int` вдобавок
   * бросает на записи дробного — ошибка вылезет там, где её сделали, а не
   * месяцем позже в итоге.
   */
  amount: atom(t.int),
  /** id категории. `null` — трата без категории: это законное состояние. */
  category: atom(t.maybe(t.string)),
  note: atom(t.maybe(t.string)),
  /** День траты, «YYYY-MM-DD» — человеческий, не UTC. */
  date: atom(t.string),
  createdAt: atom(t.number),
  /** id повторяющейся траты, из которой запись подставилась. `null` — записана руками. */
  recurring: atom(t.maybe(t.string)),
});

export const CategoryModel = model(scope('category'), {
  name: atom(t.string),
  /** Ключ цвета из палитры модуля; сами оттенки — в `finance.css`. */
  colorKey: atom(t.enum(CATEGORY_COLORS).or('teal')),
  /**
   * Месячный лимит в копейках. `null` — бюджет не задан: это не то же самое,
   * что лимит в ноль (см. `entities/budget`).
   */
  limit: atom(t.maybe(t.int)),
});

export const RecurringModel = model(scope('recurring'), {
  title: atom(t.string),
  amount: atom(t.int),
  category: atom(t.maybe(t.string)),
  /** День месяца, 1…31. Зажимается по длине месяца при подстановке, а не тут. */
  day: atom(t.int),
  active: atom(t.bool),
  createdAt: atom(t.number),
});

/** Корень ленда: каталоги трат, категорий и повторяющихся трат, все по id. */
export const FinanceModel = model(scope('root'), {
  entries: parts(t.string, 'finance/entry'),
  categories: parts(t.string, 'finance/category'),
  rules: parts(t.string, 'finance/recurring'),
});

declare module '@sync/core' {
  interface Models {
    'finance/entry': typeof EntryModel;
    'finance/category': typeof CategoryModel;
    'finance/recurring': typeof RecurringModel;
    'finance/root': typeof FinanceModel;
  }
}

// ── Снимки: документ → доменный тип ──────────────────────────────────────────
// Опциональность домена (`undefined`) отображается в `null` модели и обратно:
// у каналов один сентинел, а доменный тип не обязан знать про хранилище.

export function readExpense(id: string, doc: Doc<'finance/entry'>): Expense {
  const expense: Expense = {
    id,
    amount: doc.amount(),
    date: doc.date(),
    createdAt: doc.createdAt(),
  };
  const category = doc.category();
  if (category !== null) expense.category = category;
  const note = doc.note();
  if (note !== null) expense.note = note;
  const recurring = doc.recurring();
  if (recurring !== null) expense.recurring = recurring;
  return expense;
}

export function readCategory(id: string, doc: Doc<'finance/category'>): Category {
  const category: Category = { id, name: doc.name(), colorKey: doc.colorKey() };
  const limit = doc.limit();
  if (limit !== null) category.limit = limit;
  return category;
}

export function readRule(id: string, doc: Doc<'finance/recurring'>): Recurring {
  const rule: Recurring = {
    id,
    title: doc.title(),
    amount: doc.amount(),
    day: doc.day(),
    active: doc.active(),
    createdAt: doc.createdAt(),
  };
  const category = doc.category();
  if (category !== null) rule.category = category;
  return rule;
}

// ── Запись: доменный тип → документ ──────────────────────────────────────────
// Запись равного значения юнитов не порождает, поэтому «сохранить форму
// целиком» дёшево и не шумит в ленде.

export function writeExpense(doc: Doc<'finance/entry'>, expense: Expense): void {
  doc.amount(expense.amount);
  doc.category(expense.category ?? null);
  doc.note(expense.note ?? null);
  doc.date(expense.date);
  doc.createdAt(expense.createdAt);
  doc.recurring(expense.recurring ?? null);
}

export function writeCategory(doc: Doc<'finance/category'>, category: Category): void {
  doc.name(category.name);
  doc.colorKey(category.colorKey);
  doc.limit(category.limit ?? null);
}

export function writeRule(doc: Doc<'finance/recurring'>, rule: Recurring): void {
  doc.title(rule.title);
  doc.amount(rule.amount);
  doc.category(rule.category ?? null);
  doc.day(rule.day);
  doc.active(rule.active);
  doc.createdAt(rule.createdAt);
}
