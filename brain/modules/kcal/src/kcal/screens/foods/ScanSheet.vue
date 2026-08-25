<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Button, Sheet, Spinner } from '@brain/ui';
import BarcodeScanner from '../../features/barcode/BarcodeScanner.vue';
import { digitsOnly, fetchOffByBarcode, isBarcode } from '../../features/barcode/off';
import { scanSupport } from '../../features/barcode/scan';
import type { OffProduct } from '../../features/barcode/off';

/**
 * Поиск продукта по штрихкоду упаковки.
 *
 * Два входа в одно и то же: камера и цифры руками. Ручной ввод не запасной путь
 * для «сломалось», а основной для половины устройств — в WebKit читать
 * штрихкоды нечем (см. `features/barcode/scan.ts`), и упрятать поле под
 * ошибку значило бы оставить эту половину вовсе без базы упаковок.
 */
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ found: [product: OffProduct] }>();

const cameraSupported = scanSupport() === 'ready';
const cameraOn = ref(false);
const code = ref('');
const busy = ref(false);
const error = ref('');

const ready = computed(() => isBarcode(code.value) && !busy.value);

watch(open, (value) => {
  if (value) return;
  // Лист закрыт — камера обязана погаснуть вместе с ним, а не «когда-нибудь».
  cameraOn.value = false;
  code.value = '';
  error.value = '';
});

async function lookup(raw: string): Promise<void> {
  const digits = digitsOnly(raw);
  if (digits === '' || busy.value) return;

  cameraOn.value = false;
  busy.value = true;
  error.value = '';
  try {
    const product = await fetchOffByBarcode(digits);
    if (product === null) {
      error.value = `Штрихкод ${digits} не найден в базе — заведите продукт вручную с упаковки.`;
      return;
    }
    // Сначала закрываем лист, потом отдаём находку: иначе карточка продукта
    // открылась бы поверх ещё живого диалога, деля с ним ловушку фокуса.
    open.value = false;
    emit('found', product);
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'База недоступна';
  }
  finally {
    busy.value = false;
  }
}
</script>

<template>
  <Sheet v-model:open="open" title="Штрихкод упаковки" description="КБЖУ подтянутся из Open Food Facts">
    <div class="flex flex-col gap-3">
      <Button v-if="cameraSupported && !cameraOn" block @click="cameraOn = true">
        Сканировать камерой
      </Button>

      <BarcodeScanner
        v-if="cameraOn"
        @detected="value => void lookup(value)"
        @cancel="cameraOn = false"
      />

      <form class="flex gap-2" @submit.prevent="void lookup(code)">
        <input
          v-model="code"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          placeholder="Цифры под штрихкодом"
          aria-label="Цифры штрихкода"
          class="tnum h-10 min-w-0 flex-1 rounded-control border border-line bg-surface px-3 text-sm
                 text-text placeholder:text-text-faint"
        >
        <Button tone="primary" type="submit" :disabled="!ready" :loading="busy">
          Найти
        </Button>
      </form>

      <p v-if="busy" class="flex items-center gap-2 text-xs text-text-faint">
        <Spinner class="size-4" />
        Ищем в базе упаковок…
      </p>

      <p v-if="error !== ''" class="rounded-control bg-danger-soft px-3 py-2.5 text-xs leading-relaxed text-danger">
        {{ error }}
      </p>

      <p class="text-xs leading-relaxed text-text-faint">
        Open Food Facts — открытая база, её заполняют люди. Найденное откроется
        карточкой продукта: сверьте цифры с этикеткой перед сохранением.
      </p>
    </div>
  </Sheet>
</template>
