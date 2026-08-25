<script setup lang="ts">
import { computed, ref, shallowRef, useId, watch } from 'vue';
import { X } from 'lucide-vue-next';
import { Badge, Button, Combobox, Disclosure, SegmentedControl, Sheet, TextField } from '@brain/ui';
import type { ComboboxOption, Segment } from '@brain/ui';
import { LINK_STATUSES, STATUS_LABELS, draftLink, withStatus } from '../../entities/link';
import type { Bookmark, LinkStatus } from '../../entities/link';
import { parseTags } from '../../lib/tags';
import { parseUrl } from '../../lib/url';
import { newId } from '../../lib/id';
import { readingLabel } from '../../lib/reading';

/**
 * Форма закладки: добавление и правка одним листом.
 *
 * Разница между ними — только в том, откуда взялись начальные значения и чей
 * id уедет в хранилище; поля, разбор адреса и проверки одни и те же, и вторая
 * форма означала бы две расходящиеся копии этих проверок.
 */
const { link, knownTags } = defineProps<{
  link?: Bookmark;
  /** Теги, уже встречавшиеся в каталоге: их предлагает выпадающий список. */
  knownTags: readonly ComboboxOption[];
}>();

const emit = defineEmits<{ save: [link: Bookmark] }>();

const open = defineModel<boolean>('open', { default: false });

const noteId = useId();

const url = ref('');
const title = ref('');
const note = ref('');
/** Список тегов всегда заменяется целиком — глубокий реф ему не нужен. */
const tags = shallowRef<string[]>([]);
const status = ref<LinkStatus>('unread');
/** Модель списка тегов: значение живёт до попадания тега в чипсы. */
const pick = ref<string | undefined>();
const noteOpen = shallowRef(false);

const STATUS_SEGMENTS: Array<Segment<LinkStatus>> = LINK_STATUSES.map(item => ({
  value: item,
  label: STATUS_LABELS[item],
}));

// Начальные значения ставятся на ОТКРЫТИИ, а не на смене пропа: лист живёт в
// дереве постоянно, и сброс по `link` затирал бы наполовину заполненную форму.
watch(open, (isOpen) => {
  if (!isOpen) return;
  url.value = link?.url ?? '';
  title.value = link?.title ?? '';
  note.value = link?.note ?? '';
  tags.value = [...(link?.tags ?? [])];
  status.value = link?.status ?? 'unread';
  pick.value = undefined;
  // Заметка раскрыта только там, где она есть: пустое поле на три строки
  // отодвигает кнопку сохранения, ничего не показывая.
  noteOpen.value = (link?.note ?? '') !== '';
});

// Выбранный тег уезжает в чипсы, а поле освобождается под следующий.
watch(pick, (value) => {
  if (value !== undefined) addTag(value);
});

const parsed = computed(() => parseUrl(url.value));
const dirty = computed(() => url.value.trim() !== '');
const error = computed(() => (dirty.value && parsed.value === null ? 'Не похоже на адрес страницы' : undefined));

/** Список предлагает только то, чего на закладке ещё нет. */
const options = computed(() => knownTags.filter(option => !tags.value.includes(option.value)));

/** Оценка чтения считается по тому, что уже набрано: она меняется вместе с заметкой. */
const estimate = computed(() => readingLabel({ title: title.value || (parsed.value?.title ?? ''), note: note.value }));

/**
 * Добавить тег из списка или из строки поиска. Строка разбирается целиком:
 * «vue, чтение» — привычный способ ввести теги, и заводить один тег с запятой
 * внутри значило бы поймать пользователя на его же привычке.
 *
 * Нормализация здесь, а не только на сохранении: «#Vue» и «vue» обязаны
 * схлопнуться до того, как превратятся в два разных чипса.
 */
function addTag(raw: string): void {
  const added = parseTags(raw).filter(tag => !tags.value.includes(tag));
  if (added.length > 0) tags.value = [...tags.value, ...added];
  pick.value = undefined;
}

function dropTag(tag: string): void {
  tags.value = tags.value.filter(item => item !== tag);
}

function submit(): void {
  const now = Date.now();
  const draft = draftLink(
    { url: url.value, title: title.value, note: note.value, tags: tags.value },
    link?.id ?? newId(),
    now,
  );
  if (draft === null) return;

  // Правка сохраняет исходные метки: закладка не «добавлена заново» оттого, что
  // ей поправили заголовок. Статус доводится `withStatus` — он же решает судьбу
  // даты дочитывания при возврате в «читаю».
  const kept: Bookmark = link === undefined
    ? draft
    : { ...draft, addedAt: link.addedAt, ...(link.readAt !== undefined && { readAt: link.readAt }) };

  emit('save', withStatus(kept, status.value, now));
  open.value = false;
}
</script>

<template>
  <Sheet
    v-model:open="open"
    :title="link ? 'Правка закладки' : 'Новая закладка'"
    :description="parsed?.domain"
  >
    <form class="flex flex-col gap-3.5" @submit.prevent="submit">
      <TextField
        v-model="url"
        label="Адрес"
        type="url"
        inputmode="url"
        placeholder="example.com/статья"
        :error="error"
        required
      />
      <TextField
        v-model="title"
        label="Заголовок"
        :placeholder="parsed?.title ?? 'возьмём из адреса'"
        hint="Пусто — подставим то, что видно в адресе."
      />

      <SegmentedControl v-model="status" label="Статус чтения" :segments="STATUS_SEGMENTS" />

      <div class="flex flex-col gap-2">
        <Combobox
          v-model="pick"
          label="Теги"
          :options="options"
          placeholder="vue, чтение"
          empty-text="Такого тега ещё нет"
          allow-create
          @create="addTag"
        />

        <div v-if="tags.length > 0" class="flex flex-wrap gap-1.5">
          <button
            v-for="tag in tags"
            :key="tag"
            type="button"
            :aria-label="`Убрать тег ${tag}`"
            class="pressable rounded-full"
            @click="dropTag(tag)"
          >
            <Badge tone="accent">
              {{ `#${tag}` }}
              <X class="size-3" />
            </Badge>
          </button>
        </div>
      </div>

      <!-- Заметка спрятана под раскрывашку: её пишут не всегда, а поле на три
           строки посреди формы отодвигает всё остальное вниз. -->
      <Disclosure v-model:open="noteOpen" title="Заметка" :hint="estimate">
        <label :for="noteId" class="sr-only">Заметка к ссылке</label>
        <textarea
          :id="noteId"
          v-model="note"
          rows="4"
          placeholder="зачем сохранил и что здесь важное"
          class="w-full resize-y rounded-control border border-line bg-surface px-3 py-2 text-sm leading-relaxed
                 text-text transition-colors placeholder:text-text-faint hover:border-line-strong
                 focus:border-line-strong focus:outline-none"
        />
        <p class="mt-1.5 text-xs text-text-faint">
          По длине заголовка и заметки прикидываем время чтения — оно стоит в строке списка.
        </p>
      </Disclosure>

      <!-- Скрытая кнопка: Enter в поле обязан отправлять форму, а видимая
           кнопка отправки живёт в подвале листа, вне <form>. -->
      <button type="submit" class="sr-only" tabindex="-1">Сохранить</button>
    </form>

    <template #footer>
      <Button tone="primary" block :disabled="parsed === null" @click="submit">
        {{ link ? 'Сохранить' : 'Добавить' }}
      </Button>
    </template>
  </Sheet>
</template>
