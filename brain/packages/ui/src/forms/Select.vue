<script setup lang="ts">
import { computed, useId } from 'vue';
import {
  Label,
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from '@robonen/primitives';
import { Check, ChevronDown } from 'lucide-vue-next';

/**
 * Выбор одного значения из готового списка.
 *
 * Всё, что делает список списком, — на примитивах: `role="listbox"`, стрелки,
 * Home/End, поиск набором первых букв, возврат фокуса на триггер после
 * закрытия, `aria-activedescendant`. Здесь — оформление и та же обвязка поля,
 * что у {@link TextField}: подпись через `for`, подсказка и ошибка через
 * `aria-describedby`, чтобы форма читалась одинаково независимо от типа поля.
 */
export interface SelectOption {
  /** Пустая строка запрещена примитивом: она неотличима от «не выбрано». */
  readonly value: string;
  readonly label: string;
  /** Правая приписка: единица, пояснение, «по умолчанию». */
  readonly hint?: string;
  readonly disabled?: boolean;
}

const {
  label,
  hint,
  error,
  placeholder = 'Не выбрано',
  required = false,
  disabled = false,
} = defineProps<{
  label: string;
  options: readonly SelectOption[];
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}>();

const value = defineModel<string | undefined>();

const id = useId();
const hintId = `${id}-hint`;
const errorId = `${id}-error`;

const describedBy = computed(() => {
  const parts: string[] = [];
  if (hint !== undefined && hint !== '') parts.push(hintId);
  if (error !== undefined && error !== '') parts.push(errorId);
  return parts.length > 0 ? parts.join(' ') : undefined;
});

// Примитив отдаёт значение как `AcceptableValue` — он умеет и объекты. Обёртка
// сознательно сужена до строк: у списка настроек ключ всегда строковый, и
// сужение здесь дешевле, чем дженерик по всей форме.
function onChange(next: unknown): void {
  value.value = typeof next === 'string' ? next : undefined;
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label :for="id" class="text-[0.8125rem] font-medium text-text-soft">
      {{ label }}
      <span v-if="required" aria-hidden="true" class="text-danger">*</span>
    </Label>

    <SelectRoot
      :model-value="value"
      :disabled="disabled"
      :required="required"
      @update:model-value="onChange"
    >
      <SelectTrigger
        :id="id"
        :aria-invalid="error ? true : undefined"
        :aria-describedby="describedBy"
        class="pressable flex h-10 w-full items-center justify-between gap-2 rounded-control border bg-surface
               px-3 text-sm text-text disabled:pointer-events-none disabled:opacity-45
               data-[placeholder]:text-text-faint"
        :class="error ? 'border-danger' : 'border-line hover:border-line-strong'"
      >
        <SelectValue :placeholder="placeholder" class="truncate" />
        <SelectIcon class="shrink-0 text-text-faint">
          <ChevronDown class="size-4" />
        </SelectIcon>
      </SelectTrigger>

      <SelectPortal>
        <SelectContent
          position="popper"
          :side-offset="6"
          class="glass z-50 max-h-[min(20rem,var(--primitives-select-content-available-height))]
                 w-[var(--popper-anchor-width)] origin-(--primitives-select-content-transform-origin)
                 overflow-hidden rounded-control border shadow-float
                 data-[state=open]:animate-[scale-in_var(--duration-menu)_var(--ease-out)]
                 data-[state=open]:motion-reduce:animate-[fade-in_var(--duration-hint)_var(--ease-out)]"
        >
          <SelectViewport class="max-h-[inherit] overflow-y-auto p-1">
            <SelectItem
              v-for="option in options"
              :key="option.value"
              :value="option.value"
              :disabled="option.disabled"
              class="flex cursor-pointer items-center gap-2 rounded-control px-2.5 py-2 text-sm text-text
                     data-[disabled]:pointer-events-none data-[disabled]:opacity-45
                     data-[highlighted]:bg-sunken data-[highlighted]:outline-none"
            >
              <SelectItemText class="min-w-0 flex-1 truncate">{{ option.label }}</SelectItemText>
              <span v-if="option.hint" class="shrink-0 text-xs text-text-faint">{{ option.hint }}</span>
              <SelectItemIndicator class="shrink-0 text-accent">
                <Check class="size-4" />
              </SelectItemIndicator>
            </SelectItem>
          </SelectViewport>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>

    <p v-if="hint && !error" :id="hintId" class="text-xs text-text-faint">{{ hint }}</p>
    <p v-if="error" :id="errorId" class="text-xs text-danger">{{ error }}</p>
  </div>
</template>
