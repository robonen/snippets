<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { SplitView } from '@brain/ui';
import NotesScreen from './list/NotesScreen.vue';

/**
 * Рама модуля: список слева, открытая заметка справа.
 *
 * Список живёт ЗДЕСЬ, а не под `<RouterView>`, и это вся суть перестройки: он
 * лежит выше сменной части, поэтому переход к соседней заметке его не
 * пересобирает — поиск, срез, выбранные теги и прокрутка рельса остаются, где
 * были. Навигация «туда-обратно» рождала список заново на каждом возвращении.
 *
 * Заметка при этом остаётся АДРЕСОМ (`/notes/:id`), а не состоянием экрана: её
 * выдают палитра, глобальный поиск, панель упоминаний и `[[wikilinks]]`, и все
 * они ведут ссылкой — с «открыть в новой вкладке» и «скопировать адрес». Один
 * экран, решающий сам, что показать, отобрал бы у них этот адрес.
 */
const route = useRoute();

// Что показать на узком экране, решает рама, а не `SplitView`: «открыто» здесь
// значит «в адресе есть заметка», и знание это доменное.
const showDetail = computed(() => route.params['id'] !== undefined);
</script>

<template>
  <SplitView :show-detail="showDetail">
    <template #list>
      <NotesScreen />
    </template>

    <template #detail>
      <RouterView />
    </template>
  </SplitView>
</template>
