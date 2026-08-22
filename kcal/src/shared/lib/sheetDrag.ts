import { useRef } from 'vue-jsx-vapor';

/**
 * Свайп-вниз для нижних шторок.
 *
 * Правила жеста — те, к которым приучили нативные шторки:
 *
 * - тянуть можно за любое место листа, но жест НЕ ворует прокрутку: если палец
 *   стоит на прокручиваемой области и она не у верха — лист не двигается;
 * - горизонтальное движение отдаётся содержимому (слайдеры, будущие свайпы);
 * - вверх лист тянется с сопротивлением — «резинка» вместо отрыва от края;
 * - отпускание решает по пути И скорости: короткий резкий смах закрывает так же,
 *   как длинное вытягивание;
 * - призрачный клик после жеста гасится, иначе смах поверх кнопки её нажмёт.
 *
 * Технические углы, ради которых код длиннее очевидного:
 *
 * - `pointermove` продолжает приходить и во время нативной прокрутки — сам по
 *   себе он её не останавливает. Прокрутку глушит `touchmove.preventDefault()`,
 *   и только ПОКА идёт наш жест: слушатель на элементе не-пассивный по
 *   умолчанию, поэтому это законно;
 * - у `.sheet-panel` есть входная CSS-анимация, а анимация в каскаде сильнее
 *   inline-стиля. На старте жеста она снимается, иначе первые кадры лист не
 *   слушается пальца;
 * - `prefers-reduced-motion` закрывает без прощальной анимации.
 */
export function useSheetDrag(close: () => void) {
  const panel = useRef();
  const overlay = useRef();

  interface Gesture {
    id: number;
    startX: number;
    startY: number;
    lastY: number;
    lastT: number;
    velocity: number;
    height: number;
    scroller: HTMLElement | null;
    dragging: boolean;
  }

  let gesture: Gesture | null = null;

  const panelEl = (): HTMLElement | null => (panel.value as HTMLElement | undefined) ?? null;
  const overlayEl = (): HTMLElement | null => (overlay.value as HTMLElement | undefined) ?? null;

  /** Ближайший прокручиваемый предок точки касания — внутри листа. */
  const scrollerOf = (from: EventTarget | null): HTMLElement | null => {
    const root = panelEl();
    let node = from instanceof Element ? from : null;
    while (node !== null && node !== root) {
      if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight) {
        const overflow = getComputedStyle(node).overflowY;
        if (overflow === 'auto' || overflow === 'scroll') return node;
      }
      node = node.parentElement;
    }
    return null;
  };

  const onPointerdown = (event: PointerEvent) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const root = panelEl();
    if (root === null) return;
    gesture = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
      lastT: event.timeStamp,
      velocity: 0,
      height: root.offsetHeight,
      scroller: scrollerOf(event.target),
      dragging: false,
    };
  };

  const onPointermove = (event: PointerEvent) => {
    const state = gesture;
    if (state === null || event.pointerId !== state.id) return;
    const root = panelEl();
    if (root === null) return;

    const dy = event.clientY - state.startY;
    const dx = event.clientX - state.startX;

    if (!state.dragging) {
      // Горизонталь победила — жест не наш.
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        gesture = null;
        return;
      }
      if (dy < 6) return;
      // Палец на прокрутке, и ей есть куда крутиться вверх, — пусть крутится.
      if (state.scroller !== null && state.scroller.scrollTop > 0) {
        gesture = null;
        return;
      }
      state.dragging = true;
      root.style.animation = 'none';
      root.style.transition = 'none';
      root.style.willChange = 'transform';
      const dim = overlayEl();
      if (dim !== null) dim.style.transition = 'none';
      try {
        root.setPointerCapture(event.pointerId);
      }
      catch {
        // Синтетические события в тестах не регистрируют pointerId — жест от
        // этого не ломается, капчур лишь удобство.
      }
    }

    const dt = event.timeStamp - state.lastT;
    if (dt > 0) state.velocity = (event.clientY - state.lastY) / dt;
    state.lastY = event.clientY;
    state.lastT = event.timeStamp;

    // Вверх — резинка: движение есть, отрыва нет.
    const shift = dy >= 0 ? dy : -((-dy) ** 0.72);
    root.style.transform = `translateY(${shift}px)`;
    const dim = overlayEl();
    if (dim !== null && dy > 0) {
      dim.style.opacity = String(Math.max(0.15, 1 - dy / state.height));
    }
  };

  /** Прокрутку глушим только пока тянем лист — иначе жест и скролл дерутся. */
  const onTouchmove = (event: TouchEvent) => {
    if (gesture?.dragging === true) event.preventDefault();
  };

  const settle = (event: PointerEvent) => {
    const state = gesture;
    gesture = null;
    if (state === null || !state.dragging || event.pointerId !== state.id) return;
    const root = panelEl();
    if (root === null) return;

    // Жест был — клик по тому, на чём отпустили палец, уже не намерение.
    root.addEventListener(
      'click',
      (ghost) => {
        ghost.stopPropagation();
        ghost.preventDefault();
      },
      { capture: true, once: true },
    );

    const dy = event.clientY - state.startY;
    const far = dy > Math.min(state.height * 0.32, 160);
    const flick = state.velocity > 0.6 && dy > 32;

    if (far || flick) {
      if (globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        close();
        return;
      }
      root.style.transition = 'transform 0.22s ease-in';
      root.style.transform = 'translateY(110%)';
      const dim = overlayEl();
      if (dim !== null) {
        dim.style.transition = 'opacity 0.22s ease-in';
        dim.style.opacity = '0';
      }
      // Шторка размонтируется закрытием — сбрасывать стили некому и незачем.
      setTimeout(close, 200);
      return;
    }

    root.style.transition = 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)';
    root.style.transform = 'translateY(0)';
    const dim = overlayEl();
    if (dim !== null) {
      dim.style.transition = 'opacity 0.2s ease-out';
      dim.style.opacity = '';
    }
  };

  return { panel, overlay, onPointerdown, onPointermove, onPointerup: settle, onPointercancel: settle, onTouchmove };
}
