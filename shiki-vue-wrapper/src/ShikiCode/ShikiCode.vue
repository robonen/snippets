<script setup lang="ts">
import { computed } from 'vue'
import type { ShikiTransformer } from 'shiki/core'
import { useShikiHighlight } from './useShikiHighlight'
import './shiki-host.css'

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