<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRegistry } from '@brain/module-kit';
import {
  Badge,
  Button,
  ConfirmDialog,
  Disclosure,
  EmptyState,
  ListRow,
  Menu,
  Page,
  PageHeader,
  Tabs,
  useToast,
} from '@brain/ui';
import type { MenuAction, Tab } from '@brain/ui';
import { useInbox, useInboxActions } from '../db/inbox';
import type { InboxItem } from '../db/meta';
import { Check, Inbox, Plus } from 'lucide-vue-next';

/**
 * Инбокс: сюда падает захваченное, отсюда оно расходится по модулям.
 *
 * Разбор — не «переложить в папку», а «решить, чем это станет». Поэтому
 * действия строятся из реестра: модуль, объявивший команды, появляется в меню
 * сам, без правки этого экрана.
 */
const registry = useRegistry();
const { pending, filed } = useInbox();
const actions = useInboxActions();
const toast = useToast();

const draft = ref('');
const tab = ref('pending');
const removing = ref<InboxItem | null>(null);

const tabs = computed<Tab[]>(() => [
  { value: 'pending', label: 'На разбор', badge: pending.value.length || undefined },
  { value: 'filed', label: 'Разобрано', badge: filed.value.length || undefined },
]);

// Разобрать можно в тот модуль, который объявил хоть одну команду: команда и
// есть его способ сказать «я умею принимать захваченное».
const targets = computed(() => registry.modules.filter(module => (module.commands?.length ?? 0) > 0));

function menuFor(item: InboxItem): MenuAction[] {
  return [
    ...targets.value.map(module => ({
      id: `file:${module.id}`,
      title: `В «${module.title}»`,
      onSelect: () => {
        actions.file(item.id, module.id);
        toast.show({
          title: `Отправлено в «${module.title}»`,
          action: {
            label: 'Отменить',
            altText: 'Вернуть запись в инбокс',
            onAction: () => { actions.unfile(item.id); },
          },
        });
      },
    })),
    {
      id: 'remove',
      title: 'Удалить',
      danger: true,
      onSelect: () => { removing.value = item; },
    },
  ];
}

function capture(): void {
  if (actions.capture({ text: draft.value }) !== null) draft.value = '';
}

/**
 * Удаление подтверждается, а не откатывается тостом: в CRDT удаление
 * необратимо, и «Отменить» здесь было бы обещанием, которого не сдержать.
 */
function confirmRemove(): void {
  const item = removing.value;
  if (item === null) return;
  actions.remove(item.id);
  removing.value = null;
  toast.show({ title: 'Удалено' });
}
</script>

<template>
  <Page width="list">
    <PageHeader
      title="Инбокс"
      :subtitle="pending.length > 0 ? 'решите, чем это станет' : 'разобрано до нуля'"
    />

    <form class="mb-4 flex gap-2" @submit.prevent="capture">
      <input
        v-model="draft"
        type="text"
        placeholder="Мысль, ссылка, что угодно"
        aria-label="Что захватить"
        class="h-10 flex-1 rounded-control border border-line bg-surface px-3 text-sm text-text
               transition-colors placeholder:text-text-faint hover:border-line-strong"
      >
      <Button tone="primary" type="submit" :disabled="draft.trim() === ''">
        <Plus class="size-4" />
        Захватить
      </Button>
    </form>

    <Tabs v-model="tab" :items="tabs" label="Состояние записей" class="mb-3">
      <template #pending>
      <EmptyState
        v-if="pending.length === 0"
        title="Инбокс пуст"
        description="Кидайте сюда всё, что приходит в голову, — решать, чем это станет, можно потом."
      />

      <ul v-else class="flex flex-col rounded-card border border-line bg-surface p-1">
        <li v-for="item in pending" :key="item.id">
          <ListRow :title="item.text || (item.url ?? '')" :subtitle="item.source">
            <template #icon>
              <Inbox class="size-4" />
            </template>
            <template #action>
              <Menu :items="menuFor(item)" label="Что сделать с записью" />
            </template>
          </ListRow>

          <Disclosure v-if="item.url" title="Ссылка" class="px-2 pb-2">
            <a
              :href="item.url"
              target="_blank"
              rel="noreferrer noopener"
              class="text-xs wrap-anywhere text-accent hover:underline"
            >{{ item.url }}</a>
          </Disclosure>
        </li>
      </ul>
      </template>

      <template #filed>
      <EmptyState
        v-if="filed.length === 0"
        title="Разобранного нет"
        description="Здесь остаётся то, что вы уже отправили в модули: связь пригодится в обзоре недели."
      />

      <ul v-else class="flex flex-col rounded-card border border-line bg-surface p-1">
        <li v-for="item in filed" :key="item.id">
          <ListRow :title="item.text || (item.url ?? '')" :subtitle="item.source">
            <template #icon>
              <Check class="size-4 text-positive" />
            </template>
            <template #action>
              <div class="flex items-center gap-2">
                <Badge>{{ item.filedTo }}</Badge>
                <Button size="sm" tone="ghost" @click="actions.unfile(item.id)">Вернуть</Button>
              </div>
            </template>
          </ListRow>
        </li>
        </ul>
      </template>
    </Tabs>

    <ConfirmDialog
      :open="removing !== null"
      title="Удалить запись?"
      description="Удаление в local-first хранилище необратимо — вернуть её будет нечем."
      confirm-label="Удалить"
      tone="danger"
      @update:open="value => { if (!value) removing = null; }"
      @confirm="confirmRemove"
    />
  </Page>
</template>
