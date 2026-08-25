import { defineModule } from '@brain/module-kit';
import { Wallet } from 'lucide-vue-next';
import { dayTitle, todayISO } from '@brain/std';
import { FinanceModel, readCategory, readExpense, writeExpense } from './db/models';
import { matchesQuery } from './entities/expense';
import type { Expense } from './entities/expense';
import { formatMoney } from './lib/money';
import { parseQuickEntry } from './lib/quick';
import { newId } from './lib/id';
import { requestEntry } from './lib/intent';
import FinanceScreen from './screens/month/FinanceScreen.vue';
import MonthWidget from './widgets/MonthWidget.vue';

/**
 * Финансы: ручной учёт трат — быстрый ввод, категории, месячная сводка.
 *
 * Банковских импортов нет и не планируется: они означали бы либо ключи от счёта
 * в местном хранилище, либо посредника, которому эти ключи отдают, — а модуль
 * с личными деньгами тем и ценен, что не ходит в сеть вовсе.
 */
export const financeModule = defineModule({
  id: 'finance',
  title: 'Финансы',
  icon: Wallet,
  land: { root: 'finance/root' },
  routes: [
    { path: '', name: 'finance:month', component: FinanceScreen },
  ],
  widgets: [
    { id: 'month', title: 'Траты за месяц', component: MonthWidget, order: 20 },
  ],
  commands: [
    {
      id: 'add',
      title: 'Записать трату',
      keywords: ['трата', 'расход', 'деньги', 'финансы', 'потратил'],
      run: () => {
        requestEntry();
        // Заявку забирает экран финансов при монтировании — см. задачи.
        return '/finance';
      },
    },
  ],
  /**
   * Строка вида «250 кофе» — трата, и модуль узнаёт это сам.
   *
   * Разбор именно здесь, а не в оболочке: стартовый экран не обязан знать, что
   * число в начале строки означает деньги, а не количество подходов. Он лишь
   * спрашивает у каждого модуля «твоё?» и показывает тех, кто ответил.
   */
  capture: (ctx, text) => {
    const parsed = parseQuickEntry(text);
    if (parsed === null) return null;

    const note = parsed.note === '' ? 'без описания' : parsed.note;
    return {
      title: `Трата ${formatMoney(parsed.amount)} — ${note}`,
      hint: 'сегодня',
      run: () => {
        const today = todayISO();
        ctx.space.edit(() => {
          const root = ctx.space.root(FinanceModel);
          const id = newId();
          // Пустые поля ОПУСКАЮТСЯ, а не пишутся пустой строкой: пустая строка
          // доезжает обратно как значение, и трата получает описание «» вместо
          // имени категории и ссылку на категорию, которой не бывает, — отдельной
          // безымянной строкой в сводке по категориям. Тот же разбор из формы
          // (`FinanceScreen.addQuick`) их и так опускает.
          const expense: Expense = { id, amount: parsed.amount, date: today, createdAt: Date.now() };
          if (parsed.note !== '') expense.note = parsed.note;
          writeExpense(root.entries(id), expense);
        });
        return { name: 'finance:month' };
      },
    };
  },

  search: (ctx, query) => {
    const root = ctx.space.root(FinanceModel);
    const names = new Map(root.categories
      .keys()
      .map(id => [id, readCategory(id, root.categories(id)).name]));

    return root.entries
      .keys()
      .map(id => readExpense(id, root.entries(id)))
      .filter(expense => matchesQuery(expense, query, nameOf(names, expense.category)))
      // Свежие сверху: трату ищут, чтобы поправить только что записанное, куда
      // чаще, чем чтобы вспомнить прошлогоднее.
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
      .slice(0, SEARCH_LIMIT)
      .map(expense => ({
        id: `finance:${expense.id}`,
        title: expense.note ?? nameOf(names, expense.category) ?? 'Трата',
        subtitle: `${formatMoney(expense.amount)} · ${dayTitle(expense.date)}`,
        to: '/finance',
      }));
  },
});

/** Глобальный поиск делит выдачу между модулями: длинный хвост одного из них её топит. */
const SEARCH_LIMIT = 8;

function nameOf(names: ReadonlyMap<string, string>, id: string | undefined): string | undefined {
  return id === undefined ? undefined : names.get(id);
}
