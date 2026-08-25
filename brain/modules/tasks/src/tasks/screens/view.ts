import { shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import { isBucket } from '../entities/task';
import type { Bucket } from '../entities/task';

/**
 * Куда экран задач должен встать при следующем показе.
 *
 * Команда палитры не может навести экран напрямую: роутером владеет оболочка, а
 * `ModuleContext` намеренно отдаёт модулю только его пространство
 * (`module-kit/module.ts`). Поэтому команда оставляет ЗАЯВКУ, а экран, когда бы
 * он ни открылся, её забирает. Тот же вход — у ссылок из глобального поиска,
 * только заявка приезжает адресом: `/tasks?bucket=today&task=<id>`.
 *
 * Заявка одноразовая: иначе экран возвращался бы в ту же корзину при каждом
 * показе, а пользователь переключил бы вкладку и не понял, почему её отбросило.
 */

/**
 * Обзор — вкладка, но не корзина: задач в ней нет, есть сводка по ним. Поэтому
 * тип экрана шире `Bucket`, а `bucketOf` про обзор ничего не знает и знать не
 * должен.
 */
export const OVERVIEW = 'overview';

export type Panel = Bucket | typeof OVERVIEW;

export function isPanel(value: string): value is Panel {
  return value === OVERVIEW || isBucket(value);
}

export interface ViewRequest {
  panel: Panel;
  /** Открыть строку быстрого ввода и поставить в неё фокус. */
  compose?: boolean;
  /** Открыть лист правки этой задачи. */
  task?: string;
}

export const viewRequest: ShallowRef<ViewRequest | null> = shallowRef(null);

export function requestView(next: ViewRequest): void {
  viewRequest.value = next;
}

export function takeView(): ViewRequest | null {
  const next = viewRequest.value;
  viewRequest.value = null;
  return next;
}

/** Заявка из строки запроса адреса. `null` — в адресе ничего для нас нет. */
export function viewFromSearch(search: string): ViewRequest | null {
  const params = new URLSearchParams(search);
  // Имя параметра осталось `bucket`: так его пишет глобальный поиск, и ссылки,
  // уже разосланные наружу, менять никто не станет.
  const panel = params.get('bucket');
  const task = params.get('task');
  if (panel === null && task === null) return null;

  // Незнакомая вкладка в адресе — не повод показать пустоту: инбокс всегда
  // осмысленный ответ, а ссылка могла приехать из будущей версии.
  const request: ViewRequest = { panel: panel !== null && isPanel(panel) ? panel : 'inbox' };
  if (task !== null) request.task = task;
  return request;
}
