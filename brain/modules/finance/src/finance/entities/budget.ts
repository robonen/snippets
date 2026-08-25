import type { Category } from './category';
import type { CategorySum } from './expense';

/**
 * Бюджет: месячный лимит на категорию.
 *
 * Лимит НЕОБЯЗАТЕЛЕН и это главное свойство: категория без лимита — законное
 * состояние, а не «лимит ноль». Ноль означал бы, что любая трата по ней сразу
 * перерасход, и половина сводки светилась бы красным у того, кто бюджетов не
 * заводил вовсе.
 *
 * Превышение здесь только СЧИТАЕТСЯ. Ни запрета на трату, ни правки чисел
 * задним числом: деньги уже потрачены, и бюджет — это способ увидеть факт, а не
 * поспорить с ним.
 */

/** Что происходит с лимитом. */
export type BudgetState = 'none' | 'ok' | 'near' | 'over';

/**
 * Порог «на исходе». 85%, а не 100%: предупреждение, которое приходит вместе с
 * превышением, приходит слишком поздно, чтобы что-то изменить.
 */
export const NEAR_SHARE = 0.85;

export interface BudgetStatus {
  /** Потрачено за месяц, копейки. */
  spent: number;
  /** Лимит, копейки. Отсутствует — бюджет не задан. */
  limit?: number;
  /** Доля лимита: 0…1 и выше при перерасходе. Без лимита — 0. */
  share: number;
  /** Остаток; отрицательный — перерасход. Без лимита отсутствует. */
  left?: number;
  state: BudgetState;
}

/** Категория и её бюджет — строка сводки. */
export interface BudgetRow {
  category: Category;
  status: BudgetStatus;
}

/**
 * Состояние бюджета по факту трат. Лимит не задан или неположителен — `none`:
 * делить на него нельзя, а притворяться, что бюджет есть, незачем.
 */
export function budgetStatus(spent: number, limit?: number): BudgetStatus {
  if (limit === undefined || limit <= 0) return { spent, share: 0, state: 'none' };

  const share = spent / limit;
  const state: BudgetState = spent > limit ? 'over' : share >= NEAR_SHARE ? 'near' : 'ok';
  return { spent, limit, share, left: limit - spent, state };
}

/**
 * Бюджеты категорий за месяц: сначала те, что ближе к краю.
 *
 * Категории без лимита в строки не попадают: показывать пустую полосу рядом с
 * заполненными значило бы предлагать сравнить их между собой.
 */
export function budgetRows(
  categories: readonly Category[],
  sums: readonly CategorySum[],
): BudgetRow[] {
  const spent = new Map<string, number>();
  for (const sum of sums) {
    if (sum.category !== undefined) spent.set(sum.category, sum.total);
  }

  return categories
    .filter(category => category.limit !== undefined && category.limit > 0)
    .map(category => ({
      category,
      status: budgetStatus(spent.get(category.id) ?? 0, category.limit),
    }))
    // Вторая ступень — имя: при равных долях (например, у двух нетронутых
    // бюджетов) порядок обязан быть устойчивым, иначе строки прыгают.
    .sort((a, b) => b.status.share - a.status.share
      || a.category.name.localeCompare(b.category.name, 'ru'));
}

/** Сколько бюджетов превышено — счётчик для предупреждения над сводкой. */
export function overBudgetCount(rows: readonly BudgetRow[]): number {
  return rows.filter(row => row.status.state === 'over').length;
}

/** Сумма всех заданных лимитов за месяц, копейки. */
export function totalLimit(rows: readonly BudgetRow[]): number {
  let total = 0;
  for (const row of rows) total += row.status.limit ?? 0;
  return total;
}
