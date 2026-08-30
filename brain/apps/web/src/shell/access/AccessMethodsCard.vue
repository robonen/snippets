<script setup lang="ts">
import { ref } from 'vue';
import { Button, Card, ConfirmDialog } from '@brain/ui';
import { Lock } from 'lucide-vue-next';
import type { WrappedDek } from '@brain/auth';
import { errorText } from '@/app/errors';
import { removeAccess, useLock } from '@/security/lock';

/**
 * Список способов доступа. Убрать способ — локальное действие: обёртка
 * мастера стирается из localStorage ЭТОГО устройства. Честная граница — в
 * тексте диалога: снятая заранее копия обёртки продолжила бы подходить.
 */

const { access: wraps } = useLock();

/** Техметка passkey бывает длинной и человеку ничего не говорит. */
function displayLabel(wrap: WrappedDek): string {
  return wrap.kind === 'passkey' && wrap.label.length > 20 ? 'Passkey' : wrap.label;
}

const target = ref<WrappedDek | null>(null);
const dialogOpen = ref(false);
const error = ref('');

function ask(wrap: WrappedDek): void {
  error.value = '';
  target.value = wrap;
  dialogOpen.value = true;
}

function remove(): void {
  if (target.value === null) return;
  try {
    removeAccess(target.value.label);
  }
  catch (caught) {
    error.value = errorText(caught, 'не получилось убрать способ доступа');
  }
  target.value = null;
}
</script>

<template>
  <Card title="Способы доступа">
    <ul class="flex flex-col divide-y divide-line">
      <li
        v-for="wrap in wraps"
        :key="wrap.label"
        class="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
      >
        <Lock class="size-4 shrink-0 text-text-faint" />
        <span class="min-w-0 flex-1 truncate text-sm text-text">{{ displayLabel(wrap) }}</span>
        <span class="shrink-0 text-xs text-text-faint">
          {{ wrap.kind === 'passkey' ? 'passkey' : 'фраза' }}
        </span>
        <Button v-if="wraps.length > 1" tone="danger" size="sm" @click="ask(wrap)">
          Убрать
        </Button>
      </li>
    </ul>
    <p v-if="error" role="alert" class="mt-2 text-xs text-danger">{{ error }}</p>
    <p class="mt-3 text-xs text-text-faint">
      Убрать последний способ нельзя: данные стали бы недоступны навсегда.
    </p>

    <ConfirmDialog
      v-if="target !== null"
      v-model:open="dialogOpen"
      title="Убрать способ доступа?"
      :description="`Обёртка «${displayLabel(target)}» будет стёрта с этого устройства. `
        + 'Если её копию сняли раньше вместе с самим способом — это компрометация, '
        + 'и правильный ответ на неё: отозвать устройство, а не убрать способ.'"
      confirm-label="Убрать"
      @confirm="remove"
    />
  </Card>
</template>
