<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Spinner } from '@brain/ui';
import { useInboxActions } from '../db/inbox';

/**
 * Приёмник share target: то, чем поделились из другого приложения.
 *
 * Экран ничего не спрашивает и сразу уходит в инбокс. Шаринг — это жест «на
 * потом», и диалог «куда положить» посреди него ломает ровно то, ради чего
 * инбокс заведён: захват должен быть дешевле решения.
 *
 * Метод GET, а не POST: POST-вариант требует сервис-воркера, который перехватит
 * запрос, а он приедет вместе с офлайн-кэшем.
 */
const route = useRoute();
const router = useRouter();
const actions = useInboxActions();

function one(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

// onMounted не случаен: `replace` посреди ещё идущего перехода на этот экран
// был бы гонкой с роутером — уходим только после того, как он завершился.
onMounted(() => {
  const title = one(route.query['title']);
  const text = one(route.query['text']);
  const url = one(route.query['url']);

  // Заголовок информативнее текста, а текст — информативнее пустоты.
  const caption = [title, text].find(value => value.trim() !== '') ?? '';
  actions.capture({
    text: caption,
    ...(url !== '' && { url }),
    source: 'поделились',
  });

  // `replace`, а не `push`: возврат назад не должен приводить к повторному захвату.
  void router.replace('/inbox');
});
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center gap-2 text-text-faint">
    <Spinner />
    Сохраняем в инбокс…
  </div>
</template>
