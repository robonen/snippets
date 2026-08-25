<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Combobox } from '@brain/ui';
import type { ComboboxOption } from '@brain/ui';
import type { TagCount } from '../../entities/tags';
import { addTag, removeTag } from '../../lib/tags';
import TagChip from '../TagChip.vue';

/**
 * Теги заметки: подсказка по уже заведённым и заведение нового.
 *
 * Комбобокс здесь — способ ДОБАВИТЬ тег, а не выбрать один: собственного
 * значения у поля нет, и сразу после добавления оно снова пустое. Иначе поле
 * показывало бы «работа», когда на заметке уже три тега, и врало бы про то,
 * что выбрано.
 *
 * Строка через запятую, которая была здесь раньше, отвечала на «как записать
 * теги», но не на «какие теги вообще есть»: человек набирал «идеи» рядом с
 * «идея» и делил заметки надвое, ничего не заметив.
 */
const { known } = defineProps<{
  /** Теги, уже встречавшиеся в других заметках, с числом заметок на каждом. */
  known: readonly TagCount[];
}>();

const tags = defineModel<readonly string[]>({ required: true });

const picked = ref<string | undefined>();

// Уже надетые теги из подсказки убираются: предлагать добавить то, что видно
// фишкой строкой выше, — это предлагать нажать вхолостую.
const options = computed<ComboboxOption[]>(() => known
  .filter(item => !tags.value.includes(item.tag))
  .map(item => ({ value: item.tag, label: item.tag, hint: String(item.count) })));

watch(picked, (tag) => {
  if (tag === undefined) return;
  tags.value = addTag(tags.value, tag);
  picked.value = undefined;
});

function create(title: string): void {
  tags.value = addTag(tags.value, title);
}

function drop(tag: string): void {
  tags.value = removeTag(tags.value, tag);
}
</script>

<template>
  <!-- Надетые теги идут ПЕРЕД полем: в шапке заметки они — часть её выходных
       данных, и читаются сразу под заголовком, а поле остаётся тем, чем оно и
       является, — способом добавить ещё один. -->
  <div class="flex flex-col gap-2">
    <div v-if="tags.length > 0" class="flex flex-wrap items-center gap-1.5">
      <TagChip v-for="tag in tags" :key="tag" :tag="tag" @remove="drop(tag)" />
    </div>

    <Combobox
      v-model="picked"
      label="Теги"
      :options="options"
      placeholder="Найти тег или завести новый"
      empty-text="Таких тегов ещё нет"
      allow-create
      @create="create"
    />
  </div>
</template>
