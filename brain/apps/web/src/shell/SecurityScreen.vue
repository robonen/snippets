<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useEventListener, useSupported } from '@robonen/vue';
import { Card, ConfirmDialog, Page, PageHeader, useToast } from '@brain/ui';
import { isSupported } from '@brain/auth';
import { useSpaces } from '@brain/module-kit';
import { TriangleAlert } from 'lucide-vue-next';
import { useAction } from '@/app/action';
import { parseInviteHash } from '@/security/invites';
import { joinByInvite } from '@/security/space';
import { restartSync, saveSyncSettings, useSyncSettings } from '@/sync';
import AccessCards from './access/AccessCards.vue';

/**
 * Экран «Доступ»: рама, приём ссылки-приглашения и стопка карточек
 * (`shell/access/AccessCards.vue`). Стопка стоит под `v-if="spaces.open"`
 * не для красоты: присоединение пересобирает ленды, и карточки обязаны
 * перемонтироваться на свежие — см. комментарий в самой стопке.
 *
 * Работает БЕЗ сервера, и это не заглушка: ключи выводятся на устройстве
 * (passkey → PRF → KEK, фраза → PBKDF2), серверу в этой схеме нечего
 * проверять. Сервер нужен только доставке: сейф, приглашения и гранты едут
 * обычным синком открытого ленда `keys`.
 */

const supported = useSupported(isSupported);
const spaces = useSpaces();
const { configured: syncOn } = useSyncSettings();
const { show: toast } = useToast();

// ── Ссылка-приглашение ───────────────────────────────────────────────────────
//
// И при загрузке, и при смене хэша: ссылку могут вставить в уже открытую
// вкладку — экран при этом не перемонтируется.

const inviteCode = ref('');
const joinOpen = ref(false);

function takeInviteFromHash(): void {
  const found = parseInviteHash(globalThis.location.hash);
  if (found === null) return;
  if (found.token !== '' && !syncOn.value) {
    saveSyncSettings({ url: '', token: found.token });
    restartSync();
  }
  inviteCode.value = found.code;
  joinOpen.value = true;
  // Код не должен переживать обработку в истории браузера.
  globalThis.history.replaceState(null, '', globalThis.location.pathname);
}

onMounted(takeInviteFromHash);
useEventListener(globalThis, 'hashchange', takeInviteFromHash);

const join = useAction(async () => {
  // Запись приглашения едет обычным синком — даём ей время доехать.
  for (let attempt = 0; ; attempt++) {
    if (await joinByInvite(inviteCode.value)) break;
    if (attempt >= 30) {
      throw new Error('the invite has not arrived over sync — check the server address and token');
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  inviteCode.value = '';
  toast({ title: 'Устройство подключено', description: 'Данные пространства едут с сервера.', tone: 'positive' });
}, 'не получилось подключиться по приглашению');
</script>

<template>
  <Page width="list">
    <PageHeader
      title="Доступ"
      subtitle="Ключи, которыми открываются ваши данные"
    />

    <div class="flex flex-col gap-3">
      <Card v-if="!supported">
        <div class="flex gap-3">
          <TriangleAlert class="mt-0.5 size-5 shrink-0 text-warning" />
          <p class="text-sm text-text-soft">
            Браузер не поддерживает passkey. Доступ можно защитить фразой
            восстановления, но биометрии не будет.
          </p>
        </div>
      </Card>

      <Card v-if="join.error.value">
        <div class="flex gap-3">
          <TriangleAlert class="mt-0.5 size-5 shrink-0 text-danger" />
          <p class="text-sm text-text-soft">{{ join.error.value }}</p>
        </div>
      </Card>

      <AccessCards v-if="spaces.open" />
    </div>

    <ConfirmDialog
      v-model:open="joinOpen"
      title="Подключиться по приглашению?"
      description="Местные данные этого устройства будут заменены данными пространства. Всё, что вы успели записать здесь, будет стёрто."
      confirm-label="Подключиться"
      @confirm="join.run()"
    />
  </Page>
</template>
