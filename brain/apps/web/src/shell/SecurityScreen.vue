<script setup lang="ts">
import { computed, ref } from 'vue';
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
  hasPlatformAuthenticator,
  isKnownPhrase,
  isSupported,
  kekFromAssertion,
  kekFromPassphrase,
  normalizePhrase,
  quizIndexes,
  randomBytes,
  register,
  authenticate as signIn,
  unlock as unlockVault,
} from '@brain/auth';
import { useSyncSettings } from '@/sync';
import { pushWrapsToServer, revokeAccess } from '@/security/account';
import { addAccess, freshSalt, removeAccess, useLock } from '../security/lock';
import { Fingerprint, KeyRound, Lock, TriangleAlert } from 'lucide-vue-next';
import type { RevokeRemaining } from '@/security/account';
import type { WrappedDek } from '@brain/auth';

/**
 * Настройка доступа: passkey и фраза восстановления.
 *
 * Работает БЕЗ сервера, и это не заглушка: ключ шифрования выводится из passkey
 * прямо на устройстве через PRF, серверу в этой схеме нечего проверять
 * (docs/01-security.md §3). Сервер понадобится для синхронизации, а не для
 * того, чтобы данные были зашифрованы.
 *
 * Ключ данных здесь НЕ заводится. Он уже есть — приложение завело его на первом
 * запуске и держит завёрнутым в ключ устройства (§5.1); настройка лишь
 * добавляет ещё одну обёртку ТОГО ЖЕ ключа через `wrapFor`. Прежняя редакция
 * звала `createDek()` на каждый способ доступа, и это был не стилистический
 * промах, а потеря данных: фраза восстановления заворачивала ключ, которым
 * ничего не зашифровано, то есть открывала пустоту.
 */

const supported = useSupported(isSupported);
// Встроенный авторизатор опрашивается асинхронно. До ответа считаем, что его
// нет: подпись «откроется пальцем» на устройстве без биометрии — обещание,
// которого не сдержать, а обратная ошибка стоит лишь строчки текста.
const platform = computedAsync(hasPlatformAuthenticator, false);
const { access: wraps, configured, lock } = useLock();
const { settings: syncSettings, configured: syncBound } = useSyncSettings();
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

/**
 * Ярлык обёртки для показа человеку. У passkey, заведённого через привязку
 * сервера (`bindAccount`, `security/account.ts`), метка — id credential'а
 * (нужен, чтобы присоединение узнавало «свой» credential среди чужих,
 * docs/01-security.md §7), а не то, что стоит печатать на экране. Локальный
 * `addPasskey` ниже по-прежнему кладёт литеральное `'passkey'` — оно короткое
 * и уже читаемо, эвристика его не трогает.
 */
function displayLabel(wrap: WrappedDek): string {
  return wrap.kind === 'passkey' && wrap.label.length > 20 ? 'Passkey' : wrap.label;
}

/** После добавления способа доступа — если сервер привязан, обновить его копию обёрток. */
async function syncWrapsIfBound(): Promise<void> {
  if (!syncBound.value) return;
  try {
    await pushWrapsToServer(syncSettings.value.url);
  }
  catch (caught) {
    // Локальный способ уже добавлен и рабочий — отказ синка с сервером сюда
    // не должен откатывать его, только предупредить.
    toast({
      title: 'Не удалось обновить обёртки на сервере',
      description: caught instanceof Error ? caught.message : String(caught),
      tone: 'danger',
    });
  }
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
    await syncWrapsIfBound();
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
    await syncWrapsIfBound();
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'не получилось сохранить фразу';
  }
  finally {
    busy.value = '';
  }
}

// ── Отзыв ─────────────────────────────────────────────────────────────────
//
// Без сервера «убрать» — локальное действие (`removeAccess`), как и было.
// С сервером убрать способ мало: снятая ранее копия обёртки продолжила бы
// подходить (docs/01-security.md §7) — нужны новый DEK, перепечатка лендов и
// замена журналов на сервере (`revokeAccess`, `security/account.ts`). Для
// ЭТОГО ей нужны свежие KEK всех ОСТАЛЬНЫХ способов — их неоткуда взять, кроме
// как переспросить: `OpenVault` не хранит, каким KEK его открыли, а текст
// фразы нигде не сохраняется по построению (§6). Очередь ниже проводит
// человека через оставшиеся способы один за другим.

const revokeDialogOpen = ref(false);
const confirmRevoke = ref<WrappedDek | null>(null);
const revokeQueue = ref<WrappedDek[]>([]);
const revokeCollected = ref<RevokeRemaining[]>([]);
const revokePhrase = ref('');
const revokeBusy = ref(false);

const revokeCurrent = computed(() => revokeQueue.value[0] ?? null);

function remove(label: string): void {
  const wrap = wraps.value.find(w => w.label === label);
  if (wrap === undefined) return;

  if (!syncBound.value) {
    try {
      removeAccess(label);
    }
    catch (caught) {
      error.value = caught instanceof Error ? caught.message : 'не получилось убрать способ доступа';
    }
    return;
  }

  confirmRevoke.value = wrap;
  revokeDialogOpen.value = true;
}

/** Зовётся `@confirm` у диалога — ДО того, как примитив его закроет. */
function startRevokeQueue(): void {
  if (confirmRevoke.value === null) return;
  const removed = confirmRevoke.value.label;
  revokeQueue.value = wraps.value.filter(w => w.label !== removed);
  revokeCollected.value = [];
  revokePhrase.value = '';
  error.value = '';
}

function cancelRevoke(): void {
  confirmRevoke.value = null;
  revokeQueue.value = [];
  revokeCollected.value = [];
  revokePhrase.value = '';
  error.value = '';
}

/** Шаг очереди: passkey — просто переспросить биометрией, KEK не нужно вводить. */
async function confirmRevokeStepPasskey(): Promise<void> {
  const wrap = revokeCurrent.value;
  if (wrap === null) return;
  revokeBusy.value = true;
  error.value = '';
  try {
    const assertion = await signIn({ rpId, challenge: randomBytes(32) }, wrap.salt);
    const kek = await kekFromAssertion(assertion, wrap.salt);
    if (kek === null) throw new Error('этот ключ не отдал PRF — отзыв остановлен');
    revokeCollected.value = [...revokeCollected.value, { wrap, kek }];
    revokeQueue.value = revokeQueue.value.slice(1);
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'не получилось подтвердить passkey';
  }
  finally {
    revokeBusy.value = false;
  }
}

/** Шаг очереди: фраза — вводится заново; проверяется РЕАЛЬНЫМ снятием обёртки, а не только словарём. */
async function confirmRevokeStepPhrase(): Promise<void> {
  const wrap = revokeCurrent.value;
  if (wrap === null) return;
  if (!isKnownPhrase(revokePhrase.value)) {
    error.value = 'в этой фразе есть слова не из словаря';
    return;
  }
  revokeBusy.value = true;
  error.value = '';
  try {
    const kek = await kekFromPassphrase(normalizePhrase(revokePhrase.value), wrap.salt);
    await unlockVault(wrap, kek); // бросает, если фраза не та — до похода в revokeAccess
    revokeCollected.value = [...revokeCollected.value, { wrap, kek }];
    revokeQueue.value = revokeQueue.value.slice(1);
    revokePhrase.value = '';
  }
  catch {
    error.value = 'фраза не подошла';
  }
  finally {
    revokeBusy.value = false;
  }
}

async function finishRevoke(): Promise<void> {
  if (confirmRevoke.value === null) return;
  revokeBusy.value = true;
  error.value = '';
  try {
    await revokeAccess(syncSettings.value.url, confirmRevoke.value.label, revokeCollected.value);
    confirmRevoke.value = null;
    toast({ title: 'Способ доступа отозван', tone: 'positive' });
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'не удалось отозвать способ доступа';
  }
  finally {
    revokeBusy.value = false;
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
              @click="remove(wrap.label)"
            >
              Убрать
            </Button>
          </li>
        </ul>
        <p class="mt-3 text-xs text-text-faint">
          Убрать последний способ нельзя: данные стали бы недоступны навсегда.
        </p>
      </Card>

      <!-- Очередь отзыва: способ подтверждён к удалению, сервер привязан —
           нужны свежие KEK всех остальных способов, чтобы перевыпустить их
           под новым DEK (docs/01-security.md §7). -->
      <Card v-if="confirmRevoke !== null" title="Отзыв доступа">
        <div class="flex flex-col gap-3">
          <p class="text-sm text-text-soft">
            Убираем «{{ displayLabel(confirmRevoke) }}». Ленды будут перепечатаны под новым ключом,
            а сервер обязан подтвердить каждый — это требует сети.
          </p>

          <div v-if="revokeCurrent !== null" class="flex flex-col gap-2">
            <p class="text-xs text-text-faint">
              Подтвердите оставшийся способ «{{ displayLabel(revokeCurrent) }}» — им перевыпустят доступ:
            </p>
            <Button
              v-if="revokeCurrent.kind === 'passkey'"
              tone="primary"
              size="sm"
              :loading="revokeBusy"
              @click="confirmRevokeStepPasskey"
            >
              Подтвердить passkey
            </Button>
            <template v-else>
              <textarea
                v-model="revokePhrase"
                rows="3"
                placeholder="двенадцать слов через пробел"
                aria-label="Фраза восстановления"
                autocomplete="off"
                class="glass w-full resize-none rounded-control border px-3.5 py-2.5 text-sm text-text
                       transition-[border-color] placeholder:text-text-faint focus:border-accent focus:outline-none"
              />
              <Button
                tone="primary"
                size="sm"
                :disabled="revokePhrase.trim() === ''"
                :loading="revokeBusy"
                @click="confirmRevokeStepPhrase"
              >
                Подтвердить фразу
              </Button>
            </template>
          </div>

          <Button
            v-else
            tone="danger"
            size="sm"
            :loading="revokeBusy"
            @click="finishRevoke"
          >
            Завершить отзыв
          </Button>

          <Button size="sm" tone="ghost" :disabled="revokeBusy" @click="cancelRevoke">Отмена</Button>
        </div>
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
      v-if="confirmRevoke !== null"
      v-model:open="revokeDialogOpen"
      title="Отозвать способ доступа?"
      :description="`Убрав «${displayLabel(confirmRevoke)}», вы перепечатаете все ленды под новым ключом `
        + 'и замените журналы на сервере — снятая раньше копия обёртки перестанет подходить. '
        + 'Нужна сеть: сервер обязан подтвердить каждый ленд.'"
      confirm-label="Продолжить"
      @confirm="startRevokeQueue"
    />
  </Page>
</template>
