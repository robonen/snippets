import { onScopeDispose, ref } from 'vue';
import type { Ref } from 'vue';

/**
 * Copy text to the clipboard with a transient `copied` flag for UI feedback. Resolves
 * `false` if the clipboard is unavailable (some pages block it). Mirrors VueUse's
 * `useClipboard`.
 */
export function useClipboard(timeout = 1200): {
  copy: (text: string) => Promise<boolean>;
  copied: Ref<boolean>;
} {
  const copied = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const copy = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      copied.value = true;
      clearTimeout(timer);
      timer = setTimeout(() => (copied.value = false), timeout);
      return true;
    } catch {
      return false;
    }
  };

  onScopeDispose(() => clearTimeout(timer));
  return { copy, copied };
}
