import { computed } from 'vue';
import { useAsyncState } from '@robonen/vue';
import type { ComputedRef, Ref } from 'vue';
import { errorText } from './errors';

/**
 * Кнопочное действие: занятость, текст ошибки и запуск — без ручного
 * try/catch/finally в каждом обработчике экрана.
 *
 * Ошибка остаётся видимой до следующего запуска этого же действия: человек
 * должен успеть её прочитать, а чужие кнопки её не стирают.
 */
export interface Action<Params extends unknown[]> {
  readonly busy: Ref<boolean>;
  /** Текст для человека; пустая строка — ошибки нет. */
  readonly error: ComputedRef<string>;
  /** Выполнить. Возвращает true, если действие прошло без ошибки. */
  readonly run: (...params: Params) => Promise<boolean>;
}

export function useAction<Params extends unknown[]>(
  task: (...params: Params) => Promise<void>,
  fallback: string,
): Action<Params> {
  const { isLoading, error, execute } = useAsyncState<void, Params>(
    task,
    undefined,
    { immediate: false, throwError: false },
  );

  return {
    busy: isLoading,
    error: computed(() => {
      const caught: unknown = error.value;
      return caught === null || caught === undefined ? '' : errorText(caught, fallback);
    }),
    run: async (...params: Params) => {
      await execute(0, ...params);
      return error.value === null || error.value === undefined;
    },
  };
}
