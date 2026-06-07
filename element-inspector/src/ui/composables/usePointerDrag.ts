import { onScopeDispose, toValue, watch } from 'vue';
import type { MaybeRefOrGetter } from 'vue';

export interface DragState {
  /** Total movement since the drag started, in client pixels. */
  dx: number;
  dy: number;
  event: PointerEvent;
}

export interface PointerDragOptions {
  /** Return `false` to ignore this pointerdown (e.g. wrong target). */
  onStart?: (event: PointerEvent) => boolean | void;
  onMove?: (state: DragState) => void;
  onEnd?: (state: DragState) => void;
  /** Capture the pointer on the target for the duration of the drag. */
  pointerCapture?: boolean;
}

/**
 * Pointer-drag gesture on a (ref/getter) target: tracks pointerdown → move → up with
 * window-level move/up listeners so the drag survives the pointer leaving the element.
 * Reports cumulative deltas. All listeners are cleaned up on scope dispose.
 */
export function usePointerDrag<T extends HTMLElement = HTMLElement>(
  target: MaybeRefOrGetter<T | undefined>,
  options: PointerDragOptions,
): void {
  let el: T | null = null;
  let startX = 0;
  let startY = 0;
  let pointerId = -1;
  let dragging = false;

  const onMove = (event: PointerEvent): void => {
    if (!dragging) return;
    options.onMove?.({ dx: event.clientX - startX, dy: event.clientY - startY, event });
  };

  const onUp = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    if (options.pointerCapture && el) {
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
    }
    options.onEnd?.({ dx: event.clientX - startX, dy: event.clientY - startY, event });
  };

  const onDown = (event: PointerEvent): void => {
    if (options.onStart?.(event) === false) return;
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    pointerId = event.pointerId;
    if (options.pointerCapture && el) {
      try {
        el.setPointerCapture(pointerId);
      } catch {
        /* capture unavailable */
      }
    }
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
  };

  const stopWatch = watch(
    () => toValue(target),
    (next) => {
      el?.removeEventListener('pointerdown', onDown);
      el = next ?? null;
      el?.addEventListener('pointerdown', onDown);
    },
    { immediate: true, flush: 'post' },
  );

  onScopeDispose(() => {
    stopWatch();
    el?.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
  });
}
