<script setup lang="ts">
/**
 * Поле ввода фразы восстановления: многострочное, без автоподсказок — браузеру
 * нечего запоминать и нечем «поправлять» словарные слова.
 */
const model = defineModel<string>({ required: true });
</script>

<template>
  <textarea
    v-model="model"
    name="recovery-phrase"
    rows="2"
    placeholder="двенадцать слов через пробел"
    aria-label="Фраза восстановления"
    autocomplete="off"
    autocapitalize="off"
    autocorrect="off"
    spellcheck="false"
    class="glass w-full resize-none rounded-control border px-3.5 py-2.5 text-sm text-text
           transition-[border-color] placeholder:text-text-faint focus:border-accent focus:outline-none"
  />
</template>
