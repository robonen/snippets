import { onScopeDispose, ref } from 'vue';
import type { Ref } from 'vue';

/**
 * Reactive `window.devicePixelRatio`. Updates when the page is zoomed or moved between
 * displays of differing density (so canvas-backed UI can stay crisp). Mirrors VueUse's
 * `useDevicePixelRatio`.
 */
export function useDevicePixelRatio(): { pixelRatio: Ref<number> } {
  const pixelRatio = ref(1);
  let media: MediaQueryList | undefined;

  const update = (): void => {
    pixelRatio.value = window.devicePixelRatio || 1;
    media?.removeEventListener('change', update);
    // A media query only fires for the exact ratio it was created with, so re-arm each change.
    media = window.matchMedia(`(resolution: ${pixelRatio.value}dppx)`);
    media.addEventListener('change', update, { once: true });
  };

  update();
  onScopeDispose(() => media?.removeEventListener('change', update));
  return { pixelRatio };
}
