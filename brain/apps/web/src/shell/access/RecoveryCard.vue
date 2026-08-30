<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, Card, ConfirmDialog, useToast } from '@brain/ui';
import { useAction } from '@/app/action';
import { joinByPhrase } from '@/security/space';
import PhraseField from './PhraseField.vue';
import { useAccess } from './use-access';

/**
 * Восстановление фразой — запасной вход, когда приглашение получить негде
 * (все устройства потеряны). Сейф приезжает синком; фраза открывает мастер,
 * мастер — секреты. Карточка видна только устройству вне пространства.
 */

const { vaultReady, vaultStale } = useAccess();
const { show: toast } = useToast();

const phrase = ref('');
const confirmOpen = ref(false);

const join = useAction(async () => {
  await joinByPhrase(phrase.value);
  phrase.value = '';
  toast({ title: 'Устройство подключено', description: 'Данные пространства едут с сервера.', tone: 'positive' });
}, 'не получилось подключиться фразой');

const ready = computed(() => phrase.value.trim() !== '' && vaultReady.value);
</script>

<template>
  <Card title="Восстановление фразой">
    <div class="flex flex-col gap-2">
      <p class="text-xs text-text-faint">
        Нет устройства, с которого можно пригласить? Введите фразу
        восстановления — данные вернутся с сервера, местные заготовки будут
        заменены.
      </p>
      <PhraseField v-model="phrase" />
      <p v-if="vaultStale" class="text-xs text-warning">
        Сейф пространства рассинхронизирован. Откройте основное устройство —
        оно перепубликует сейф.
      </p>
      <p v-else-if="!vaultReady" class="text-xs text-warning">
        Фразовый вход ещё не приехал с сервера — проверьте синхронизацию в
        Настройках.
      </p>
      <p v-if="join.error.value" role="alert" class="text-xs text-danger">{{ join.error.value }}</p>
      <div class="flex justify-end">
        <Button
          tone="primary"
          size="sm"
          :disabled="!ready"
          :loading="join.busy.value"
          @click="confirmOpen = true"
        >
          Восстановить
        </Button>
      </div>
    </div>

    <ConfirmDialog
      v-model:open="confirmOpen"
      title="Восстановить доступ фразой?"
      description="Местные данные этого устройства будут заменены данными пространства. Всё, что вы успели записать здесь, будет стёрто."
      confirm-label="Восстановить"
      @confirm="join.run()"
    />
  </Card>
</template>
