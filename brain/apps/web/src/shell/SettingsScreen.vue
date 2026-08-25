<script setup lang="ts">
import { RouterLink } from 'vue-router';
import {
  Card,
  Page,
  PageHeader,
  ThemeToggle,
} from '@brain/ui';
import { ChevronRight } from 'lucide-vue-next';
import SyncCard from '@/shell/SyncCard.vue';
</script>

<template>
  <Page width="list">
    <PageHeader title="Настройки" />

    <div class="flex flex-col gap-3">
      <Card title="Оформление">
        <div class="flex items-center justify-between gap-4">
          <p class="text-sm text-text-soft">Тема</p>
          <ThemeToggle />
        </div>
      </Card>

      <Card title="Безопасность">
        <RouterLink
          to="/settings/security"
          class="flex items-center gap-3 rounded-control -mx-2 px-2 py-1.5 transition-colors hover:bg-sunken"
        >
          <div class="min-w-0 flex-1">
            <p class="text-sm text-text">Доступ и ключи</p>
            <p class="mt-0.5 text-xs text-text-faint">
              Passkey, фраза восстановления, замок приложения
            </p>
          </div>
          <ChevronRight class="size-4 shrink-0 text-text-faint" />
        </RouterLink>
      </Card>

      <SyncCard />
    </div>
  </Page>
</template>
