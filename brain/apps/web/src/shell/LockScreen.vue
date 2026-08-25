<script setup lang="ts">
import { ref } from 'vue';
import { useDateFormat, useNow } from '@robonen/vue';
import { Button } from '@brain/ui';
import { Fingerprint, KeyRound } from 'lucide-vue-next';
import { unlockByPasskey, unlockByPhrase } from '../security/lock';

/**
 * Экран замка. Показывается ВМЕСТО содержимого, а не поверх него — и теперь это
 * буквально: пока заперто, шифрованные ленды не подняты вовсе, показывать
 * попросту нечего.
 *
 * Композиция та же, что на старте, и это не лень: замок — второе по частоте
 * место, куда попадает человек, и оно обязано выглядеть той же системой, а не
 * служебной страницей из другого приложения.
 *
 * Кнопка держит состояние загрузки до конца: за ней не только биометрия, но и
 * расшифровка лендов. Отпустить её раньше значило бы показать пустые экраны и
 * заставить человека решить, что данные пропали.
 */
const rpId = globalThis.location.hostname;

const now = useNow({ interval: 60_000 });
const clock = useDateFormat(now, 'HH:mm');

const busy = ref(false);
const error = ref('');
const phrase = ref('');
const byPhrase = ref(false);

async function attempt(open: () => Promise<void>): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    await open();
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'не получилось открыть';
  }
  finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="ambient grid min-h-dvh place-items-center px-6">
    <div class="flex w-full max-w-sm flex-col items-center gap-8">
      <!-- Часы вместо перечёркнутого замка: время полезно и заперто, и
           открыто, а иконка замка сообщала бы только то, что человек уже
           знает — он же сам его и захлопнул. -->
      <p class="text-display text-[clamp(3.5rem,12vw,5.5rem)] leading-none font-light text-text">
        {{ clock }}
      </p>

      <div class="flex flex-col items-center gap-1.5 text-center">
        <p class="text-sm font-medium text-text">Заперто</p>
        <p class="max-w-[26ch] text-[0.8125rem] leading-relaxed text-text-faint">
          Данные на месте — нужен ключ, чтобы их показать.
        </p>
      </div>

      <div v-if="!byPhrase" class="flex w-full flex-col gap-2">
        <Button
          tone="primary"
          size="lg"
          block
          :loading="busy"
          @click="attempt(() => unlockByPasskey(rpId))"
        >
          <Fingerprint class="size-4" />
          Открыть
        </Button>
        <Button tone="ghost" size="sm" block @click="byPhrase = true">
          <KeyRound class="size-3.5" />
          Ввести фразу восстановления
        </Button>
      </div>

      <form
        v-else
        class="flex w-full flex-col gap-2"
        @submit.prevent="attempt(() => unlockByPhrase(phrase))"
      >
        <textarea
          v-model="phrase"
          rows="3"
          placeholder="двенадцать слов через пробел"
          aria-label="Фраза восстановления"
          autocomplete="off"
          class="glass w-full resize-none rounded-control border px-3.5 py-2.5 text-sm text-text
                 transition-[border-color] placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
        <Button tone="primary" type="submit" block :loading="busy">Открыть</Button>
        <Button tone="ghost" size="sm" block @click="byPhrase = false">Назад</Button>
      </form>

      <p
        v-if="error"
        role="alert"
        class="max-w-[30ch] text-center text-[0.8125rem] leading-relaxed text-danger"
      >
        {{ error }}
      </p>
    </div>
  </div>
</template>
