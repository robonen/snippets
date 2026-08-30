<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { computedAsync, useClipboard, useSupported } from '@robonen/vue';
import {
  Button,
  Card,
  ConfirmDialog,
  Page,
  PageHeader,
  SwitchField,
  TextField,
  useToast,
} from '@brain/ui';
import {
  assertKnownPhrase,
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
import {
  createInvite,
  dropInvite,
  joinByInvite,
  joinByPhrase,
  joinSpace,
  pendingGrant,
  publishPhraseAccess,
  revokeDevice,
  trustDevice,
} from '@/app/boot';
import { restartSync, saveSyncSettings, useSyncSettings } from '@/sync';
import { addAccess, freshSalt, removeAccess, setGuarded, useLock } from '../security/lock';
import { KEYS_ID, deviceIdentity, fingerprint, listDevices, readInvite, readVault } from '../security/pairing';
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
const { access: wraps, configured, guarded, lock } = useLock();

async function toggleGuard(on: boolean): Promise<void> {
  try {
    await setGuarded(on);
    toast(on
      ? { title: 'Замок включён', description: 'Вход — по passkey или фразе на каждом запуске.', tone: 'positive' }
      : { title: 'Замок выключен', description: 'Приложение будет открываться сразу.' });
  }
  catch (caught) {
    error.value = caught instanceof Error && caught.message !== ''
      ? caught.message
      : 'не получилось переключить замок';
  }
}
const { show: toast } = useToast();
const busy = ref('');
const error = ref('');

// Фраза показывается ровно один раз — хранить её негде и незачем.
const phrase = ref<string[] | null>(null);
const quiz = ref<number[]>([]);
const answers = ref<Record<number, string>>({});

// Копирование фразы: удобнее, чем диктовать себе в блокнот с опечатками.
// Буфер обмена — не хранилище: вставили в менеджер паролей — сотрите.
const { copy: copyPhrase, copied: phraseCopied, isSupported: canCopy } = useClipboard();

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
    const kek = await kekFromPassphrase(normalizePhrase(phrase.value), salt);
    await addAccess(kek, { kind: 'passphrase', label: 'фраза', salt });
    // Та же фраза открывает пространство с ЛЮБОГО устройства: мастер под её
    // KEK'ом публикуется в сейфе ленда `keys` (модель crus).
    if (spaces.open) await publishPhraseAccess(kek, salt);
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

// Геттер обязан ЧИТАТЬ ленд при каждом запуске: мост (@sync/vue) подписывает
// эффект только на то, что было прочитано. Прежняя задвижка `myPub !== ''`
// на первом запуске возвращала [] не тронув ленд — эффект не подписывался ни
// на что и не просыпался уже никогда, список устройств вечно пустовал.
const roster = useValue(() => spaces.open ? listDevices(spaces.space(KEYS_ID)) : []);

// ── Приглашение ссылкой ──────────────────────────────────────────────────────
//
// Самый короткий путь подключения: ссылка несёт одноразовый код (и токен
// синка) в URL-фрагменте — фрагмент не уходит на сервер. Открыл на новом
// устройстве — оно настроило синк, дождалось записи и вошло.

const { configured: syncOn, settings: syncSettings } = useSyncSettings();
const invite = useValue(() => spaces.open ? readInvite(spaces.space(KEYS_ID)) : null);
const inviteLink = ref('');
const inviteBusy = ref(false);
const { copy: copyInvite, copied: inviteCopied } = useClipboard();

async function doCreateInvite(): Promise<void> {
  inviteBusy.value = true;
  try {
    const code = await createInvite();
    const token = syncSettings.value.token;
    inviteLink.value = `${globalThis.location.origin}/settings/security`
      + `#invite=${code}${token === '' ? '' : `&sync=${encodeURIComponent(token)}`}`;
  }
  catch (caught) {
    error.value = caught instanceof Error && caught.message !== '' ? caught.message : 'не получилось создать приглашение';
  }
  finally {
    inviteBusy.value = false;
  }
}

function doDropInvite(): void {
  try {
    dropInvite();
  }
  catch (caught) {
    error.value = caught instanceof Error && caught.message !== '' ? caught.message : 'не получилось погасить приглашение';
  }
  inviteLink.value = '';
}

// Открыли по ссылке-приглашению: настроить синк из фрагмента и предложить вход.
const inviteCode = ref('');
const inviteJoinOpen = ref(false);
onMounted(() => {
  const hash = new URLSearchParams(globalThis.location.hash.slice(1));
  const code = hash.get('invite');
  if (code === null || code === '') return;
  const token = hash.get('sync');
  if (token !== null && token !== '' && !syncOn.value) {
    saveSyncSettings({ url: '', token });
    restartSync();
  }
  inviteCode.value = code;
  inviteJoinOpen.value = true;
  // Код не должен переживать обработку в истории браузера.
  globalThis.history.replaceState(null, '', globalThis.location.pathname);
});

async function doJoinByInvite(): Promise<void> {
  deviceBusy.value = 'invite-join';
  joinPhraseError.value = '';
  try {
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
  }
  catch (caught) {
    joinPhraseError.value = caught instanceof Error && caught.message !== ''
      ? caught.message
      : 'не получилось подключиться по приглашению';
  }
  finally {
    deviceBusy.value = '';
  }
}
const devices = computed(() => roster.value ?? []);
const others = computed(() => devices.value.filter(device => device.pub !== myPub.value));

// Вход фразой: пространство открывается с нового устройства одной фразой —
// сейф (мастер под KEK'ом фразы + секреты под мастером) приезжает синком.
const joinPhrase = ref('');
const joinPhraseOpen = ref(false);
const joinPhraseError = ref('');
// Сейф пространства — реактивно из ленда `keys`: пока фразовый вход не
// приехал синком, кнопка честно выключена, а не «жмётся в пустоту».
const vault = useValue(() => spaces.open ? readVault(spaces.space(KEYS_ID)) : null);
/** Обе половины сейфа обязаны быть от одного мастера (легаси без отпечатков не судим). */
const vaultStale = computed(() => {
  const v = vault.value;
  return v !== null && v !== undefined && v.wrapMaster !== '' && v.ringMaster !== '' && v.wrapMaster !== v.ringMaster;
});
const vaultReady = computed(() => (vault.value?.phrase ?? null) !== null && !vaultStale.value);

async function doJoinByPhrase(): Promise<void> {
  deviceBusy.value = 'phrase-join';
  joinPhraseError.value = '';
  try {
    await joinByPhrase(joinPhrase.value);
    joinPhrase.value = '';
    toast({ title: 'Устройство подключено', description: 'Данные пространства едут с сервера.', tone: 'positive' });
  }
  catch (caught) {
    joinPhraseError.value = caught instanceof Error && caught.message !== ''
      ? caught.message
      : 'не получилось подключиться фразой';
  }
  finally {
    deviceBusy.value = '';
  }
}

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

const revokePhrase = ref('');
/** Без passkey новый мастер заворачивается фразой — её и подтверждаем в диалоге. */
const needRevokePhrase = computed(() =>
  !wraps.value.some(w => w.kind === 'passkey') && wraps.value.some(w => w.kind === 'passphrase'));

async function doRevokeDevice(): Promise<void> {
  const device = revokeDeviceTarget.value;
  if (device === null) return;
  deviceBusy.value = device.pub;
  try {
    // Отзыв ротирует МАСТЕР: локальные обёртки протухают, и способ доступа
    // подтверждается прямо здесь, чтобы завернуть новый мастер тем же способом.
    let confirm;
    const passkeyWrap = wraps.value.find(w => w.kind === 'passkey');
    const phraseWrap = wraps.value.find(w => w.kind === 'passphrase');
    if (passkeyWrap !== undefined) {
      const assertion = await signIn({ rpId, challenge: randomBytes(32) }, passkeyWrap.salt);
      const kek = await kekFromAssertion(assertion, passkeyWrap.salt);
      if (kek === null) throw new Error('этот ключ не отдал PRF — отзыв остановлен');
      confirm = { kek, meta: { kind: 'passkey' as const, label: passkeyWrap.label, salt: passkeyWrap.salt } };
    }
    else if (phraseWrap !== undefined) {
      const clean = normalizePhrase(revokePhrase.value);
      assertKnownPhrase(clean);
      const kek = await kekFromPassphrase(clean, phraseWrap.salt);
      confirm = { kek, meta: { kind: 'passphrase' as const, label: phraseWrap.label, salt: phraseWrap.salt }, phrase: clean };
    }
    await revokeDevice(device, confirm);
    revokePhrase.value = '';
    toast({
      title: 'Устройство отозвано',
      description: confirm?.phrase === undefined && phraseWrap !== undefined
        ? 'Секреты и мастер перевыпущены. Пересоздайте фразу восстановления.'
        : 'Секреты и мастер перевыпущены, ленды перепечатаны.',
      tone: 'positive',
    });
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
            Данные на диске зашифрованы ключом устройства, но при его потере
            восстановить их будет нечем. Настройте фразу или passkey: это
            восстановление, вход с других устройств и — по желанию — замок
            приложения.
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

      <Card v-if="spaces.open && !grantReady" title="Вход фразой">
        <div class="flex flex-col gap-2">
          <p class="text-xs text-text-faint">
            Новое устройство? Введите фразу восстановления пространства — данные
            приедут с сервера, локальные заготовки будут заменены.
          </p>
          <textarea
            v-model="joinPhrase"
            rows="2"
            placeholder="двенадцать слов через пробел"
            aria-label="Фраза пространства"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            class="glass w-full resize-none rounded-control border px-3.5 py-2.5 text-sm text-text
                   transition-[border-color] placeholder:text-text-faint focus:border-accent focus:outline-none"
          />
          <p v-if="vaultStale" class="text-xs text-warning">
            Сейф пространства рассинхронизирован: секреты запечатаны не тем
            мастером, что лежит под фразой. Откройте первое устройство — оно
            перепубликует сейф, и вход фразой оживёт.
          </p>
          <p v-else-if="!vaultReady" class="text-xs text-warning">
            Фразовый вход ещё не приехал с сервера. Проверьте синхронизацию в
            Настройках; если фраза создана давно — откройте ею первое
            устройство один раз, оно опубликует вход.
          </p>
          <p v-if="joinPhraseError" role="alert" class="text-xs text-danger">
            {{ joinPhraseError }}
          </p>
          <div class="flex justify-end">
            <Button
              tone="primary"
              size="sm"
              :disabled="joinPhrase.trim() === '' || !vaultReady"
              :loading="deviceBusy === 'phrase-join'"
              @click="joinPhraseOpen = true"
            >
              Подключиться
            </Button>
          </div>
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

          <div v-if="canCopy" class="flex items-center justify-between gap-3">
            <p class="text-xs text-text-faint">
              Вставили из буфера в надёжное место — сотрите его.
            </p>
            <Button size="sm" @click="copyPhrase(phrase?.join(' ') ?? '')">
              {{ phraseCopied ? 'Скопировано' : 'Скопировать' }}
            </Button>
          </div>

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
           Карточка видна всегда — управление устройствами не должно прятаться
           до момента, когда второе устройство успело объявиться. -->
      <Card v-if="spaces.open" title="Устройства">
        <ul class="flex flex-col divide-y divide-line">
          <li
            v-for="device in devices"
            :key="device.pub"
            class="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
          >
            <MonitorSmartphone class="size-4 shrink-0 text-text-faint" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm text-text">
                {{ device.label }}
                <span v-if="device.pub === myPub" class="text-text-faint">— это устройство</span>
                <span v-else-if="device.revoked" class="text-danger">— отозвано</span>
              </p>
              <p class="text-xs text-text-faint">отпечаток {{ fingerprint(device.pub) }}</p>
            </div>
            <template v-if="device.pub !== myPub && !device.revoked">
              <Button
                size="sm"
                :loading="deviceBusy === device.pub"
                @click="confirmDevice = device; trustDialogOpen = true"
              >
                Доверять
              </Button>
              <Button
                tone="danger"
                size="sm"
                :loading="deviceBusy === device.pub"
                @click="revokeDeviceTarget = device; revokeDeviceOpen = true"
              >
                Отозвать
              </Button>
            </template>
          </li>
        </ul>
        <p v-if="others.length > 0" class="mt-3 text-xs text-text-faint">
          «Доверять» выдаёт секреты после сверки отпечатков на обоих экранах.
          «Отозвать» перевыпускает секреты и мастер: отозванное устройство
          нового не увидит.
        </p>

        <div class="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          <template v-if="inviteLink !== ''">
            <p class="text-xs text-text-faint">
              Ссылка показывается один раз и действует сутки. В ней код доступа
              и токен сервера — отправляйте её только себе.
            </p>
            <div class="flex items-center gap-2">
              <code class="glass min-w-0 flex-1 truncate rounded-control border px-3 py-2 text-xs text-text">{{ inviteLink }}</code>
              <Button size="sm" @click="copyInvite(inviteLink)">
                {{ inviteCopied ? 'Скопировано' : 'Скопировать' }}
              </Button>
            </div>
            <div class="flex justify-end">
              <Button size="sm" tone="danger" @click="doDropInvite">Погасить</Button>
            </div>
          </template>
          <template v-else>
            <div class="flex items-center justify-between gap-3">
              <p class="min-w-0 flex-1 text-xs text-text-faint">
                {{ invite
                  ? 'Приглашение действует: ссылка была показана при создании.'
                  : 'Новое устройство проще всего подключить ссылкой: открыл — и готово.' }}
              </p>
              <Button v-if="invite" size="sm" tone="danger" @click="doDropInvite">Погасить</Button>
              <Button v-else size="sm" tone="primary" :disabled="!syncOn" :loading="inviteBusy" @click="doCreateInvite">
                Пригласить
              </Button>
            </div>
            <p v-if="!syncOn" class="text-xs text-text-faint">
              Для приглашений нужна синхронизация: подключите сервер в Настройках.
            </p>
          </template>
        </div>
      </Card>

      <!-- Замок — выбор (docs/01-security.md §5): тумблер убирает или
           возвращает тихий ключ устройства. Показывается только с настроенным
           доступом: иначе замок захлопнулся бы перед человеком без ключа. -->
      <Card v-if="configured" title="Замок приложения">
        <SwitchField
          :model-value="guarded"
          label="Запирать приложение"
          description="Вход по passkey или фразе на каждом запуске и после отлучки.
            Выключено — открывается сразу: данные на диске всё равно зашифрованы,
            но ключ хранит сам браузер."
          @update:model-value="toggleGuard"
        />
        <div v-if="guarded" class="mt-1 flex items-center gap-3 border-t border-line pt-3">
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
    >
      <div v-if="needRevokePhrase" class="mt-3 flex flex-col gap-1.5">
        <p class="text-xs text-text-faint">
          Подтвердите фразой восстановления: ею будет завёрнут новый мастер.
        </p>
        <textarea
          v-model="revokePhrase"
          rows="2"
          placeholder="двенадцать слов через пробел"
          aria-label="Фраза восстановления"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          class="glass w-full resize-none rounded-control border px-3.5 py-2.5 text-sm text-text
                 transition-[border-color] placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
      </div>
    </ConfirmDialog>

    <ConfirmDialog
      v-model:open="inviteJoinOpen"
      title="Подключиться по приглашению?"
      description="Местные данные этого устройства будут заменены данными пространства. Всё, что вы успели записать здесь, будет стёрто."
      confirm-label="Подключиться"
      @confirm="doJoinByInvite"
    />

    <ConfirmDialog
      v-model:open="joinPhraseOpen"
      title="Подключиться к пространству?"
      description="Местные данные этого устройства будут заменены данными пространства. Всё, что вы успели записать здесь, будет стёрто."
      confirm-label="Подключиться"
      @confirm="doJoinByPhrase"
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
