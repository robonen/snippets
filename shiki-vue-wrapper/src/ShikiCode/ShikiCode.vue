<script setup lang="ts">
import { computed } from 'vue'
import type { ShikiTransformer } from 'shiki/core'
import { useShikiHighlight } from './useShikiHighlight'

const props = withDefaults(
  defineProps<{
    code: string
    lang?: string
    theme?: string
    themes?: { light: string; dark: string }
    transformers?: ShikiTransformer[]
    lineNumbers?: boolean
    startLine?: number
  }>(),
  { lang: 'javascript', lineNumbers: false, startLine: 1 },
);

const { html, isReady, error } = useShikiHighlight({
  code: () => props.code,
  lang: () => props.lang,
  theme: () => props.theme,
  themes: () => props.themes,
  transformers: () => props.transformers,
})

const gutterStyle = computed(() => {
  const total = props.startLine + props.code.split('\n').length - 1;
  return {
    '--shiki-line-start': String(props.startLine),
    '--shiki-gutter-width': `${String(total).length}ch`,
  };
});
</script>

<template>
  <slot v-if="error" name="error" :error="error" :code="code">
    <pre class="shiki-fallback"><code>{{ code }}</code></pre>
  </slot>
  <div
    v-else-if="isReady"
    class="shiki-host"
    :data-line-numbers="lineNumbers ? '' : undefined"
    :style="gutterStyle"
    v-html="html"
  />
  <slot v-else name="loading">
    <pre class="shiki-fallback"><code>{{ code }}</code></pre>
  </slot>
</template>

<style>
.shiki-host .shiki {
  padding: 1rem;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--color-zinc-300) var(--color-zinc-950);
}

.shiki-host[data-line-numbers] .shiki code {
  counter-reset: shiki-line calc(var(--shiki-line-start, 1) - 1);
}

.shiki-host[data-line-numbers] .shiki code .line::before {
  counter-increment: shiki-line;
  content: counter(shiki-line);
  display: inline-block;
  width: var(--shiki-gutter-width, 2ch);
  margin-right: 1.25rem;
  text-align: right;
  color: color-mix(in srgb, currentColor 40%, transparent);
  user-select: none;
}

/* shiki иногда оставляет пустую финальную строку — прячем её номер */
.shiki-host[data-line-numbers] .shiki code .line:last-child:empty::before {
  content: none;
}
</style>