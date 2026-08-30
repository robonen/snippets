<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useClipboard, useShare } from '@robonen/vue';
import { Button, Card, ConfirmDialog, Disclosure, QrCode, useToast } from '@brain/ui';
import {
  assertKnownPhrase,
  kekFromAssertion,
  kekFromPassphrase,
  normalizePhrase,
  randomBytes,
  authenticate as signIn,
} from '@brain/auth';
import { MonitorSmartphone, TriangleAlert } from 'lucide-vue-next';
import { useAction } from '@/app/action';
import { useLock } from '@/security/lock';
import { fingerprint } from '@/security/keys-land';
import { inviteLink } from '@/security/invites';
import { createInvite, dropInvite, revokeDevices } from '@/security/space';
import { useSyncSettings } from '@/sync';
import type { PairedDevice } from '@/security/keys-land';
import type { RevokeConfirm } from '@/security/space';
import type { KeyKeeping } from '@/security/device-keys';
import PhraseField from './PhraseField.vue';
import { RP_ID, useAccess } from './use-access';

/**
 * Устройства пространства: список из служебного ленда `keys`, приглашение
 * нового устройства и отзыв. Карточка видна всегда — управление устройствами
 * не должно прятаться до момента, когда второе устройство успело объявиться.
 *
 * Подключение — ОДИН путь: приглашение с основного устройства, QR-кодом или
 * ссылкой. Ссылка несёт одноразовый код (и токен синка) в URL-фрагменте —
 * фрагмент не уходит на сервер. Открыл на новом устройстве — оно настроило
 * синк, дождалось записи и вошло в одно подтверждение.
 */

const { invite: activeInvite, keeping, liveDevices, liveOthers, member, myPub, revokedDevices } = useAccess();
const { access: wraps, guarded } = useLock();
const { configured: syncOn, settings: syncSettings } = useSyncSettings();
const { show: toast } = useToast();

const build = __BUILD__;
const KEEPING_TEXT: Record<KeyKeeping, string> = {
  idb: 'сохранены',
  local: 'сохранены (localStorage)',
  memory: 'НЕ сохраняются',
};

// ── Приглашение ──────────────────────────────────────────────────────────────

/** Ссылка показывается один раз — код нигде больше не хранится. */
const link = ref('');
const { copy, copied } = useClipboard();
const { share, isSupported: canShare } = useShare(() => ({ title: 'brain', url: link.value }));

const invite = useAction(async () => {
  const code = await createInvite();
  link.value = inviteLink(globalThis.location.origin, { code, token: syncSettings.value.token });
}, 'не получилось создать приглашение');

const drop = useAction(async () => {
  dropInvite();
  link.value = '';
}, 'не получилось погасить приглашение');

const hasInvite = computed(() => (activeInvite.value ?? null) !== null);
const inviteError = computed(() => invite.error.value || drop.error.value);

// Приглашение погасло с другой стороны — обычно его принял новый участник:
// показывать QR дальше нечестно, код уже ничего не открывает.
watch(hasInvite, (has) => {
  if (!has) link.value = '';
});

// ── Отзыв ────────────────────────────────────────────────────────────────────

const targets = ref<PairedDevice[]>([]);
const dialogOpen = ref(false);
const revokePhrase = ref('');

/**
 * Фразу спрашиваем только с включённым замком: без тихого ключа новый мастер
 * иначе не завернуть. С выключенным замком отзыв — одна кнопка, а протухшие
 * passkey/фразу человек заводит заново (тост об этом скажет).
 */
const needPhrase = computed(() =>
  guarded.value
  && !wraps.value.some(wrap => wrap.kind === 'passkey')
  && wraps.value.some(wrap => wrap.kind === 'passphrase'));

function ask(list: readonly PairedDevice[]): void {
  targets.value = [...list];
  dialogOpen.value = true;
}

const revoke = useAction(async () => {
  const list = targets.value;
  if (list.length === 0) return;

  // Отзыв ротирует МАСТЕР: локальные обёртки протухают. Passkey подтверждаем
  // всегда (одно касание — и он переживает ротацию), фразу — только когда
  // замок включён и другого способа завернуть мастер нет.
  let confirm: RevokeConfirm | undefined;
  const passkeyWrap = wraps.value.find(wrap => wrap.kind === 'passkey');
  const phraseWrap = wraps.value.find(wrap => wrap.kind === 'passphrase');
  if (passkeyWrap !== undefined) {
    const assertion = await signIn({ rpId: RP_ID, challenge: randomBytes(32) }, passkeyWrap.salt);
    const kek = await kekFromAssertion(assertion, passkeyWrap.salt);
    if (kek === null) throw new Error('this key did not return PRF — revocation stopped');
    confirm = { kek, meta: { kind: 'passkey', label: passkeyWrap.label, salt: passkeyWrap.salt } };
  }
  else if (needPhrase.value && phraseWrap !== undefined) {
    const clean = normalizePhrase(revokePhrase.value);
    assertKnownPhrase(clean);
    const kek = await kekFromPassphrase(clean, phraseWrap.salt);
    confirm = { kek, meta: { kind: 'passphrase', label: phraseWrap.label, salt: phraseWrap.salt }, phrase: clean };
  }

  const { serverWiped } = await revokeDevices(list, confirm);
  revokePhrase.value = '';
  const lostPhrase = confirm?.phrase === undefined && phraseWrap !== undefined;
  toast({
    title: list.length === 1 ? 'Устройство отозвано' : `Отозвано устройств: ${list.length}`,
    description: [
      'Секреты и мастер перевыпущены.',
      lostPhrase ? 'Пересоздайте фразу восстановления.' : '',
      serverWiped ? '' : 'Старые копии на сервере не стёрлись — они остались безвредным шифртекстом.',
    ].filter(part => part !== '').join(' '),
    tone: 'positive',
  });
}, 'не получилось отозвать');

async function confirmRevoke(): Promise<void> {
  await revoke.run();
  targets.value = [];
}
</script>

<template>
  <Card title="Устройства">
    <ul class="flex flex-col divide-y divide-line">
      <li
        v-for="device in liveDevices"
        :key="device.pub"
        class="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
      >
        <MonitorSmartphone class="size-4 shrink-0 text-text-faint" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm text-text">
            {{ device.label }}
            <span v-if="device.pub === myPub" class="text-text-faint">— это устройство</span>
          </p>
          <p class="text-xs text-text-faint">отпечаток {{ fingerprint(device.pub) }}</p>
        </div>
        <Button
          v-if="member && device.pub !== myPub"
          tone="danger"
          size="sm"
          :loading="revoke.busy.value"
          @click="ask([device])"
        >
          Отозвать
        </Button>
      </li>
    </ul>

    <!-- Зомби после переустановок копятся пачками: одна кнопка — одна ротация. -->
    <div v-if="member && liveOthers.length > 1" class="mt-2 flex justify-end">
      <Button tone="danger" size="sm" :loading="revoke.busy.value" @click="ask(liveOthers)">
        Отозвать все остальные ({{ liveOthers.length }})
      </Button>
    </div>

    <p v-if="revoke.error.value" role="alert" class="mt-2 text-xs text-danger">{{ revoke.error.value }}</p>

    <div v-if="revokedDevices.length > 0" class="mt-3">
      <Disclosure title="Отозванные" :hint="String(revokedDevices.length)">
        <ul class="flex flex-col gap-1">
          <li v-for="device in revokedDevices" :key="device.pub" class="text-xs text-text-faint">
            {{ device.label }} · {{ fingerprint(device.pub) }} — отозвано
          </li>
        </ul>
      </Disclosure>
    </div>

    <div v-if="!member" class="mt-3 flex gap-3 border-t border-line pt-3">
      <TriangleAlert class="mt-0.5 size-5 shrink-0 text-warning" />
      <p class="text-sm text-text-soft">
        Это устройство ещё не в пространстве. На основном устройстве нажмите
        «Пригласить» и откройте полученную ссылку здесь — больше ничего
        нажимать не нужно.
      </p>
    </div>

    <div v-else class="mt-3 flex flex-col gap-3 border-t border-line pt-3">
      <template v-if="link !== ''">
        <p class="text-xs text-text-faint">
          Отсканируйте код камерой нового устройства или отправьте ссылку
          себе. Показывается один раз и действует сутки; внутри — код доступа
          и токен сервера, чужим её не пересылать.
        </p>
        <div class="flex justify-center">
          <QrCode :value="link" label="Ссылка-приглашение" />
        </div>
        <code class="glass block w-full break-all rounded-control border px-3 py-2 text-xs text-text">{{ link }}</code>
        <div class="flex flex-wrap justify-end gap-2">
          <Button size="sm" tone="danger" @click="drop.run()">Погасить</Button>
          <Button v-if="canShare" size="sm" @click="share()">Поделиться</Button>
          <Button size="sm" tone="primary" @click="copy(link)">
            {{ copied ? 'Скопировано' : 'Скопировать' }}
          </Button>
        </div>
      </template>
      <template v-else>
        <div class="flex items-center justify-between gap-3">
          <p class="min-w-0 flex-1 text-xs text-text-faint">
            {{ hasInvite
              ? 'Приглашение действует: ссылка была показана при создании.'
              : 'Добавить устройство: «Пригласить» → показать QR или открыть ссылку на нём.' }}
          </p>
          <Button v-if="hasInvite" size="sm" tone="danger" @click="drop.run()">Погасить</Button>
          <Button v-else size="sm" tone="primary" :disabled="!syncOn" :loading="invite.busy.value" @click="invite.run()">
            Пригласить
          </Button>
        </div>
        <p v-if="!syncOn" class="text-xs text-text-faint">
          Для приглашений нужна синхронизация: подключите сервер в Настройках.
        </p>
      </template>
      <p v-if="inviteError" role="alert" class="text-xs text-danger">{{ inviteError }}</p>
    </div>

    <p class="mt-3 text-xs text-text-faint">
      Ключи устройства: {{ keeping === null ? '…' : KEEPING_TEXT[keeping] }} · сборка {{ build }}
    </p>

    <ConfirmDialog
      v-if="targets.length > 0"
      v-model:open="dialogOpen"
      :title="targets.length === 1 ? 'Отозвать устройство?' : `Отозвать ${targets.length} устройства?`"
      :description="'Секреты всех лендов будут перевыпущены, данные перепечатаны и перезалиты на сервер. '
        + 'Что устройства успели прочитать — при них и останется; нового они не увидят. Нужна сеть.'"
      confirm-label="Отозвать"
      @confirm="confirmRevoke"
    >
      <div v-if="needPhrase" class="mt-3 flex flex-col gap-1.5">
        <p class="text-xs text-text-faint">
          Подтвердите фразой восстановления: ею будет завёрнут новый мастер.
        </p>
        <PhraseField v-model="revokePhrase" />
      </div>
    </ConfirmDialog>
  </Card>
</template>
