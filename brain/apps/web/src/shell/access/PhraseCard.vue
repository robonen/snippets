<script setup lang="ts">
import { computed, ref } from 'vue';
import { useClipboard } from '@robonen/vue';
import { Button, Card, TextField } from '@brain/ui';
import { createPhrase, kekFromPassphrase, normalizePhrase, quizIndexes } from '@brain/auth';
import { KeyRound } from 'lucide-vue-next';
import { useAction } from '@/app/action';
import { addAccess, freshSalt, useLock } from '@/security/lock';
import { publishPhraseAccess } from '@/security/space';
import { useAccess } from './use-access';

/**
 * Фраза восстановления — единственный путь к данным, когда устройство с
 * passkey потеряно. Показывается один раз, проверяется двумя словами.
 */

const { access: wraps } = useLock();
const { member, spaces } = useAccess();
const hasPhrase = computed(() => wraps.value.some(wrap => wrap.kind === 'passphrase'));

// Фраза показывается ровно один раз — хранить её негде и незачем.
const phrase = ref<string[] | null>(null);
const quiz = ref<number[]>([]);
const answers = ref<Record<number, string>>({});

// Копирование фразы: удобнее, чем диктовать себе в блокнот с опечатками.
// Буфер обмена — не хранилище: вставили в менеджер паролей — сотрите.
const { copy, copied, isSupported: canCopy } = useClipboard();

const quizPassed = computed(() =>
  phrase.value !== null
  && quiz.value.length > 0
  && quiz.value.every(index => normalizePhrase(answers.value[index] ?? '') === phrase.value?.[index]));

function start(): void {
  phrase.value = createPhrase();
  quiz.value = quizIndexes(2);
  answers.value = {};
}

const confirm = useAction(async () => {
  if (phrase.value === null || !quizPassed.value) return;
  const salt = freshSalt();
  const kek = await kekFromPassphrase(normalizePhrase(phrase.value), salt);
  await addAccess(kek, { kind: 'passphrase', label: 'фраза', salt });
  // Та же фраза открывает пространство с ЛЮБОГО устройства: мастер под её
  // KEK'ом публикуется в сейфе ленда `keys` (модель crus). Только член
  // пространства: устройство вне его затёрло бы чужой фразовый вход.
  if (spaces.open && member.value) await publishPhraseAccess(kek, salt);
  phrase.value = null;
}, 'не получилось сохранить фразу');
</script>

<template>
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
      <Button v-if="!hasPhrase" size="sm" @click="start">Создать</Button>
    </div>

    <div v-else class="flex flex-col gap-3">
      <p class="text-xs text-text-faint">
        Запишите двенадцать слов по порядку. Показываются один раз.
      </p>
      <ol class="grid grid-cols-2 gap-1.5 rounded-card bg-sunken p-3 sm:grid-cols-3">
        <li v-for="(word, index) in phrase" :key="index" class="flex gap-1.5 text-sm text-text">
          <span class="tnum w-5 shrink-0 text-right text-text-faint">{{ index + 1 }}.</span>
          {{ word }}
        </li>
      </ol>

      <div v-if="canCopy" class="flex items-center justify-between gap-3">
        <p class="text-xs text-text-faint">
          Вставили из буфера в надёжное место — сотрите его.
        </p>
        <Button size="sm" @click="copy(phrase?.join(' ') ?? '')">
          {{ copied ? 'Скопировано' : 'Скопировать' }}
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

      <p v-if="confirm.error.value" role="alert" class="text-xs text-danger">{{ confirm.error.value }}</p>

      <div class="flex justify-end gap-2">
        <Button size="sm" @click="phrase = null">Отмена</Button>
        <Button
          tone="primary"
          size="sm"
          :disabled="!quizPassed"
          :loading="confirm.busy.value"
          @click="confirm.run()"
        >
          Я записал
        </Button>
      </div>
    </div>
  </Card>
</template>
