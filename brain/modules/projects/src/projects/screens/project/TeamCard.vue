<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { useForm } from '@robonen/vue';
import { ExternalLink, Plus, X } from 'lucide-vue-next';
import { Button, Card, Combobox, TextField } from '@brain/ui';
import type { ComboboxOption } from '@brain/ui';
import { newId } from '@brain/module-kit';
import type { Member } from '../../entities/project';

/**
 * Команда проекта: кто и в какой роли, со ссылкой на профиль.
 *
 * Имя предлагается из ДРУГИХ проектов: с одними и теми же людьми работают
 * годами, и выбранный из списка человек приносит с собой роль и ссылку с
 * прошлого раза — обычно их и надо.
 */
const { members, known } = defineProps<{
  members: Member[];
  /** Люди из остальных проектов — для подсказок. */
  known: readonly Member[];
}>();

const emit = defineEmits<{ update: [members: Member[]] }>();

interface MemberValues {
  name: string;
  role: string;
  link: string;
}

function check(values: MemberValues): { values: MemberValues; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  if (values.name.trim() === '') errors['name'] = ['Кого добавить?'];
  if (values.link.trim() !== '' && normalizeUrl(values.link) === null) errors['link'] = ['Не похоже на адрес'];
  return { values, errors };
}

/** Адрес без схемы дополняется `https://` — «github.com/robonen» набирают чаще, чем полный. */
function normalizeUrl(raw: string): string | null {
  const text = raw.trim();
  try {
    return new URL(/^[a-z]+:\/\//iu.test(text) ? text : `https://${text}`).href;
  }
  catch {
    return null;
  }
}

const adding = shallowRef(false);
const form = useForm<MemberValues>({ initialValues: { name: '', role: '', link: '' }, resolver: check });
const [role] = form.defineField('role');
const [link] = form.defineField('link');

/** Модель списка имён: выбранное или созданное имя. */
const pick = ref<string | undefined>();

const options = computed<ComboboxOption[]>(() => {
  const list: ComboboxOption[] = known
    .filter(member => !members.some(item => item.name.toLowerCase() === member.name.toLowerCase()))
    .map(member => ({ value: member.name, label: member.name, hint: member.role }));
  // Новое имя становится пунктом списка, иначе выбранным его не показать.
  const own = form.values.name;
  if (own !== '' && !list.some(option => option.value === own)) list.unshift({ value: own, label: own });
  return list;
});

// Выбранный из списка человек приносит роль и ссылку с прошлого проекта.
watch(pick, (value) => {
  if (value === undefined) return;
  form.setFieldValue('name', value);
  const found = known.find(member => member.name === value);
  if (found !== undefined) {
    form.setFieldValue('role', found.role);
    form.setFieldValue('link', found.link ?? '');
  }
});

function create(title: string): void {
  const name = title.trim();
  form.setFieldValue('name', name);
  pick.value = name;
}

function reset(): void {
  pick.value = undefined;
  form.resetForm({ values: { name: '', role: '', link: '' } });
  adding.value = false;
}

const submit = form.handleSubmit((values) => {
  const url = normalizeUrl(values.link);
  const member: Member = {
    id: newId(),
    name: values.name.trim(),
    role: values.role.trim(),
    ...(values.link.trim() !== '' && url !== null && { link: url }),
    addedAt: Date.now(),
  };
  emit('update', [...members, member]);
  reset();
});

function drop(id: string): void {
  emit('update', members.filter(member => member.id !== id));
}

function initial(member: Member): string {
  return member.name.trim().charAt(0).toUpperCase() || '?';
}
</script>

<template>
  <Card title="Команда">
    <template #action>
      <Button v-if="!adding" tone="ghost" size="sm" @click="adding = true">
        <Plus class="size-4" />
        Участник
      </Button>
    </template>

    <ul v-if="members.length > 0" class="flex flex-col divide-y divide-line">
      <li v-for="member in members" :key="member.id" class="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
        <span
          aria-hidden="true"
          class="grid size-8 shrink-0 place-items-center rounded-full bg-sunken font-mono text-xs font-medium text-text-soft"
        >
          {{ initial(member) }}
        </span>
        <span class="min-w-0 flex-1">
          <a
            v-if="member.link"
            :href="member.link"
            target="_blank"
            rel="noreferrer noopener"
            class="inline-flex max-w-full items-center gap-1 truncate text-sm text-text hover:text-accent hover:underline"
          >
            {{ member.name }}
            <ExternalLink class="size-3 shrink-0 text-text-faint" />
          </a>
          <span v-else class="block truncate text-sm text-text">{{ member.name }}</span>
          <span v-if="member.role" class="block truncate text-xs text-text-faint">{{ member.role }}</span>
        </span>
        <button
          type="button"
          :aria-label="`Убрать ${member.name} из команды`"
          class="pressable grid size-8 shrink-0 place-items-center rounded-control text-text-faint hover:bg-sunken hover:text-text"
          @click="drop(member.id)"
        >
          <X class="size-4" />
        </button>
      </li>
    </ul>
    <p v-else-if="!adding" class="text-xs text-text-faint">Кто участвовал и в какой роли — заказчик тоже считается.</p>

    <form
      v-if="adding"
      class="mt-3 flex flex-col gap-2.5 border-t border-line pt-3 first:mt-0 first:border-t-0 first:pt-0"
      novalidate
      @submit.prevent="submit"
    >
      <div class="flex flex-col gap-1">
        <Combobox
          v-model="pick"
          label="Имя"
          :options="options"
          placeholder="Рома"
          empty-text="Новый человек — нажмите «Создать»"
          allow-create
          @create="create"
        />
        <p v-if="form.getError('name')" class="text-xs text-danger">{{ form.getError('name') }}</p>
      </div>
      <div class="grid gap-2.5 sm:grid-cols-2">
        <TextField v-model="role" label="Роль" placeholder="фронтенд" autocomplete="off" />
        <TextField
          v-model="link"
          label="Ссылка"
          type="url"
          inputmode="url"
          placeholder="github.com/…"
          autocomplete="off"
          :error="form.getError('link')"
        />
      </div>
      <div class="flex items-center gap-2">
        <Button type="submit" tone="primary" size="sm">Добавить</Button>
        <Button tone="ghost" size="sm" @click="reset">Отмена</Button>
      </div>
    </form>
  </Card>
</template>
