<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { CalendarDays } from 'lucide-vue-next';
import { Popover } from '@brain/ui';
import { dayTitle } from '@brain/std';
import { scheduleOptions } from '../../entities/schedule';

/**
 * Планировщик срока: быстрые варианты плюс поле даты.
 *
 * Поповер, а не голый `input[type=date]`, потому что в девяти случаях из десяти
 * нужный день называется словом — «завтра», «выходные», — и заставлять
 * пользователя переводить это слово в число значит перекладывать на него работу
 * календаря. Само поле остаётся: десятый случай — «14 октября», и его словом не
 * скажешь.
 *
 * Варианты считает `entities/schedule.ts`. Здесь нет ни одного `addDays`: два
 * места, считающие «ближайшую субботу», рано или поздно посчитают её по-разному.
 */
const { today } = defineProps<{ today: string }>();

const dueAt = defineModel<string>({ required: true });

const open = shallowRef(false);

const options = computed(() => scheduleOptions(today, dueAt.value));
const label = computed(() => (dueAt.value === '' ? 'Без срока' : dayTitle(dueAt.value, today)));

function pick(next: string | null): void {
  dueAt.value = next ?? '';
  open.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <span class="text-[0.8125rem] font-medium text-text-soft">Срок</span>

    <Popover v-model:open="open" align="start">
      <template #trigger>
        <CalendarDays class="size-4 shrink-0 text-text-faint" />
        <span :class="dueAt === '' ? 'text-text-faint' : 'text-text'">{{ label }}</span>
      </template>

      <div class="flex flex-col gap-3">
        <ul class="flex flex-col">
          <li v-for="option in options" :key="option.id">
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-control px-2.5 py-2 text-left text-sm
                     transition-colors hover:bg-sunken"
              :class="option.dueAt === null ? 'text-danger' : 'text-text'"
              @click="pick(option.dueAt)"
            >
              <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
              <span v-if="option.hint" class="shrink-0 text-xs text-text-faint">{{ option.hint }}</span>
            </button>
          </li>
        </ul>

        <label class="flex flex-col gap-1.5 border-t border-line pt-3">
          <span class="text-xs text-text-faint">Другой день</span>
          <input
            :value="dueAt"
            type="date"
            class="h-10 w-full rounded-control border border-line bg-surface px-3 text-sm text-text
                   transition-colors hover:border-line-strong"
            @change="pick((($event.target as HTMLInputElement).value) || null)"
          >
        </label>
      </div>
    </Popover>
  </div>
</template>
