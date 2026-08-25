/**
 * Категория траты: имя и цвет.
 *
 * Цвет здесь — КЛЮЧ, а не значение: сами оттенки живут в `finance.css` двумя
 * версиями (светлая и тёмная), и «#0d7a63» в хранилище означал бы категорию,
 * которая выцветает при смене темы и никогда уже не починится.
 */

/** Ключ цвета из палитры модуля. */
export type CategoryColor = 'teal' | 'amber' | 'indigo' | 'rose' | 'plum' | 'sage';

/**
 * Палитра. Шесть оттенков, а не двенадцать: категорию в списке и в сводке всегда
 * подписывает ИМЯ, цвет её только находит взглядом — а шесть различимых при CVD
 * оттенков набрать можно, двенадцать уже нет.
 */
export const CATEGORY_COLORS: readonly CategoryColor[] = [
  'teal',
  'amber',
  'indigo',
  'rose',
  'plum',
  'sage',
];

/**
 * Подписи цветов. Ключ хранится латиницей — он часть схемы и переживёт смену
 * языка интерфейса, — а в выборе цвета голосом читается «бирюзовый», а не «teal».
 */
export const COLOR_LABELS: Record<CategoryColor, string> = {
  teal: 'бирюзовый',
  amber: 'янтарный',
  indigo: 'синий',
  rose: 'розовый',
  plum: 'сливовый',
  sage: 'оливковый',
};

export interface Category {
  id: string;
  name: string;
  colorKey: CategoryColor;
  /**
   * Месячный лимит в копейках. Отсутствует — бюджет не задан; ноль означал бы,
   * что любая трата по категории сразу перерасход (см. `entities/budget`).
   */
  limit?: number;
}

/** Цвет категории как значение для `style`. Оттенки — в `finance.css`. */
export function colorOf(colorKey: CategoryColor): string {
  return `var(--finance-${colorKey})`;
}

/**
 * Цвет по id категории. «Без категории» и потерянная ссылка — нейтральная
 * линия кита: выдумывать им оттенок нечестно, они не категория.
 */
export function colorById(categories: ReadonlyMap<string, Category>, id: string | undefined): string {
  const category = id === undefined ? undefined : categories.get(id);
  return category === undefined ? 'var(--line-strong)' : colorOf(category.colorKey);
}

/** Имя категории по id; `undefined` — траты без категории и потерянные ссылки. */
export function nameById(categories: ReadonlyMap<string, Category>, id: string | undefined): string | undefined {
  return id === undefined ? undefined : categories.get(id)?.name;
}

/** Категории по id — для экранов, которым нужен цвет и имя рядом с тратой. */
export function byId(categories: readonly Category[]): Map<string, Category> {
  return new Map(categories.map(category => [category.id, category]));
}

/**
 * Цвет для новой категории: первый неиспользованный, а по кругу — первый в
 * палитре. Предлагать всем один и тот же оттенок значило бы, что цвет ничего не
 * различает, пока его не поменяют руками.
 */
export function suggestColor(existing: readonly Category[]): CategoryColor {
  const taken = new Set(existing.map(category => category.colorKey));
  return CATEGORY_COLORS.find(color => !taken.has(color)) ?? CATEGORY_COLORS[0] ?? 'teal';
}
