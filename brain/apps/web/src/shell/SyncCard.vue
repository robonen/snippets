<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, Card, Sheet, TextField, useToast } from '@brain/ui';
import { useSyncSettings } from '@/sync';
import {
  bindAccount,
  completeJoin,
  joinLogin,
  unwrapViaPasskey,
  unwrapViaPhrase,
} from '@/security/account';
import type { LoginOutcome } from '@/security/account';

/**
 * Карточка «Синхронизация»: привязка (устройство с данными становится первым
 * bound-устройством) и присоединение (свежее устройство подключается к уже
 * привязанному аккаунту) — docs/01-security.md §3/§7, план Р-4.
 *
 * Токен здесь — ПОЛЕ ФОРМЫ, не настройка: он живёт в `ref` этого компонента,
 * уходит в `bindAccount` и нигде не сохраняется (план Р2). Адрес — единственное,
 * что попадает в `sync/settings.ts`, и то не отсюда напрямую, а как побочный
 * эффект успешной привязки/присоединения (`saveSyncSettings` внутри `security/account.ts`).
 */
const { settings, configured, live } = useSyncSettings();
const { show: toast } = useToast();

const busy = ref(false);
const error = ref('');

// ── Привязка ──────────────────────────────────────────────────────────────
const bindOpen = ref(false);
const bindUrl = ref('');
const bindToken = ref('');

function openBind(): void {
  error.value = '';
  bindUrl.value = settings.value.url;
  bindToken.value = '';
  bindOpen.value = true;
}

async function submitBind(): Promise<void> {
  error.value = '';
  busy.value = true;
  try {
    const outcome = await bindAccount(bindUrl.value.trim(), bindToken.value.trim());
    bindOpen.value = false;
    bindToken.value = '';
    if (!outcome.prf) {
      toast({
        title: 'Сервер привязан',
        description: 'Этот passkey не поддерживает PRF — без фразы восстановления другое устройство '
          + 'не сможет войти. Настройте фразу в разделе «Доступ».',
        tone: 'neutral',
        duration: 10_000,
      });
    }
    else {
      toast({ title: 'Сервер привязан', tone: 'positive' });
    }
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'не удалось привязать сервер';
  }
  finally {
    busy.value = false;
  }
}

// ── Присоединение ─────────────────────────────────────────────────────────
type JoinStep = 'address' | 'phrase';

const joinOpen = ref(false);
const joinStep = ref<JoinStep>('address');
const joinUrl = ref('');
const joinPhrase = ref('');
/** Итог `joinLogin` — сессия уже есть, дальше выбираем путь к DEK. */
const pendingLogin = ref<LoginOutcome | null>(null);

function openJoin(): void {
  error.value = '';
  joinStep.value = 'address';
  joinUrl.value = settings.value.url;
  joinPhrase.value = '';
  pendingLogin.value = null;
  joinOpen.value = true;
}

async function startJoin(): Promise<void> {
  error.value = '';
  busy.value = true;
  try {
    const url = joinUrl.value.trim();
    const login = await joinLogin(url);
    // Путь (а): совпавший credential → PRF. Молчаливый `null` — путь просто
    // не подошёл (нет обёртки под этим credential'ом или PRF не отдал
    // значение), это не отказ — переходим к фразе, а не показываем ошибку.
    const viaPasskey = await unwrapViaPasskey(login);
    if (viaPasskey !== null) {
      await completeJoin(url, viaPasskey);
      joinOpen.value = false;
      toast({ title: 'Устройство присоединено', tone: 'positive' });
      return;
    }
    pendingLogin.value = login;
    joinStep.value = 'phrase';
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'не удалось присоединиться';
  }
  finally {
    busy.value = false;
  }
}

async function finishJoinByPhrase(): Promise<void> {
  if (pendingLogin.value === null) return;
  error.value = '';
  busy.value = true;
  try {
    const vault = await unwrapViaPhrase(joinPhrase.value, pendingLogin.value);
    await completeJoin(joinUrl.value.trim(), vault);
    joinOpen.value = false;
    joinPhrase.value = '';
    toast({ title: 'Устройство присоединено', tone: 'positive' });
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'фраза не подошла';
  }
  finally {
    busy.value = false;
  }
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
        Свой сервер хранит ленды <strong class="font-medium text-text-soft">шифртекстом</strong>:
        ключ остаётся на устройстве, и прочитать данные сервер не может.
      </p>

      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm text-text">{{ configured ? settings.url : 'Сервер не подключён' }}</p>
          <p class="mt-0.5 text-xs" :class="live ? 'text-success' : 'text-text-faint'">{{ statusText }}</p>
        </div>
      </div>

      <div v-if="!configured" class="flex gap-2">
        <Button size="sm" tone="primary" @click="openBind">Привязать сервер</Button>
        <Button size="sm" @click="openJoin">Присоединиться</Button>
      </div>
    </div>

    <!-- Привязка: устройство С ДАННЫМИ становится первым bound-устройством. -->
    <Sheet
      v-model:open="bindOpen"
      title="Привязать сервер"
      description="Одноразовый токен спрашивается сейчас и нигде не сохраняется"
    >
      <form class="flex flex-col gap-3" @submit.prevent="submitBind">
        <TextField
          v-model="bindUrl"
          label="Адрес сервера"
          type="url"
          inputmode="url"
          placeholder="https://brain.example.com"
          autocomplete="off"
        />
        <TextField
          v-model="bindToken"
          label="Токен доступа"
          type="password"
          autocomplete="off"
          hint="Тот же секрет, что в SYNC_TOKEN на сервере"
        />
        <p v-if="error" role="alert" class="text-xs text-danger">{{ error }}</p>
      </form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <Button size="sm" @click="bindOpen = false">Отмена</Button>
          <Button
            tone="primary"
            size="sm"
            :loading="busy"
            :disabled="bindUrl.trim() === '' || bindToken.trim() === ''"
            @click="submitBind"
          >
            Привязать
          </Button>
        </div>
      </template>
    </Sheet>

    <!-- Присоединение: свежее устройство подключается к уже привязанному аккаунту. -->
    <Sheet
      v-model:open="joinOpen"
      title="Присоединиться"
      :description="joinStep === 'address'
        ? 'Вход через passkey — свой или синхронизированный платформой'
        : 'Этот passkey не открыл обёртку — введите фразу восстановления'"
    >
      <form v-if="joinStep === 'address'" class="flex flex-col gap-3" @submit.prevent="startJoin">
        <TextField
          v-model="joinUrl"
          label="Адрес сервера"
          type="url"
          inputmode="url"
          placeholder="https://brain.example.com"
          autocomplete="off"
        />
        <p v-if="error" role="alert" class="text-xs text-danger">{{ error }}</p>
      </form>

      <form v-else class="flex flex-col gap-3" @submit.prevent="finishJoinByPhrase">
        <textarea
          v-model="joinPhrase"
          rows="3"
          placeholder="двенадцать слов через пробел"
          aria-label="Фраза восстановления"
          autocomplete="off"
          class="glass w-full resize-none rounded-control border px-3.5 py-2.5 text-sm text-text
                 transition-[border-color] placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
        <p v-if="error" role="alert" class="text-xs text-danger">{{ error }}</p>
      </form>

      <template #footer>
        <div class="flex justify-end gap-2">
          <Button size="sm" @click="joinOpen = false">Отмена</Button>
          <Button
            v-if="joinStep === 'address'"
            tone="primary"
            size="sm"
            :loading="busy"
            :disabled="joinUrl.trim() === ''"
            @click="startJoin"
          >
            Продолжить
          </Button>
          <Button
            v-else
            tone="primary"
            size="sm"
            :loading="busy"
            :disabled="joinPhrase.trim() === ''"
            @click="finishJoinByPhrase"
          >
            Открыть
          </Button>
        </div>
      </template>
    </Sheet>
  </Card>
</template>
