import { onScopeDispose, ref, toValue, watch } from 'vue';
import type { MaybeRefOrGetter, Ref } from 'vue';

/**
 * Track an element's content-box size via `ResizeObserver`. Re-observes if the target ref
 * changes and disconnects on scope dispose. Mirrors VueUse's `useElementSize`.
 */
export function useElementSize<T extends HTMLElement = HTMLElement>(
  target: MaybeRefOrGetter<T | undefined>,
): { width: Ref<number>; height: Ref<number> } {
  const width = ref(0);
  const height = ref(0);
  let observer: ResizeObserver | undefined;

  const stopWatch = watch(
    () => toValue(target),
    (el) => {
      observer?.disconnect();
      observer = undefined;
      if (!el) return;
      observer = new ResizeObserver(() => {
        width.value = el.clientWidth;
        height.value = el.clientHeight;
      });
      observer.observe(el);
      width.value = el.clientWidth;
      height.value = el.clientHeight;
    },
    { immediate: true, flush: 'post' },
  );

  onScopeDispose(() => {
    stopWatch();
    observer?.disconnect();
  });

  return { width, height };
}
