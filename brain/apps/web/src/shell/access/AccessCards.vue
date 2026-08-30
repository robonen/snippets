<script setup lang="ts">
import { Card } from '@brain/ui';
import { TriangleAlert } from 'lucide-vue-next';
import { useLock } from '@/security/lock';
import AccessMethodsCard from './AccessMethodsCard.vue';
import DevicesCard from './DevicesCard.vue';
import LockCard from './LockCard.vue';
import PasskeyCard from './PasskeyCard.vue';
import PhraseCard from './PhraseCard.vue';
import RecoveryCard from './RecoveryCard.vue';
import { useAccess } from './use-access';

/**
 * Стопка карточек экрана «Доступ». Отдельный компонент не ради красоты:
 * экран монтирует его ПОД `v-if="spaces.open"`, и когда присоединение к
 * пространству пересобирает ленды (seal → wipe → unseal), стопка
 * перемонтируется целиком — каждая карточка подписывается на СВЕЖИЕ ленды.
 * Подписка, пережившая пересборку, смотрела бы в закрытый ленд и замерла бы
 * навсегда.
 */

const { configured } = useLock();
const { identityError, keeping, member } = useAccess();
</script>

<template>
  <div class="flex flex-col gap-3">
    <Card v-if="identityError">
      <div class="flex gap-3">
        <TriangleAlert class="mt-0.5 size-5 shrink-0 text-danger" />
        <p class="text-sm text-text-soft">{{ identityError }}</p>
      </div>
    </Card>

    <Card v-if="keeping === 'memory'">
      <div class="flex gap-3">
        <TriangleAlert class="mt-0.5 size-5 shrink-0 text-danger" />
        <p class="text-sm text-text-soft">
          Этот браузер не сохраняет ключи устройства: каждое открытие будет
          новым устройством в списке. Откройте приложение в Safari или Chrome
          (не во встроенном браузере мессенджера) либо установите его на
          экран «Домой».
        </p>
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

    <PasskeyCard />
    <PhraseCard />
    <AccessMethodsCard v-if="configured" />
    <DevicesCard />
    <!-- Фраза — запасной вход: когда приглашение получить негде (все
         устройства потеряны). Показывается только устройству вне пространства. -->
    <RecoveryCard v-if="!member" />
    <LockCard v-if="configured" />
  </div>
</template>
