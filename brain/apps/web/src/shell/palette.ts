import { shallowRef } from 'vue';
import type { ShallowRef } from 'vue';

/**
 * Состояние палитры — модульное, а не в компоненте: открыть её просят и
 * оболочка (⌘K, кнопки навигации), и стартовый экран, у которого хрома нет
 * вовсе, а сама палитра смонтирована один раз в `Shell`.
 */
const open = shallowRef(false);

export function usePalette(): { open: ShallowRef<boolean>; show: () => void; toggle: () => void } {
  return {
    open,
    show: () => {
      open.value = true;
    },
    toggle: () => {
      open.value = !open.value;
    },
  };
}
