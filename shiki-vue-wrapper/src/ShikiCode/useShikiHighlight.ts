import { shallowRef, watchEffect, type MaybeRefOrGetter, toValue } from 'vue';
import type { ShikiTransformer } from 'shiki/core';

export interface UseShikiHighlightOptions {
  code: MaybeRefOrGetter<string>;
  lang: MaybeRefOrGetter<string>;
  theme?: MaybeRefOrGetter<string | undefined>;
  themes?: MaybeRefOrGetter<{ light: string; dark: string } | undefined>;
  transformers?: MaybeRefOrGetter<ShikiTransformer[] | undefined>;
}

export function useShikiHighlight(options: UseShikiHighlightOptions) {
  const html = shallowRef('');
  const isReady = shallowRef(false);
  const error = shallowRef<Error | null>(null);

  watchEffect(async (onCleanup) => {
    let cancelled = false;
    onCleanup(() => { cancelled = true });

    try {
      const { getShiki } = await import('./highlighter');
      const shiki = await getShiki();
      if (cancelled) return;

      const themes = toValue(options.themes);
      const theme = toValue(options.theme);

      html.value = shiki.codeToHtml(toValue(options.code), {
        lang: toValue(options.lang),
        ...(themes ? { themes } : { theme: theme ?? 'aurora-x' }),
        transformers: toValue(options.transformers),
      });
      isReady.value = true;
    } catch (e) {
      if (!cancelled) error.value = e as Error;
    }
  })

  return { html, isReady, error };
}