<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
  Label,
} from '@robonen/primitives';
import type { ComboboxItemSelectEvent } from '@robonen/primitives';
import { Check, ChevronDown, Plus } from 'lucide-vue-next';

/**
 * Поиск по списку с возможностью создать недостающее — теги, продукты,
 * категории.
 *
 * «Создать» — не отдельная кнопка под списком, а обычный пункт списка с
 * особым значением. Так он попадает под те же стрелки и Enter, что и остальные
 * варианты: пользователю не нужно знать, что этого значения ещё нет, чтобы
 * переключиться на другой способ ввода. Пункт снабжён `textValue` равным
 * запросу — встроенный фильтр ищет вхождение подстроки, и строка всегда
 * содержит саму себя, поэтому пункт не отфильтруется.
 */
export interface ComboboxOption {
  readonly value: string;
  readonly label: string;
  /** Правая приписка: количество, категория, единица. */
  readonly hint?: string;
  readonly disabled?: boolean;
}

const {
  label,
  options,
  placeholder = 'Начните вводить…',
  emptyText = 'Ничего не нашлось',
  allowCreate = false,
  disabled = false,
} = defineProps<{
  label: string;
  options: readonly ComboboxOption[];
  placeholder?: string;
  /** Что показать, когда фильтр ничего не оставил и создавать нечего. */
  emptyText?: string;
  /** Разрешить пункт «Создать …» для запроса без совпадений. */
  allowCreate?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  /** Пользователь просит завести новое значение с таким названием. */
  create: [title: string];
}>();

const value = defineModel<string | undefined>();

const id = useId();
const open = ref(false);
const search = ref('');

// Значение-метка для пункта «создать». Объект, а не строка: строка совпала бы
// с настоящим вариантом ровно в тот момент, когда он уже существует.
const CREATE_VALUE = { create: true } as const;

const trimmed = computed(() => search.value.trim());

// Создавать нечего, если запрос пуст или уже есть вариант с тем же названием:
// иначе список предлагал бы завести дубликат того, что видно строкой выше.
const canCreate = computed(() => {
  if (!allowCreate || trimmed.value === '') return false;
  const needle = trimmed.value.toLowerCase();
  return !options.some(option => option.label.trim().toLowerCase() === needle);
});

// Поле показывает НАЗВАНИЕ выбранного варианта, а не его значение: значение —
// это id, и увидеть его в поле ввода пользователю незачем. Функция объявлена
// один раз, а не литералом в шаблоне: новая функция на каждый рендер меняла бы
// проп и заставляла примитив пересчитывать отображение впустую.
function displayValue(): string {
  return options.find(option => option.value === value.value)?.label ?? '';
}

function onChange(next: unknown): void {
  value.value = typeof next === 'string' ? next : undefined;
}

function onSearch(event: Event): void {
  search.value = (event.target as HTMLInputElement).value;
}

// Запрос примитив хранит у себя и сам сбрасывает при выборе и при потере
// фокуса; наша копия нужна только ради пункта «создать» и обязана следовать за
// ним. Иначе после выбора варианта в закрытом списке остался бы старый запрос,
// и следующее открытие показало бы «Создать „…“» для того, что уже выбрано.
watch(open, (isOpen) => {
  if (!isOpen) search.value = '';
});

// Пункт «создать» не должен становиться значением модели: наружу уходит только
// название, а решение — заводить ли запись и с каким id — принимает вызывающий.
// `preventDefault` отменяет запись значения, но и закрытие списка вместе с ней,
// поэтому закрываем вручную.
function onCreate(event: ComboboxItemSelectEvent): void {
  event.preventDefault();
  emit('create', trimmed.value);
  open.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label :for="id" class="text-[0.8125rem] font-medium text-text-soft">{{ label }}</Label>

    <ComboboxRoot
      v-model:open="open"
      :model-value="value"
      :disabled="disabled"
      :display-value="displayValue"
      open-on-click
      @update:model-value="onChange"
    >
      <ComboboxAnchor
        class="flex h-10 w-full items-center gap-1 rounded-control border border-line bg-surface pr-1 pl-3
               transition-colors focus-within:border-line-strong hover:border-line-strong"
      >
        <ComboboxInput
          :id="id"
          :placeholder="placeholder"
          :disabled="disabled"
          class="min-w-0 flex-1 bg-transparent text-sm text-text outline-none
                 placeholder:text-text-faint disabled:opacity-45"
          @input="onSearch"
        />
        <ComboboxTrigger
          aria-label="Показать варианты"
          class="pressable shrink-0 rounded-control p-1.5 text-text-faint hover:text-text"
        >
          <ChevronDown class="size-4" />
        </ComboboxTrigger>
      </ComboboxAnchor>

      <ComboboxPortal>
        <!-- `Combobox` — единственный из списков, который не заводит своих
             псевдонимов и отдаёт сырые переменные поппера. Отсюда `--popper-*`
             без приставки, тогда как у `Select` рядом — `--primitives-select-*`. -->
        <ComboboxContent
          position="popper"
          :side-offset="6"
          class="glass z-50 max-h-[min(18rem,var(--popper-available-height))] w-[var(--popper-anchor-width)]
                 origin-(--popper-transform-origin) overflow-hidden rounded-control border shadow-float
                 data-[state=open]:animate-[scale-in_var(--duration-menu)_var(--ease-out)]
                 data-[state=open]:motion-reduce:animate-[fade-in_var(--duration-hint)_var(--ease-out)]"
        >
          <ComboboxViewport class="max-h-[inherit] overflow-y-auto p-1">
            <ComboboxItem
              v-for="option in options"
              :key="option.value"
              :value="option.value"
              :text-value="option.label"
              :disabled="option.disabled"
              class="flex cursor-pointer items-center gap-2 rounded-control px-2.5 py-2 text-sm text-text
                     data-[disabled]:pointer-events-none data-[disabled]:opacity-45
                     data-[highlighted]:bg-sunken data-[highlighted]:outline-none"
            >
              <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
              <span v-if="option.hint" class="shrink-0 text-xs text-text-faint">{{ option.hint }}</span>
              <ComboboxItemIndicator class="shrink-0 text-accent">
                <Check class="size-4" />
              </ComboboxItemIndicator>
            </ComboboxItem>

            <ComboboxItem
              v-if="canCreate"
              :value="CREATE_VALUE"
              :text-value="trimmed"
              class="flex cursor-pointer items-center gap-2 rounded-control px-2.5 py-2 text-sm text-accent
                     data-[highlighted]:bg-sunken data-[highlighted]:outline-none"
              @select="onCreate"
            >
              <Plus class="size-4 shrink-0" />
              <span class="min-w-0 flex-1 truncate">{{ `Создать «${trimmed}»` }}</span>
            </ComboboxItem>
          </ComboboxViewport>

          <ComboboxEmpty v-if="!canCreate" class="px-3 py-6 text-center text-sm text-text-faint">
            {{ emptyText }}
          </ComboboxEmpty>
        </ComboboxContent>
      </ComboboxPortal>
    </ComboboxRoot>
  </div>
</template>
