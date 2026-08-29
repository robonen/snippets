<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, Card, Sheet, TextField, useToast } from '@brain/ui';
import { restartSync, useSyncSettings } from '@/sync';

/**
 * Карточка «Синхронизация»: адрес личного сервера и его токен.
 *
 * Аккаунтов на сервере больше нет — он слепой пир с одним общим секретом
 * (`SYNC_TOKEN`). Подключение сервера и подключение ВТОРОГО УСТРОЙСТВА — разные
 * вещи: сервер даёт транспорт и внешнюю копию шифртекста, а доступ к данным
 * второе устройство получает на экране «Доступ» (сверка отпечатков, выдача
 * секретов — `security/pairing.ts`).
 */
const { settings, configured, live, save } = useSyncSettings();
const { show: toast } = useToast();

const open = ref(false);
const url = ref('');
const token = ref('');

function openForm(): void {
  url.value = settings.value.url;
  token.value = settings.value.token;
  open.value = true;
}

function submit(): void {
  save({ url: url.value, token: token.value });
  open.value = false;
  restartSync();
  // Выключатель — ТОКЕН (пустой адрес значит «тот же origin», а не «выкл»),
  // и тон честный: выключение — не успех.
  toast(configured.value
    ? { title: 'Сервер подключён', tone: 'positive' }
    : { title: 'Синхронизация выключена' });
}

function disconnect(): void {
  save({ url: '', token: '' });
  restartSync();
  open.value = false;
}

const statusText = computed(() => {
  if (!configured.value) return 'Не настроено';
  if (live.value) return 'Соединение установлено';
  return 'Связи нет — данные ждут на устройстве';
});
</script>

<template>
  <Card title="Синхронизация">
    <div class="flex flex-col gap-3">
      <p class="text-xs text-text-faint">
        Свой сервер видит ленды <strong class="font-medium text-text-soft">шифртекстом</strong>:
        полезная нагрузка каждой записи запечатана ключами, которые сервера не покидали.
      </p>

      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm text-text">{{ configured ? settings.url : 'Сервер не подключён' }}</p>
          <p class="mt-0.5 text-xs" :class="live ? 'text-success' : 'text-text-faint'">{{ statusText }}</p>
        </div>
        <Button size="sm" :tone="configured ? 'ghost' : 'primary'" @click="openForm">
          {{ configured ? 'Изменить' : 'Подключить' }}
        </Button>
      </div>
    </div>

    <Sheet
      v-model:open="open"
      title="Свой сервер"
      description="Адрес и общий секрет личного сервера синхронизации"
    >
      <form class="flex flex-col gap-3" @submit.prevent="submit">
        <TextField
          v-model="url"
          label="Адрес сервера"
          type="url"
          inputmode="url"
          placeholder="https://brain.example.com"
          autocomplete="off"
          hint="Пусто — тот же сервер, что раздал приложение"
        />
        <TextField
          v-model="token"
          label="Токен доступа"
          type="password"
          autocomplete="off"
          hint="Тот же секрет, что в SYNC_TOKEN на сервере. Пусто — синхронизация выключена"
        />
      </form>
      <template #footer>
        <div class="flex justify-between gap-2">
          <Button v-if="configured" size="sm" tone="danger" @click="disconnect">Отключить</Button>
          <div class="ml-auto flex gap-2">
            <Button size="sm" @click="open = false">Отмена</Button>
            <Button tone="primary" size="sm" @click="submit">Сохранить</Button>
          </div>
        </div>
      </template>
    </Sheet>
  </Card>
</template>
