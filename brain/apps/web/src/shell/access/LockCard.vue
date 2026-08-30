<script setup lang="ts">
import { Button, Card, SwitchField, useToast } from '@brain/ui';
import { Lock } from 'lucide-vue-next';
import { useAction } from '@/app/action';
import { setGuarded, useLock } from '@/security/lock';

/**
 * Замок — выбор, а не принуждение (docs/01-security.md §5): тумблер убирает
 * или возвращает тихий ключ устройства. Карточка показывается только с
 * настроенным доступом: иначе замок захлопнулся бы перед человеком без ключа.
 */

const { guarded, lock } = useLock();
const { show: toast } = useToast();

const toggle = useAction(async (on: boolean) => {
  await setGuarded(on);
  toast(on
    ? { title: 'Замок включён', description: 'Вход — по passkey или фразе на каждом запуске.', tone: 'positive' }
    : { title: 'Замок выключен', description: 'Приложение будет открываться сразу.' });
}, 'не получилось переключить замок');
</script>

<template>
  <Card title="Замок приложения">
    <SwitchField
      :model-value="guarded"
      label="Запирать приложение"
      description="Вход по passkey или фразе на каждом запуске и после отлучки.
        Выключено — открывается сразу: данные на диске всё равно зашифрованы,
        но ключ хранит сам браузер."
      @update:model-value="toggle.run"
    />
    <p v-if="toggle.error.value" role="alert" class="mt-2 text-xs text-danger">{{ toggle.error.value }}</p>
    <div v-if="guarded" class="mt-1 flex items-center gap-3 border-t border-line pt-3">
      <Lock class="size-4 shrink-0 text-text-faint" />
      <p class="min-w-0 flex-1 text-sm text-text-soft">
        Запереть сейчас: расшифрованные данные уйдут из памяти вкладки.
      </p>
      <Button size="sm" @click="lock">Заблокировать</Button>
    </div>
  </Card>
</template>
