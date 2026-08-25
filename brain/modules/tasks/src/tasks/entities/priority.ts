/**
 * Приоритет задачи.
 *
 * Четыре ступени, а не число: «важность 73» невозможно ни выбрать, ни сравнить
 * на глаз, а три ступени схлопывают «обычное» и «неважное» в одно — и тогда
 * понижать нечем, приходится только повышать, и через месяц весь список
 * «высокий».
 *
 * «Обычный» — ЯВНАЯ ступень, а не отсутствие приоритета. Хранить его как
 * `undefined` значило бы завести два способа сказать одно и то же: снятый
 * высокий приоритет и никогда не выставленный давали бы разные записи в ленде
 * и разные результаты сравнения.
 */

export type Priority = 'low' | 'normal' | 'high' | 'urgent';

/** Порядок — от важного к неважному: он же порядок сортировки и списка выбора. */
export const PRIORITIES: readonly Priority[] = ['urgent', 'high', 'normal', 'low'];

export const DEFAULT_PRIORITY: Priority = 'normal';

export const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: 'Срочный',
  high: 'Высокий',
  normal: 'Обычный',
  low: 'Низкий',
};

export const PRIORITY_HINTS: Record<Priority, string> = {
  urgent: 'Горит: делать сегодня, даже если сдвинется остальное',
  high: 'Важное дело — выше обычной очереди',
  normal: 'Обычная очередь дел',
  low: 'Не горит: доберётесь, когда останется время',
};

/**
 * Вес в сортировке: меньше — выше. Таблицей, а не индексом в {@link PRIORITIES}:
 * порядок массива — это порядок ПОКАЗА, и однажды его захочется поменять
 * (например, начать список с «обычного»), а сортировка меняться при этом не
 * должна.
 */
const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function isPriority(value: string): value is Priority {
  return Object.hasOwn(PRIORITY_RANK, value);
}

/** Приоритет задачи как число для сравнения. Отсутствие — «обычный». */
export function priorityRank(priority: Priority | undefined): number {
  return PRIORITY_RANK[priority ?? DEFAULT_PRIORITY];
}

export function comparePriority(a: Priority | undefined, b: Priority | undefined): number {
  return priorityRank(a) - priorityRank(b);
}

/**
 * Показывать ли метку приоритета. «Обычный» молчит: метка на каждой строке
 * перестаёт быть меткой и становится фоном, и тогда «срочный» уже не выделяется.
 */
export function isNotable(priority: Priority | undefined): boolean {
  return priority !== undefined && priority !== DEFAULT_PRIORITY;
}

/**
 * Роль тона для метки кита. Именно РОЛЬ, а не цвет: `danger` в тёмной теме
 * другой, а «срочно» остаётся срочным.
 */
export type PriorityTone = 'neutral' | 'accent' | 'warning' | 'danger';

const PRIORITY_TONES: Record<Priority, PriorityTone> = {
  urgent: 'danger',
  high: 'warning',
  normal: 'neutral',
  low: 'neutral',
};

export function priorityTone(priority: Priority | undefined): PriorityTone {
  return PRIORITY_TONES[priority ?? DEFAULT_PRIORITY];
}
