import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { useDoc, useSpace, useValue } from '@sync/vue';
import type { Category } from '../entities/category';
import type { Expense } from '../entities/expense';
import { sortRules } from '../entities/recurring';
import type { Recurring } from '../entities/recurring';
import {
  FinanceModel,
  readCategory,
  readExpense,
  readRule,
  writeCategory,
  writeExpense,
  writeRule,
} from './models';

/**
 * Хуки финансов поверх моста `@sync/vue`.
 *
 * Снимок ЦЕЛОЙ коллекции, а не подписка на строку: трат за год — сотни, один
 * файбер на каталог дешевле файбера на запись. И главное — выбранный месяц
 * живёт на Vue-рефе, а файберный наблюдатель Vue-рефов не видит; фильтр по
 * месяцу обязан считаться на стороне Vue.
 */

/** Все траты: свежие сверху, внутри дня — поздние сверху. */
export function useExpenses(): ComputedRef<Expense[]> {
  const root = useDoc(FinanceModel);
  const snapshot = useValue(() => root.entries.keys().map(id => readExpense(id, root.entries(id))));
  return computed(() => [...(snapshot.value ?? [])]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt));
}

/** Категории по алфавиту: их выбирают глазами из короткого списка. */
export function useCategories(): ComputedRef<Category[]> {
  const root = useDoc(FinanceModel);
  const snapshot = useValue(() =>
    root.categories.keys().map(id => readCategory(id, root.categories(id))));
  return computed(() => [...(snapshot.value ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name, 'ru')));
}

/** Повторяющиеся траты по дню списания: так их и читают — «что спишется дальше». */
export function useRules(): ComputedRef<Recurring[]> {
  const root = useDoc(FinanceModel);
  const snapshot = useValue(() => root.rules.keys().map(id => readRule(id, root.rules(id))));
  return computed(() => sortRules(snapshot.value ?? []));
}

// ── Запись ───────────────────────────────────────────────────────────────────
// Мутаций как понятия нет: запись — прямой вызов каналов в транзакции
// (`space.edit`: одна метка времени и один сброс на всё).

/**
 * След удалённой категории: кого пришлось отцепить.
 *
 * Возвращается наружу, потому что удаление обязано быть ОТМЕНЯЕМЫМ целиком.
 * Вернуть один документ категории мало: траты и правила остались бы без ссылки,
 * и «Отменить» восстановило бы имя, но не принадлежность.
 */
export interface CategoryRemoval {
  /** id трат, у которых сняли ссылку на категорию. */
  readonly expenses: readonly string[];
  /** id правил, у которых сняли ссылку. */
  readonly rules: readonly string[];
}

export interface FinanceActions {
  saveExpense(expense: Expense): void;
  removeExpense(id: string): void;
  /** Записать пачку трат одной транзакцией — подстановка повторяющихся. */
  saveExpenses(expenses: readonly Expense[]): void;
  saveCategory(category: Category): void;
  removeCategory(id: string): CategoryRemoval;
  restoreCategory(category: Category, removal: CategoryRemoval): void;
  saveRule(rule: Recurring): void;
  removeRule(id: string): void;
}

export function useActions(): FinanceActions {
  const space = useSpace();
  const root = useDoc(FinanceModel);

  return {
    saveExpense(expense) {
      space.edit(() => writeExpense(root.entries(expense.id), expense));
    },
    removeExpense(id) {
      root.entries.delete(id);
    },
    saveExpenses(expenses) {
      // Одной транзакцией: пачка подписок за месяц — это одно действие
      // пользователя, и разбивать её на пять сбросов незачем.
      space.edit(() => {
        for (const expense of expenses) writeExpense(root.entries(expense.id), expense);
      });
    },
    saveCategory(category) {
      space.edit(() => writeCategory(root.categories(category.id), category));
    },
    removeCategory(id) {
      // Траты категорию переживают: удаление категории не должно уносить с собой
      // деньги. Ссылка снимается здесь же — иначе трата осталась бы указывать на
      // документ, которого нет, и в сводке появилась бы безымянная строка.
      const expenses: string[] = [];
      const rules: string[] = [];

      space.edit(() => {
        for (const key of root.entries.keys()) {
          const entry = root.entries(key);
          if (entry.category() !== id) continue;
          entry.category(null);
          expenses.push(key);
        }
        for (const key of root.rules.keys()) {
          const rule = root.rules(key);
          if (rule.category() !== id) continue;
          rule.category(null);
          rules.push(key);
        }
        root.categories.delete(id);
      });

      return { expenses, rules };
    },
    restoreCategory(category, removal) {
      space.edit(() => {
        writeCategory(root.categories(category.id), category);
        for (const key of removal.expenses) root.entries(key).category(category.id);
        for (const key of removal.rules) root.rules(key).category(category.id);
      });
    },
    saveRule(rule) {
      space.edit(() => writeRule(root.rules(rule.id), rule));
    },
    removeRule(id) {
      // Записанные по правилу траты остаются: деньги ушли, и удаление подписки
      // не имеет права переписать историю месяца.
      root.rules.delete(id);
    },
  };
}
