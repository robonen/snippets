import { onScopeDispose, toValue, watch } from 'vue';
import type { MaybeRefOrGetter } from 'vue';

/**
 * Attach a DOM event listener that is bound when the (possibly ref/getter) target becomes
 * available and torn down automatically when the owning scope disposes. Re-binds if the
 * target changes. Mirrors VueUse's `useEventListener`.
 */
export function useEventListener<E extends Event = Event, T extends EventTarget = EventTarget>(
  target: MaybeRefOrGetter<T | undefined>,
  type: string,
  listener: (event: E) => void,
  options?: AddEventListenerOptions | boolean,
): () => void {
  let detach = (): void => {};

  const stopWatch = watch(
    () => toValue(target),
    (el) => {
      detach();
      if (!el) return;
      const handler = listener as EventListener;
      el.addEventListener(type, handler, options);
      detach = () => el.removeEventListener(type, handler, options);
    },
    { immediate: true, flush: 'post' },
  );

  const stop = (): void => {
    stopWatch();
    detach();
    detach = () => {};
  };

  onScopeDispose(stop);
  return stop;
}
