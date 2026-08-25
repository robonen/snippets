<script setup lang="ts">
import { computed } from 'vue';
import { Monitor, Moon, Sun } from 'lucide-vue-next';
import SegmentedControl from '../layout/SegmentedControl.vue';
import type { Segment } from '../layout/SegmentedControl.vue';
import { useTheme } from './theme';
import type { ThemeChoice } from './theme';

const { choice, set } = useTheme();

const SEGMENTS: ReadonlyArray<Segment<ThemeChoice>> = [
  { value: 'system', label: 'Как в системе', icon: Monitor },
  { value: 'light', label: 'Светлая', icon: Sun },
  { value: 'dark', label: 'Тёмная', icon: Moon },
];

// `choice` — readonly-ref из общего состояния темы, писать в него напрямую
// нельзя: смена темы обязана пройти через `set`, который ещё и сохраняет выбор.
const value = computed<ThemeChoice>({
  get: () => choice.value,
  set: choiceValue => set(choiceValue),
});
</script>

<template>
  <SegmentedControl v-model="value" label="Тема оформления" :segments="SEGMENTS" icon-only />
</template>
