<script setup lang="ts">
import { ref, useTemplateRef } from 'vue';
import { useSpace } from '@sync/vue';
import { Button, Card } from '@brain/ui';
import { downloadBackupFile, exportBackup, importBackup, parseBackup } from '../../features/backup';

/**
 * Бэкап дневника: снимок в файл и обратно.
 *
 * Формат — v1 отдельного приложения «Ккал», и это не дань прошлому: файл
 * бэкапа остаётся единственной дорогой, по которой данные из старой установки
 * попадают сюда. Импорт СЛИВАЕТ по id, а не заменяет: два устройства с общим
 * прошлым после обмена файлами сходятся, а не затирают друг друга.
 */
const space = useSpace();

const fileInput = useTemplateRef<HTMLInputElement>('file');
const busy = ref(false);
const notice = ref('');
const error = ref('');

function save(): void {
  error.value = '';
  notice.value = '';
  const payload = exportBackup(space);
  downloadBackupFile(payload);
  notice.value = `Сохранено: ${payload.foods.length} продуктов, ${payload.entries.length} записей.`;
}

async function restore(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // Тот же файл, выбранный второй раз, не поднимает `change` без сброса значения.
  input.value = '';
  if (file === undefined) return;

  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const { payload, skipped } = parseBackup(await file.text());
    const summary = importBackup(space, payload);
    const skippedNote = skipped > 0 ? `, пропущено битых: ${skipped}` : '';
    notice.value = `Влито: ${summary.foods} продуктов, ${summary.entries} записей, `
      + `${summary.weights} замеров веса${summary.profile ? ', профиль' : ''}${skippedNote}.`;
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось прочитать файл';
  }
  finally {
    busy.value = false;
  }
}
</script>

<template>
  <Card title="Бэкап">
    <div class="flex flex-wrap gap-2">
      <Button @click="save">Выгрузить в файл</Button>
      <Button :loading="busy" @click="fileInput?.click()">Восстановить из файла</Button>
      <input
        ref="file"
        type="file"
        accept="application/json,.json"
        class="sr-only"
        @change="value => void restore(value)"
      >
    </div>

    <p v-if="notice !== ''" class="mt-3 text-xs text-text-soft">{{ notice }}</p>
    <p v-if="error !== ''" class="mt-3 rounded-control bg-danger-soft px-3 py-2 text-xs text-danger">
      {{ error }}
    </p>

    <p class="mt-3 text-xs leading-relaxed text-text-faint">
      Файл совместим с прежним приложением «Ккал»: тот же формат в обе стороны.
      Восстановление дописывает данные к текущим, совпадающие записи обновляются.
    </p>
  </Card>
</template>
