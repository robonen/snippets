<script setup lang="ts">
import { shallowRef } from 'vue';
import { useForm } from '@robonen/vue';
import { ExternalLink, Plus, X } from 'lucide-vue-next';
import { Button, Card, TextField } from '@brain/ui';
import type { Resource } from '../../entities/project';
import { newId } from '../../lib/id';

/**
 * Ссылки проекта: репозиторий, прод, макеты, документы.
 *
 * Без названия ссылка подписывается хостом: «github.com» на строке лучше, чем
 * адрес на восемьдесят знаков, и вводить название ради каждой ссылки не
 * обязательно.
 */
const { links } = defineProps<{ links: Resource[] }>();

const emit = defineEmits<{ update: [links: Resource[]] }>();

interface LinkValues {
  url: string;
  title: string;
}

function parse(raw: string): URL | null {
  const text = raw.trim();
  if (text === '') return null;
  try {
    return new URL(/^[a-z]+:\/\//iu.test(text) ? text : `https://${text}`);
  }
  catch {
    return null;
  }
}

function check(values: LinkValues): { values: LinkValues; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  if (parse(values.url) === null) errors['url'] = ['Не похоже на адрес'];
  return { values, errors };
}

const adding = shallowRef(false);
const form = useForm<LinkValues>({ initialValues: { url: '', title: '' }, resolver: check });
const [url] = form.defineField('url');
const [title] = form.defineField('title');

function reset(): void {
  form.resetForm({ values: { url: '', title: '' } });
  adding.value = false;
}

const submit = form.handleSubmit((values) => {
  const parsed = parse(values.url);
  if (parsed === null) return;
  emit('update', [...links, {
    id: newId(),
    title: values.title.trim() || parsed.hostname.replace(/^www\./u, ''),
    url: parsed.href,
    addedAt: Date.now(),
  }]);
  reset();
});

function drop(id: string): void {
  emit('update', links.filter(link => link.id !== id));
}

function hostOf(link: Resource): string {
  try {
    return new URL(link.url).hostname.replace(/^www\./u, '');
  }
  catch {
    return link.url;
  }
}
</script>

<template>
  <Card title="Ссылки">
    <template #action>
      <Button v-if="!adding" tone="ghost" size="sm" @click="adding = true">
        <Plus class="size-4" />
        Ссылка
      </Button>
    </template>

    <ul v-if="links.length > 0" class="flex flex-col divide-y divide-line">
      <li v-for="link in links" :key="link.id" class="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
        <a
          :href="link.url"
          target="_blank"
          rel="noreferrer noopener"
          class="flex min-w-0 flex-1 items-center gap-2 text-sm text-text hover:text-accent"
        >
          <ExternalLink class="size-3.5 shrink-0 text-text-faint" />
          <span class="truncate">{{ link.title }}</span>
          <span v-if="hostOf(link) !== link.title" class="truncate text-xs text-text-faint">{{ hostOf(link) }}</span>
        </a>
        <button
          type="button"
          :aria-label="`Убрать ссылку ${link.title}`"
          class="pressable grid size-8 shrink-0 place-items-center rounded-control text-text-faint hover:bg-sunken hover:text-text"
          @click="drop(link.id)"
        >
          <X class="size-4" />
        </button>
      </li>
    </ul>
    <p v-else-if="!adding" class="text-xs text-text-faint">Репозиторий, прод, макеты, договор — всё, куда возвращаетесь.</p>

    <form
      v-if="adding"
      class="mt-3 flex flex-col gap-2.5 border-t border-line pt-3 first:mt-0 first:border-t-0 first:pt-0"
      novalidate
      @submit.prevent="submit"
    >
      <TextField
        v-model="url"
        label="Адрес"
        type="url"
        inputmode="url"
        placeholder="github.com/robonen/…"
        autocomplete="off"
        required
        :error="form.getError('url')"
      />
      <TextField v-model="title" label="Название" :placeholder="parse(url)?.hostname ?? 'возьмём из адреса'" autocomplete="off" />
      <div class="flex items-center gap-2">
        <Button type="submit" tone="primary" size="sm">Добавить</Button>
        <Button tone="ghost" size="sm" @click="reset">Отмена</Button>
      </div>
    </form>
  </Card>
</template>
