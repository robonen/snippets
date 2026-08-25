<script setup lang="ts">
import { useId } from 'vue';
import { CheckboxIndicator, CheckboxRoot, Label } from '@robonen/primitives';
import { Check, Minus } from 'lucide-vue-next';

/**
 * Флажок с подписью и пояснением.
 *
 * Третье состояние — не украшение: «частично» нужно там, где флажок управляет
 * группой, и показывать его как снятый значило бы предлагать снять то, что
 * частично включено. Примитив держит `aria-checked="mixed"`, здесь ему
 * соответствует чёрточка вместо галочки.
 */
defineProps<{
  label: string;
  description?: string;
  disabled?: boolean;
}>();

const checked = defineModel<boolean | 'indeterminate'>({ default: false });

const id = useId();
</script>

<template>
  <div class="flex items-start gap-3 py-2">
    <CheckboxRoot
      :id="id"
      v-model:checked="checked"
      :disabled="disabled"
      class="pressable mt-0.5 grid size-5 shrink-0 cursor-pointer place-items-center rounded-[0.375rem]
             border disabled:cursor-not-allowed disabled:opacity-45
             data-[state=checked]:border-accent data-[state=checked]:bg-accent
             data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent
             data-[state=unchecked]:border-line-strong data-[state=unchecked]:bg-surface"
    >
      <CheckboxIndicator class="grid place-items-center text-on-accent">
        <Minus v-if="checked === 'indeterminate'" class="size-3.5" />
        <Check v-else class="size-3.5" />
      </CheckboxIndicator>
    </CheckboxRoot>

    <div class="min-w-0">
      <Label :for="id" class="cursor-pointer text-sm text-text">{{ label }}</Label>
      <p v-if="description" class="mt-0.5 text-xs text-text-faint">{{ description }}</p>
    </div>
  </div>
</template>
