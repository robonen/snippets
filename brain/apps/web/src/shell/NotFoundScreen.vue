<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { EmptyState, Page } from '@brain/ui';
</script>

<template>
  <Page width="reading">
    <EmptyState
      title="Такой страницы нет"
      description="Ссылка ведёт в модуль, которого нет в этой сборке."
    >
      <template #action>
        <RouterLink to="/" class="text-sm text-accent underline underline-offset-4">
          Вернуться на «Сегодня»
        </RouterLink>
      </template>
    </EmptyState>
  </Page>
</template>
