import { readonly, shallowRef } from 'vue';
import type { Ref } from 'vue';

/**
 * Очередь всплывающих сообщений.
 *
 * Состояние модульное, а не в `provide`: тост чаще всего показывают ИЗ
 * обработчика, который к дереву компонентов уже не относится — из стора, из
 * ответа сети, из обработчика синхронизации. Требовать там `inject` значило бы
 * тащить компонентный контекст туда, где его нет.
 *
 * Главное здесь — не показать сообщение, а дать его ОТМЕНИТЬ. Удаление,
 * подтверждённое диалогом и не отменяемое после, стоит пользователю данных;
 * удаление с «Отменить» в тосте — пяти секунд внимания. Поэтому `action` —
 * часть основного вызова, а не расширение «на потом».
 *
 * Таймера здесь НЕТ намеренно, хотя очередь — первое место, где его хочется
 * завести. Отсчётом владеет примитив, и вместе с ним — пауза при наведении и
 * при фокусе: это не удобство, а требование доступности (WCAG 2.2.1), потому
 * что читающий медленно не должен гнаться за исчезающим текстом. Свой
 * `useTimeoutFn` рядом означал бы два таймера на одно сообщение, из которых
 * про паузу знает только чужой. Единственное, чего примитиву не хватает —
 * знания о том, что вкладку не смотрят; это добавлено в {@link Toast} через
 * его же публичный `duration`.
 */
export interface ToastAction {
  /** Надпись на кнопке: «Отменить», «Открыть», «Повторить». */
  readonly label: string;
  /**
   * Что кнопка сделает — для скринридера, который читает её вне контекста
   * сообщения. «Восстановить удалённую запись», а не «Отменить».
   */
  readonly altText: string;
  readonly onAction: () => void;
}

export interface ToastOptions {
  readonly title: string;
  readonly description?: string;
  readonly action?: ToastAction;
  /**
   * Сколько держать на экране, мс. `Infinity` — до закрытия вручную; уместно
   * там, где сообщение требует решения, а не просто сообщает.
   */
  readonly duration?: number;
  /** Тон полосы слева: ошибку видно раньше, чем её прочитали. */
  readonly tone?: 'neutral' | 'positive' | 'danger';
}

export interface ToastEntry extends ToastOptions {
  readonly id: number;
}

let nextId = 0;

// `shallowRef` со сменой массива целиком: тосты не правятся по месту, а
// добавляются и снимаются — глубокая реактивность здесь только стоила бы обходов.
const items = shallowRef<readonly ToastEntry[]>([]);

function dismiss(id: number): void {
  items.value = items.value.filter(item => item.id !== id);
}

function show(options: ToastOptions): number {
  const id = nextId++;
  items.value = [...items.value, { ...options, id }];
  return id;
}

/**
 * Доступ к очереди. Компонент {@link Toast} читает `items`, остальные — зовут
 * `show`.
 */
export function useToast(): {
  items: Readonly<Ref<readonly ToastEntry[]>>;
  /** Показать сообщение. Возвращает id — им же его можно снять досрочно. */
  show: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
} {
  return { items: readonly(items) as Readonly<Ref<readonly ToastEntry[]>>, show, dismiss };
}
