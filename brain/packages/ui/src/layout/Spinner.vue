<script setup lang="ts">
/** Индикатор ожидания. Роль `status` — чтобы скринридер сообщил о загрузке. */
defineProps<{ label?: string }>();
</script>

<template>
  <!--
    700 мс на оборот вместо стандартной секунды. Скорость вращения не меняет
    время загрузки, но меняет то, каким оно КАЖЕТСЯ: быстрый оборот читается
    как «работает вовсю», медленный — как «подвисло».

    При `prefers-reduced-motion` вращение НЕ выключается, а замедляется.
    Остановленный спиннер — это не спокойная версия спиннера, это кольцо,
    которое больше ничего не сообщает; убирать надо избыточное движение, а не
    единственное осмысленное.
  -->
  <span
    role="status"
    :aria-label="label ?? 'Загрузка'"
    class="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent
           [animation-duration:700ms] motion-reduce:[animation-duration:1.6s]"
  />
</template>
