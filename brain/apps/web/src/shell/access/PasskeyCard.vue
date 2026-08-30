<script setup lang="ts">
import { computed } from 'vue';
import { computedAsync, useSupported } from '@robonen/vue';
import { Button, Card } from '@brain/ui';
import {
  hasPlatformAuthenticator,
  isSupported,
  kekFromAssertion,
  randomBytes,
  register,
  authenticate as signIn,
} from '@brain/auth';
import { Fingerprint } from 'lucide-vue-next';
import { useAction } from '@/app/action';
import { addAccess, freshSalt, useLock } from '@/security/lock';
import { RP_ID } from './use-access';

/**
 * Passkey: биометрия открывает данные. KEK выводится из PRF passkey и не
 * покидает устройство — серверу в этой схеме нечего проверять.
 */

const supported = useSupported(isSupported);
// Встроенный авторизатор опрашивается асинхронно. До ответа считаем, что его
// нет: «откроется пальцем» на устройстве без биометрии — обещание, которого
// не сдержать, а обратная ошибка стоит лишь строчки текста.
const platform = computedAsync(hasPlatformAuthenticator, false);

const { access: wraps } = useLock();
const hasPasskey = computed(() => wraps.value.some(wrap => wrap.kind === 'passkey'));

const add = useAction(async () => {
  const created = await register({
    rpId: RP_ID,
    rpName: 'brain',
    userHandle: randomBytes(16),
    userName: 'brain',
    challenge: randomBytes(32),
  });
  if (!created.prf) {
    throw new Error('Этот ключ не поддерживает вывод шифровального ключа (PRF). '
      + 'Настройте фразу восстановления — она будет единственным способом открыть данные.');
  }

  // Второе обращение — уже за самим выводом PRF: на регистрации многие
  // авторизаторы значение не отдают, только признак поддержки.
  const salt = freshSalt();
  const assertion = await signIn({ rpId: RP_ID, challenge: randomBytes(32) }, salt);
  const kek = await kekFromAssertion(assertion, salt);
  if (kek === null) {
    throw new Error('Ключ создан, но PRF не отдал значение. Используйте фразу восстановления.');
  }

  await addAccess(kek, { kind: 'passkey', label: 'passkey', salt });
}, 'не получилось создать ключ');
</script>

<template>
  <Card title="Passkey">
    <div class="flex items-start gap-3">
      <Fingerprint class="mt-0.5 size-5 shrink-0 text-text-faint" />
      <div class="min-w-0 flex-1">
        <p class="text-sm text-text">{{ hasPasskey ? 'Настроен' : 'Не настроен' }}</p>
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
        :loading="add.busy.value"
        :disabled="!supported"
        @click="add.run()"
      >
        Настроить
      </Button>
    </div>
    <p v-if="add.error.value" role="alert" class="mt-2 text-xs text-danger">{{ add.error.value }}</p>
  </Card>
</template>
