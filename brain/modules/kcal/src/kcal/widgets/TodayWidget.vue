<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { Meter } from '@brain/ui';
import { useToday } from '@brain/module-kit';
import { useEntries, useProfile } from '../db/composables';
import { sumNutrients } from '../entities/nutrition';
import { fmtKcal } from '../lib/format';
import { useSectionRequests } from '../screens/section';

/**
 * Карточка на «Сегодня»: съедено против нормы.
 *
 * Виджет читает данные СВОЕГО модуля обычными хуками — «Сегодня» отдаёт ему
 * пространство ленда kcal так же, как маршрут модуля.
 *
 * Он же уводит в раздел по команде палитры, поднятой прямо с «Сегодня»: заявки
 * забираются только пока карточка на экране (без `takeOnMount`) — иначе возврат
 * на главную выбрасывал бы человека в дневник по давно забытой просьбе.
 */
useSectionRequests();

const entries = useEntries();
const profile = useProfile().data;

/**
 * Дата — реактивная, а не `todayISO()` внутри `computed`. Разница видна ровно
 * в полночь: вычисляемое значение пересчитывается по своим зависимостям, и
 * пока список записей не менялся, карточка так и показывала бы вчерашний день —
 * стартовую страницу держат открытой именно столько.
 */
const today = useToday();

const eaten = computed(() => entries.value.filter(entry => entry.date === today.value));
const totals = computed(() => sumNutrients(eaten.value));
const target = computed(() => profile.value?.targetKcal ?? 2000);
</script>

<template>
  <RouterLink to="/kcal" class="block">
    <div class="mb-2 flex items-baseline justify-between gap-2">
      <span class="text-display text-2xl leading-none text-text">{{ fmtKcal(totals.kcal) }}</span>
      <span class="tnum text-xs text-text-faint">{{ `из ${fmtKcal(target)} ккал` }}</span>
    </div>
    <Meter :value="totals.kcal" :max="target" />
    <p v-if="eaten.length === 0" class="mt-2 text-xs text-text-faint">
      Сегодня записей ещё нет — откройте дневник, чтобы записать первый приём.
    </p>
  </RouterLink>
</template>
