<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { computedAsync, useSupported } from '@robonen/vue';
import {
  Button,
  Card,
  ConfirmDialog,
  Page,
  PageHeader,
  TextField,
  useToast,
} from '@brain/ui';
import {
  createPhrase,
  encodeBytes,
  hasPlatformAuthenticator,
  isSupported,
  kekFromAssertion,
  kekFromPassphrase,
  normalizePhrase,
  quizIndexes,
  randomBytes,
  register,
  authenticate as signIn,
} from '@brain/auth';
import { useValue } from '@sync/vue';
import { useSpaces } from '@brain/module-kit';
import { joinSpace, pendingGrant, revokeDevice, trustDevice } from '@/app/boot';
import { addAccess, freshSalt, removeAccess, useLock } from '../security/lock';
import { KEYS_ID, deviceIdentity, fingerprint, listDevices } from '../security/pairing';
import { Fingerprint, KeyRound, Lock, MonitorSmartphone, TriangleAlert } from 'lucide-vue-next';
import type { PairedDevice } from '../security/pairing';
import type { WrappedDek } from '@brain/auth';

/**
 * Настройка доступа: passkey, фраза восстановления, устройства пространства.
 *
 * Работает БЕЗ сервера, и это не заглушка: ключи выводятся на устройстве
 * (passkey → PRF → KEK, фраза → PBKDF2), серверу в этой схеме нечего проверять.
 * Сервер нужен только доставке: обёртки секретов между устройствами едут
 * обычным синком в служебном ленде (`security/pairing.ts`).
 *
 * Способ доступа заворачивает МАСТЕР связки, а не данные: добавление способа —
 * ещё одна обёртка того же мастера (`addAccess` → `Keyring.wrapFor`).
 */

const supported = useSupported(isSupported);
// Встроенный авторизатор опрашивается асинхронно. До ответа считаем, что его
// нет: подпись «откроется пальцем» на устройстве без биометрии — обещание,
// которого не сдержать, а обратная ошибка стоит лишь строчки текста.
const platform = computedAsync(hasPlatformAuthenticator, false);
const { access: wraps, configured, lock } = useLock();
const { show: toast } = useToast();
const busy = ref('');
const error = ref('');

// Фраза показывается ровно один раз — хранить её негде и незачем.
const phrase = ref<string[] | null>(null);
const quiz = ref<number[]>([]);
const answers = ref<Record<number, string>>({});

const hasPasskey = computed(() => wraps.value.some(wrap => wrap.kind === 'passkey'));
const hasPhrase = computed(() => wraps.value.some(wrap => wrap.kind === 'passphrase'));

const quizPassed = computed(() =>
  phrase.value !== null
  && quiz.value.length > 0
  && quiz.value.every(index => normalizePhrase(answers.value[index] ?? '') === phrase.value?.[index]));

const RP_NAME = 'brain';
const rpId = globalThis.location.hostname;

function displayLabel(wrap: WrappedDek): string {
  return wrap.kind === 'passkey' && wrap.label.length > 20 ? 'Passkey' : wrap.label;
}

async function addPasskey(): Promise<void> {
  error.value = '';
  busy.value = 'passkey';
  try {
    const created = await register({
      rpId,
      rpName: RP_NAME,
      userHandle: randomBytes(16),
      userName: 'brain',
      challenge: randomBytes(32),
    });
    if (!created.prf) {
      error.value = 'Этот ключ не поддерживает вывод шифровального ключа (PRF). '
        + 'Настройте фразу восстановления — она будет единственным способом открыть данные.';
      return;
    }

    // Второе обращение — уже за самим выводом PRF: на регистрации многие
    // авторизаторы значение не отдают, только признак поддержки.
    const salt = freshSalt();
    const assertion = await signIn({ rpId, challenge: randomBytes(32) }, salt);
    const kek = await kekFromAssertion(assertion, salt);
    if (kek === null) {
      error.value = 'Ключ создан, но PRF не отдал значение. Используйте фразу восстановления.';
      return;
    }

    await addAccess(kek, { kind: 'passkey', label: 'passkey', salt });
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'не получилось создать ключ';
  }
  finally {
    busy.value = '';
  }
}

function startPhrase(): void {
  error.value = '';
  phrase.value = createPhrase();
  quiz.value = quizIndexes(2);
  answers.value = {};
}

async function confirmPhrase(): Promise<void> {
  if (phrase.value === null || !quizPassed.value) return;
  busy.value = 'phrase';
  try {
    const salt = freshSalt();
    const kek = await kekFromPassphrase(phrase.value.join(' '), salt);
    await addAccess(kek, { kind: 'passphrase', label: 'фраза', salt });
    phrase.value = null;
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'не получилось сохранить фразу';
  }
  finally {
    busy.value = '';
  }
}

// Убрать способ доступа — локальное действие: обёртка мастера этого устройства
// стирается из localStorage. Честная граница записана в подписи карточки:
// снятая ЗАРАНЕЕ копия обёртки продолжила бы подходить, поэтому кража копии +
// способа — это компрометация, а не «убрал и забыл».
const confirmRemove = ref<WrappedDek | null>(null);
const removeDialogOpen = ref(false);

function askRemove(label: string): void {
  const wrap = wraps.value.find(w => w.label === label);
  if (wrap === undefined) return;
  confirmRemove.value = wrap;
  removeDialogOpen.value = true;
}

function doRemove(): void {
  if (confirmRemove.value === null) return;
  try {
    removeAccess(confirmRemove.value.label);
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'не получилось убрать способ доступа';
  }
  confirmRemove.value = null;
}

// ── Устройства пространства ─────────────────────────────────────────────────

const spaces = useSpaces();
const myPub = ref('');
onMounted(async () => {
  myPub.value = encodeBytes((await deviceIdentity()).pub);
});

const devices = useValue(() =>
  spaces.open && myPub.value !== '' ? listDevices(spaces.space(KEYS_ID), myPub.value) : []);
const others = computed(() => (devices.value ?? []).filter(device => !device.mine));

/** Ждёт ли нас чужая обёртка — свежему устройству предлагается присоединиться. */
const grantReady = ref(false);
// Обёртка приезжает синком ПОСЛЕ захода на экран — опрашиваем, пока экран
// открыт, чтобы карточка «Присоединиться» появилась сама, без перезахода.
let grantTimer: ReturnType<typeof setInterval> | null = null;
onMounted(async () => {
  grantReady.value = await pendingGrant();
  grantTimer = setInterval(async () => {
    if (!grantReady.value) grantReady.value = await pendingGrant();
  }, 5000);
});
onUnmounted(() => {
  if (grantTimer !== null) clearInterval(grantTimer);
});

const deviceBusy = ref('');
const confirmDevice = ref<PairedDevice | null>(null);
const trustDialogOpen = ref(false);
const revokeDeviceTarget = ref<PairedDevice | null>(null);
const revokeDeviceOpen = ref(false);
const joinDialogOpen = ref(false);

async function doTrust(): Promise<void> {
  const device = confirmDevice.value;
  if (device === null) return;
  deviceBusy.value = device.pub;
  try {
    await trustDevice(device);
    toast({ title: 'Доступ выдан', description: 'Второе устройство может присоединиться.', tone: 'positive' });
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'не получилось выдать доступ';
  }
  finally {
    deviceBusy.value = '';
    confirmDevice.value = null;
  }
}

async function doJoin(): Promise<void> {
  deviceBusy.value = 'join';
  try {
    await joinSpace();
    grantReady.value = false;
    toast({ title: 'Устройство присоединено', description: 'Данные пространства едут с сервера.', tone: 'positive' });
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'не получилось присоединиться';
  }
  finally {
    deviceBusy.value = '';
  }
}

async function doRevokeDevice(): Promise<void> {
  const device = revokeDeviceTarget.value;
  if (device === null) return;
  deviceBusy.value = device.pub;
  try {
    await revokeDevice(device);
    toast({ title: 'Устройство отозвано', description: 'Секреты перевыпущены, ленды перепечатаны.', tone: 'positive' });
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'не получилось отозвать устройство';
  }
  finally {
    deviceBusy.value = '';
    revokeDeviceTarget.value = null;
  }
}
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

      <Card v-if="error">
        <div class="flex gap-3">
          <TriangleAlert class="mt-0.5 size-5 shrink-0 text-danger" />
          <p class="text-sm text-text-soft">{{ error }}</p>
        </div>
      </Card>

      <!-- Честная граница текущей защиты. Данные уже зашифрованы ключом
           устройства, но он открывает их без спроса: пока способа доступа нет,
           замка тоже нет, и молчать об этом нельзя. -->
      <Card v-if="!configured">
        <div class="flex gap-3">
          <TriangleAlert class="mt-0.5 size-5 shrink-0 text-warning" />
          <p class="text-sm text-text-soft">
            Данные на диске уже зашифрованы, но открываются без спроса: ключ
            хранит сам браузер. Настройте passkey или фразу — тогда появится
            замок, и данные откроются только вам.
          </p>
        </div>
      </Card>

      <Card v-if="grantReady">
        <div class="flex items-start gap-3">
          <MonitorSmartphone class="mt-0.5 size-5 shrink-0 text-accent" />
          <div class="min-w-0 flex-1">
            <p class="text-sm text-text">Этому устройству выдан доступ к пространству</p>
            <p class="mt-0.5 text-xs text-text-faint">
              Присоединение заменит местные данные пространством: заготовки этого
              устройства будут стёрты, настоящие данные приедут с сервера.
            </p>
          </div>
          <Button tone="primary" size="sm" :loading="deviceBusy === 'join'" @click="joinDialogOpen = true">
            Присоединиться
          </Button>
        </div>
      </Card>

      <Card title="Passkey">
        <div class="flex items-start gap-3">
          <Fingerprint class="mt-0.5 size-5 shrink-0 text-text-faint" />
          <div class="min-w-0 flex-1">
            <p class="text-sm text-text">
              {{ hasPasskey ? 'Настроен' : 'Не настроен' }}
            </p>
            <p class="mt-0.5 text-xs text-text-faint">
              {{ platform
                ? 'Открытие лицом, пальцем или PIN. Ключ шифрования выводится из passkey и не покидает устройство.'
                : 'Встроенного авторизатора нет — понадобится внешний ключ.' }}
            </p>
          </div>
          <Button
            v-if="!hasPasskey"
            tone="primary"
            size="sm"
            :loading="busy === 'passkey'"
            :disabled="!supported"
            @click="addPasskey"
          >
            Настроить
          </Button>
        </div>
      </Card>

      <Card title="Фраза восстановления">
        <div v-if="phrase === null" class="flex items-start gap-3">
          <KeyRound class="mt-0.5 size-5 shrink-0 text-text-faint" />
          <div class="min-w-0 flex-1">
            <p class="text-sm text-text">{{ hasPhrase ? 'Настроена' : 'Не настроена' }}</p>
            <p class="mt-0.5 text-xs text-text-faint">
              Единственный путь к данным, если устройство с passkey потеряно.
              Сервер помочь не сможет: он хранит только шифртекст.
            </p>
          </div>
          <Button v-if="!hasPhrase" size="sm" @click="startPhrase">
            Создать
          </Button>
        </div>

        <div v-else class="flex flex-col gap-3">
          <p class="text-xs text-text-faint">
            Запишите двенадцать слов по порядку. Показываются один раз.
          </p>
          <ol class="grid grid-cols-2 gap-1.5 rounded-card bg-sunken p-3 sm:grid-cols-3">
            <li
              v-for="(word, index) in phrase"
              :key="index"
              class="flex gap-1.5 text-sm text-text"
            >
              <span class="tnum w-5 shrink-0 text-right text-text-faint">{{ index + 1 }}.</span>
              {{ word }}
            </li>
          </ol>

          <div class="flex flex-col gap-2">
            <p class="text-xs text-text-faint">Проверка: введите эти слова.</p>
            <TextField
              v-for="index in quiz"
              :key="index"
              v-model="answers[index]"
              :label="`Слово №${index + 1}`"
              autocomplete="off"
            />
          </div>

          <div class="flex justify-end gap-2">
            <Button size="sm" @click="phrase = null">Отмена</Button>
            <Button
              tone="primary"
              size="sm"
              :disabled="!quizPassed"
              :loading="busy === 'phrase'"
              @click="confirmPhrase"
            >
              Я записал
            </Button>
          </div>
        </div>
      </Card>

      <Card v-if="configured" title="Способы доступа">
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
            <Button
              v-if="wraps.length > 1"
              tone="danger"
              size="sm"
              @click="askRemove(wrap.label)"
            >
              Убрать
            </Button>
          </li>
        </ul>
        <p class="mt-3 text-xs text-text-faint">
          Убрать последний способ нельзя: данные стали бы недоступны навсегда.
        </p>
      </Card>

      <!-- Устройства пространства: список из служебного ленда `keys`.
           Новое устройство объявляется само; человек сверяет отпечатки на двух
           экранах и жмёт «Доверять» — секреты уезжают обёрткой через сервер. -->
      <Card v-if="spaces.open && others.length > 0" title="Устройства">
        <ul class="flex flex-col divide-y divide-line">
          <li
            v-for="device in others"
            :key="device.pub"
            class="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
          >
            <MonitorSmartphone class="size-4 shrink-0 text-text-faint" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm text-text">
                {{ device.label }}
                <span v-if="device.revoked" class="text-danger">— отозвано</span>
              </p>
              <p class="text-xs text-text-faint">отпечаток {{ fingerprint(device.pub) }}</p>
            </div>
            <Button
              v-if="!device.revoked"
              size="sm"
              :loading="deviceBusy === device.pub"
              @click="confirmDevice = device; trustDialogOpen = true"
            >
              Доверять
            </Button>
            <Button
              v-if="!device.revoked"
              tone="danger"
              size="sm"
              :loading="deviceBusy === device.pub"
              @click="revokeDeviceTarget = device; revokeDeviceOpen = true"
            >
              Отозвать
            </Button>
          </li>
        </ul>
        <p class="mt-3 text-xs text-text-faint">
          Отпечаток этого устройства: {{ myPub === '' ? '…' : fingerprint(myPub) }}.
          Сверяйте отпечатки на обоих экранах перед выдачей доступа.
        </p>
      </Card>

      <!-- Явная команда из docs/01-security.md §5. Показывается только с
           настроенным доступом: иначе замок захлопнулся бы перед человеком,
           которому нечем открыть. -->
      <Card v-if="configured">
        <div class="flex items-center gap-3">
          <Lock class="size-4 shrink-0 text-text-faint" />
          <p class="min-w-0 flex-1 text-sm text-text-soft">
            Запереть сейчас: расшифрованные данные уйдут из памяти вкладки.
          </p>
          <Button size="sm" @click="lock">Заблокировать</Button>
        </div>
      </Card>
    </div>

    <ConfirmDialog
      v-if="confirmRemove !== null"
      v-model:open="removeDialogOpen"
      title="Убрать способ доступа?"
      :description="`Обёртка «${displayLabel(confirmRemove)}» будет стёрта с этого устройства. `
        + 'Если её копию сняли раньше вместе с самим способом — это компрометация, '
        + 'и правильный ответ на неё: отозвать устройство, а не убрать способ.'"
      confirm-label="Убрать"
      @confirm="doRemove"
    />

    <ConfirmDialog
      v-if="confirmDevice !== null"
      v-model:open="trustDialogOpen"
      title="Доверять устройству?"
      :description="`Сверьте отпечаток на втором экране: ${fingerprint(confirmDevice.pub)}. `
        + 'После подтверждения оно получит секреты всех лендов и полный доступ к пространству.'"
      confirm-label="Доверять"
      @confirm="doTrust"
    />

    <ConfirmDialog
      v-if="revokeDeviceTarget !== null"
      v-model:open="revokeDeviceOpen"
      title="Отозвать устройство?"
      :description="'Секреты всех лендов будут перевыпущены, данные перепечатаны и перезалиты на сервер. '
        + 'Что устройство успело прочитать — при нём и останется; нового оно не увидит. Нужна сеть.'"
      confirm-label="Отозвать"
      @confirm="doRevokeDevice"
    />

    <ConfirmDialog
      v-model:open="joinDialogOpen"
      title="Присоединиться к пространству?"
      description="Местные данные этого устройства будут заменены данными пространства. Всё, что вы успели записать здесь до присоединения, будет стёрто."
      confirm-label="Присоединиться"
      @confirm="doJoin"
    />
  </Page>
</template>
