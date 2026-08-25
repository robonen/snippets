import { isNotable, priorityTone } from '../entities/priority';
import type { Priority, PriorityTone } from '../entities/priority';

/**
 * Приоритет как ПОЛОСКА слева у строки, а не бейдж и не заливка.
 *
 * Заливка строки кричит: три «высоких» подряд превращают список в светофор, и
 * читать в нём уже нечего. Бейдж честнее, но занимает место справа, где живут
 * срок и прогресс, — то есть данные, а не мнение о важности. Полоска в два
 * пикселя не отнимает ни строки, ни ширины и видна периферийным зрением.
 *
 * Живёт здесь, а не в `entities`: домен знает про РОЛЬ тона (`priorityTone`), а
 * про то, каким классом эта роль рисуется, знает слой экранов. Одно место на
 * оба экрана — список и виджет «Сегодня» не разойдутся в цвете.
 */

const STRIPES: Record<PriorityTone, string> = {
  neutral: 'border-l-line-strong',
  accent: 'border-l-accent',
  warning: 'border-l-warning',
  danger: 'border-l-danger',
};

/**
 * Прозрачная полоска, а не её отсутствие: рамка остаётся на месте, и строки без
 * приоритета не съезжают на два пикселя относительно соседей.
 */
const CALM = 'border-l-transparent';

export function priorityStripe(priority: Priority | undefined): string {
  return isNotable(priority) ? STRIPES[priorityTone(priority)] : CALM;
}
