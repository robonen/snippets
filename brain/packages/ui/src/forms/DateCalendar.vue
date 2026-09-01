<script setup lang="ts">
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';
import {
  DatePickerCalendar,
  DatePickerCell,
  DatePickerCellTrigger,
  DatePickerGrid,
  DatePickerGridBody,
  DatePickerGridHead,
  DatePickerGridRow,
  DatePickerHeadCell,
  DatePickerHeader,
  DatePickerHeading,
  DatePickerNext,
  DatePickerPrev,
  useCalendarRootContext,
} from '@robonen/primitives';

/**
 * Месяц календаря внутри {@link DateField}: шапка с листанием и сетка дней.
 *
 * Отдельный компонент, потому что сетку строит контекст календаря, а он
 * доступен только ПОД корнем: `DatePickerRoot` заводит его в `setup`, и
 * читать его в том же компоненте нельзя.
 *
 * Сетка — CSS grid на семь колонок, а не таблица: роли (`grid`, `gridcell`)
 * примитивы ставят сами, а таблица тянула бы за собой раскладку по
 * содержимому, из-за которой клетки неделями разной ширины пляшут.
 */
const NAV = 'pressable grid size-8 shrink-0 place-items-center rounded-control text-text-soft '
  + 'hover:bg-sunken hover:text-text disabled:pointer-events-none disabled:opacity-40';

const calendar = useCalendarRootContext();
</script>

<template>
  <DatePickerCalendar class="flex flex-col gap-2">
    <DatePickerHeader class="flex items-center justify-between gap-2">
      <DatePickerPrev aria-label="Предыдущий месяц" :class="NAV">
        <ChevronLeft class="size-4" />
      </DatePickerPrev>
      <!-- Только первая буква: `capitalize` поднял бы и «г.» в «Сентябрь 2026 Г.». -->
      <DatePickerHeading class="text-sm font-medium text-text first-letter:uppercase" />
      <DatePickerNext aria-label="Следующий месяц" :class="NAV">
        <ChevronRight class="size-4" />
      </DatePickerNext>
    </DatePickerHeader>

    <DatePickerGrid
      v-for="month in calendar.grid.value"
      :key="month.value.getTime()"
      :month="month.value"
      as="div"
      class="flex flex-col gap-1 select-none"
    >
      <DatePickerGridHead as="div">
        <DatePickerGridRow as="div" class="grid grid-cols-7">
          <DatePickerHeadCell
            v-for="(day, at) in calendar.weekDays.value"
            :key="at"
            as="div"
            class="py-1 text-center text-[0.6875rem] font-medium text-text-faint"
          >
            {{ day }}
          </DatePickerHeadCell>
        </DatePickerGridRow>
      </DatePickerGridHead>

      <DatePickerGridBody as="div" class="flex flex-col gap-0.5">
        <DatePickerGridRow v-for="(week, row) in month.weeks" :key="row" as="div" class="grid grid-cols-7 gap-0.5">
          <DatePickerCell v-for="day in week" :key="day.getTime()" :date="day" as="div" class="flex justify-center">
            <!-- Состояния дня — data-атрибуты примитива. Выбранный — заливкой,
                 сегодняшний — цветом цифры, и второе уступает первому, чтобы в
                 одной клетке они не спорили. -->
            <DatePickerCellTrigger
              :day="day"
              :month="month.value"
              class="tnum grid aspect-square w-full cursor-pointer place-items-center rounded-control
                     text-sm text-text transition-colors hover:bg-sunken
                     focus-visible:outline-2 focus-visible:outline-accent
                     data-[outside-view]:text-text-faint data-[today]:font-semibold
                     data-[today]:not-data-[selected]:text-accent
                     data-[selected]:bg-solid data-[selected]:text-on-solid data-[selected]:hover:bg-solid
                     data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[unavailable]:line-through"
            >
              {{ day.getDate() }}
            </DatePickerCellTrigger>
          </DatePickerCell>
        </DatePickerGridRow>
      </DatePickerGridBody>
    </DatePickerGrid>
  </DatePickerCalendar>
</template>
