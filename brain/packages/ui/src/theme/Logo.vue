<script setup lang="ts">
import { useId } from 'vue';

/**
 * Знак brain: три текучих слоя-строты из металла.
 *
 * Слои памяти, складки коры — смысл держится формой, а не рисунком мозга.
 * Контейнера нет намеренно: круг с резами читался бы как чужой знак (так
 * устроен Linear), плашка — как безликая иконка приложения.
 *
 * ── Откуда объём ───────────────────────────────────────────────────────────
 *
 * Лента становится телом, а не полоской, из трёх слагаемых:
 *
 * 1. Цилиндрическая растяжка ПОПЕРЁК ленты — светлый гребень над тёмным
 *    подбрюшьем. Растяжка вдоль давала бы перелив на плоскости; поперёк —
 *    освещённый сверху валик. Координаты в `userSpaceOnUse`, потому что
 *    градиент обязан лечь по высоте конкретной ленты, а не по всему знаку.
 * 2. Тень под каждой лентой: верхняя ложится на нижнюю, и стопка получает
 *    глубину. Тень короткая и плотная — длинная размытая читалась бы как
 *    неоморфизм, а не как металл.
 * 3. Блик по верхней кромке: белый штрих, гаснущий к середине, — полированное
 *    ребро, ловящее свет.
 *
 * Соседние ленты освещены чуть по-разному (чётные горячее): грани одного
 * предмета не блестят одинаково.
 *
 * ── Плоский вариант ────────────────────────────────────────────────────────
 *
 * На 16–20 px градиенты и тени мельче пикселя и шумят. `flat` — те же три
 * слоя одной краской (`currentColor`): фавикон, любое место меньше ногтя.
 */
const { size = 28, flat = false } = defineProps<{
  size?: number | string;
  /** Одной краской вместо металла — для мелких размеров. */
  flat?: boolean;
}>();

/*
 * Идентификаторы уникальны на экземпляр: два знака на странице с общими id
 * заставили бы второй рисоваться градиентами первого — включая случай, когда
 * первый уже размонтирован и его defs исчезли из документа.
 */
const uid = useId();
const bodyId = (band: number): string => `brain-body-${uid}-${band}`;
const glintId = (band: number): string => `brain-glint-${uid}-${band}`;
const shadowId = `brain-shadow-${uid}`;

/**
 * Три ленты со скруглёнными торцами. Средняя длиннее крайних: одинаковые
 * превращали бы знак в кнопку «меню», разнобой длин задаёт ритм.
 */
const RIBBONS = [
  `M7 8.6 C13 11.2, 20 5.4, 26.5 7.4 A2.6 2.6 0 0 1 26.5 12.4
   C20 10.6, 13 16.2, 7 13.6 A2.7 2.7 0 0 1 7 8.6Z`,
  `M5 15.6 C12 18.4, 21 12.4, 27 14.6 A2.7 2.7 0 0 1 27 19.8
   C21 17.6, 12 23.4, 5 20.8 A2.8 2.8 0 0 1 5 15.6Z`,
  `M8 22.8 C14 25.2, 20 20.2, 25 21.8 A2.5 2.5 0 0 1 25 26.6
   C20 25.2, 14 30, 8 27.6 A2.6 2.6 0 0 1 8 22.8Z`,
];

/** Вертикальный размах каждой ленты — оси её цилиндрической растяжки. */
const SPANS: ReadonlyArray<readonly [number, number]> = [
  [6.2, 14.4],
  [13.2, 21.6],
  [20.6, 28.8],
];

const HOT_STOPS = [
  ['0', '#f4f6f9'], ['.28', '#cdd3db'], ['.62', '#8f96a0'], ['1', '#666c75'],
] as const;
const COLD_STOPS = [
  ['0', '#e2e6ec'], ['.28', '#b7bec7'], ['.62', '#7a8089'], ['1', '#53585f'],
] as const;

const stopsFor = (band: number): typeof HOT_STOPS | typeof COLD_STOPS =>
  band % 2 === 0 ? HOT_STOPS : COLD_STOPS;
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 32 32"
    fill="none"
    role="img"
    aria-label="brain"
  >
    <g v-if="flat" transform="rotate(-12 16 16)" fill="currentColor">
      <path v-for="(ribbon, index) in RIBBONS" :key="index" :d="ribbon" />
    </g>

    <template v-else>
      <defs>
        <linearGradient
          v-for="([top, bottom], band) in SPANS"
          :id="bodyId(band)"
          :key="`body-${band}`"
          x1="0"
          :y1="top"
          x2="0"
          :y2="bottom"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            v-for="[offset, color] in stopsFor(band)"
            :key="offset"
            :offset="offset"
            :stop-color="color"
          />
        </linearGradient>

        <linearGradient
          v-for="([top], band) in SPANS"
          :id="glintId(band)"
          :key="`glint-${band}`"
          x1="0"
          :y1="top"
          x2="0"
          :y2="top + 3.4"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stop-color="#ffffff" stop-opacity=".85" />
          <stop offset=".45" stop-color="#ffffff" stop-opacity=".12" />
          <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
        </linearGradient>

        <filter :id="shadowId" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1" stdDeviation=".8" flood-color="#000" flood-opacity=".32" />
        </filter>
      </defs>

      <g transform="rotate(-12 16 16)">
        <g v-for="(ribbon, index) in RIBBONS" :key="index" :filter="`url(#${shadowId})`">
          <path :d="ribbon" :fill="`url(#${bodyId(index)})`" />
          <path :d="ribbon" fill="none" :stroke="`url(#${glintId(index)})`" stroke-width=".9" />
        </g>
      </g>
    </template>
  </svg>
</template>
