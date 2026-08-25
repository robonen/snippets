<script setup lang="ts">
import { useId } from 'vue';
import { Label, Switch, SwitchThumb } from '@robonen/primitives';

/** Переключатель с подписью и пояснением — строка настроек. */
defineProps<{
  label: string;
  description?: string;
  disabled?: boolean;
}>();

const checked = defineModel<boolean>({ default: false });

const id = useId();
</script>

<template>
  <div class="flex items-start justify-between gap-4 py-2">
    <div class="min-w-0">
      <Label :for="id" class="text-sm text-text">{{ label }}</Label>
      <p v-if="description" class="mt-0.5 text-xs text-text-faint">{{ description }}</p>
    </div>

    <Switch
      :id="id"
      v-model="checked"
      :disabled="disabled"
      class="relative mt-0.5 inline-flex h-6 w-10 shrink-0 cursor-pointer rounded-full
             border border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-45
             data-[state=checked]:bg-accent data-[state=unchecked]:bg-line-strong"
    >
      <SwitchThumb
        class="pointer-events-none block size-5 translate-x-0.5 rounded-full bg-white shadow-sm
               transition-transform duration-(--duration-press) ease-out
               data-[state=checked]:translate-x-[1.125rem] motion-reduce:transition-none"
      />
    </Switch>
  </div>
</template>
