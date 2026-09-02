<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { TriangleAlert } from 'lucide-vue-next';
import { Button, NumberField, Page, PageHeader, RadioCards, SegmentedControl } from '@brain/ui';
import type { RadioCard, Segment } from '@brain/ui';
import { todayISO } from '@brain/std';
import { useActions, useProfile, useWeights } from '../../db/composables';
import { ACTIVITY_LEVELS, GOAL_LABELS, computeTargets, safeKcalFloor } from '../../entities/profile';
import { fmtG, fmtKcal } from '../../lib/format';
import type { Goal, Sex } from '../../entities/profile';
import SectionTabs from '../SectionTabs.vue';
import BackupCard from './BackupCard.vue';

/**
 * Профиль: параметры тела, цель и дневные нормы.
 *
 * Нормы СЧИТАЮТСЯ из параметров, но остаются правимыми вручную: формула
 * Миффлина—Сан Жеора — оценка, а не измерение, и человек, знающий свой расход
 * по опыту, не должен спорить с калькулятором.
 *
 * Нормы стоят ПЕРВЫМИ и крупно, хотя считаются из полей ниже: это ответ, ради
 * которого экран открывают, а поля — способ его уточнить. Экран, начинающийся с
 * ряда одинаковых полей, читается как форма регистрации.
 *
 * Вес и бэкап уезжают в правый рельс, а не растягивают форму: они к расчёту
 * норм отношения не имеют. Порядок при этом не ломается — ниже `xl` рельс
 * встаёт под форму ровно туда, где эти карточки и были.
 */
const profile = useProfile();
const weights = useWeights();
const actions = useActions();

const sex = ref<Sex>('male');
// Числовые поля — `null`, пока стёрты; в расчёт и в запись идёт последнее
// осмысленное значение, а не NaN.
const age = ref<number | null>(30);
const heightCm = ref<number | null>(175);
const weightKg = ref<number | null>(70);
const activity = ref(1.375);
const goal = ref<Goal>('maintain');

const manual = ref<{ kcal: number; protein: number; fat: number; carbs: number } | null>(null);
const weightInput = ref<number | null>(null);

/** Параметры тела для формулы: стёртое поле считается как прежнее сохранённое. */
const body = computed(() => ({
  age: age.value ?? profile.data.value?.age ?? 30,
  heightCm: heightCm.value ?? profile.data.value?.heightCm ?? 175,
  weightKg: weightKg.value ?? profile.data.value?.weightKg ?? 70,
}));

const SEX_SEGMENTS: ReadonlyArray<Segment<Sex>> = [
  { value: 'male', label: 'Мужской' },
  { value: 'female', label: 'Женский' },
];

const GOAL_SEGMENTS: ReadonlyArray<Segment<Goal>> = [
  { value: 'lose', label: GOAL_LABELS.lose },
  { value: 'maintain', label: GOAL_LABELS.maintain },
  { value: 'gain', label: GOAL_LABELS.gain },
];

const ACTIVITY_CARDS: readonly RadioCard[] = ACTIVITY_LEVELS.map(level => ({
  value: String(level.value),
  title: level.label,
  description: level.hint,
}));

// Форма заполняется из ленда один раз — дальше правки человека главнее.
watch(profile.data, (value) => {
  if (value === undefined || manual.value !== null) return;
  sex.value = value.sex;
  age.value = value.age;
  heightCm.value = value.heightCm;
  weightKg.value = value.weightKg;
  activity.value = value.activity;
  goal.value = value.goal;
}, { immediate: true });

// Радиогруппа кита работает со строками, коэффициент активности — число. Мост
// здесь, а не в хранилище: строка нужна ровно одному контролу.
const activityKey = computed({
  get: () => String(activity.value),
  set: (next: string | undefined) => {
    if (next !== undefined) activity.value = Number(next);
  },
});

const computed_ = computed(() => computeTargets({
  sex: sex.value,
  ...body.value,
  activity: activity.value,
  goal: goal.value,
}));

const targets = computed(() => manual.value ?? computed_.value);

const tooLow = computed(() => targets.value.kcal < safeKcalFloor(sex.value));

const macros = computed(() => [
  { key: 'protein', label: 'Белки', grams: targets.value.protein, color: 'var(--macro-protein)' },
  { key: 'fat', label: 'Жиры', grams: targets.value.fat, color: 'var(--macro-fat)' },
  { key: 'carbs', label: 'Углеводы', grams: targets.value.carbs, color: 'var(--macro-carbs)' },
]);

function save(): void {
  const now = Date.now();
  actions.saveProfile({
    sex: sex.value,
    ...body.value,
    activity: activity.value,
    goal: goal.value,
    targetKcal: targets.value.kcal,
    targetProtein: targets.value.protein,
    targetFat: targets.value.fat,
    targetCarbs: targets.value.carbs,
    createdAt: profile.data.value?.createdAt ?? now,
    updatedAt: now,
  });
  manual.value = null;
}

function logWeight(): void {
  const kg = weightInput.value;
  if (kg === null || !Number.isFinite(kg) || kg <= 0) return;
  const date = todayISO();
  // id совпадает с датой: замер один на день, повторный переписывает прежний.
  actions.logWeight({ id: date, date, kg, createdAt: Date.now() });
  weightKg.value = kg;
  weightInput.value = null;
}

const lastWeights = computed(() => weights.value.slice(-7).reverse());
</script>

<template>
  <Page width="list">
    <SectionTabs class="mb-4" />

    <PageHeader title="Профиль" subtitle="Параметры тела и дневные нормы" />

    <div class="flex flex-col gap-3">
      <!-- Опора экрана: рассчитанные нормы крупными числами. -->
      <section class="rounded-card border border-line bg-surface p-5">
        <h2 class="text-xs font-medium tracking-wide text-text-faint uppercase">Дневные нормы</h2>

        <!-- Единица возвращается к текстовой гарнитуре: `text-display` наследуется
             внутрь, и «ккал» широким гротеском читается как ошибка вёрстки. -->
        <p class="text-display mt-2 text-[clamp(2.5rem,12vw,3.5rem)] leading-none text-text">
          {{ fmtKcal(targets.kcal) }}
          <span class="font-text text-sm tracking-normal text-text-faint">ккал</span>
        </p>

        <dl class="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
          <div v-for="macro in macros" :key="macro.key">
            <dt class="flex items-center gap-1.5 text-[0.6875rem] tracking-wide text-text-faint uppercase">
              <span class="size-1.5 shrink-0 rounded-full" :style="{ background: macro.color }" />
              {{ macro.label }}
            </dt>
            <dd class="text-display mt-1 text-xl leading-none text-text">
              {{ macro.grams }}
              <span class="font-text text-[0.6875rem] tracking-normal text-text-faint">г</span>
            </dd>
          </div>
        </dl>

        <div v-if="tooLow" class="mt-4 flex gap-2 rounded-control bg-sunken p-3">
          <TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" />
          <p class="text-xs leading-relaxed text-text-soft">
            {{ `Норма ниже безопасного минимума (${fmtKcal(safeKcalFloor(sex))} ккал).` }}
            Так можно, но недолго и лучше не в одиночку.
          </p>
        </div>

        <Button tone="primary" block class="mt-4" @click="save">Сохранить</Button>
      </section>

      <section class="rounded-card border border-line bg-surface p-4">
        <h2 class="mb-3 text-xs font-medium tracking-wide text-text-faint uppercase">Тело</h2>

        <SegmentedControl v-model="sex" label="Пол" :segments="SEX_SEGMENTS" />

        <div class="mt-3 grid grid-cols-3 gap-2">
          <NumberField v-model="age" label="Возраст" unit="лет" :min="1" :max="120" :snap="false" />
          <NumberField v-model="heightCm" label="Рост" unit="см" :min="50" :max="250" :snap="false" />
          <NumberField v-model="weightKg" label="Вес" unit="кг" :min="20" :max="400" :step="0.1" :snap="false" />
        </div>
      </section>

      <section class="rounded-card border border-line bg-surface p-4">
        <h2 class="mb-3 text-xs font-medium tracking-wide text-text-faint uppercase">Активность и цель</h2>

        <RadioCards v-model="activityKey" label="Уровень активности" :cards="ACTIVITY_CARDS" />

        <div class="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <span class="text-[0.8125rem] text-text-soft">Цель</span>
          <SegmentedControl v-model="goal" label="Цель" :segments="GOAL_SEGMENTS" />
        </div>
      </section>
    </div>

    <template #aside>
      <div class="flex flex-col gap-3">
        <section class="overflow-hidden rounded-card border border-line bg-surface">
          <div class="p-4">
            <h2 class="mb-3 text-xs font-medium tracking-wide text-text-faint uppercase">Вес</h2>

            <form class="flex items-end gap-2" @submit.prevent="logWeight">
              <NumberField
                v-model="weightInput"
                label="Сегодня"
                unit="кг"
                :min="20"
                :max="400"
                :step="0.1"
                :snap="false"
                placeholder="кг"
                class="w-36 shrink-0"
              />
              <Button tone="primary" type="submit">Записать</Button>
            </form>

            <p v-if="lastWeights.length === 0" class="mt-3 text-xs leading-relaxed text-text-faint">
              Замеры складываются в линию на экране статистики. Один замер в день,
              повторный за тот же день переписывает прежний.
            </p>
          </div>

          <ul v-if="lastWeights.length > 0" class="divide-y divide-line border-t border-line">
            <li
              v-for="log in lastWeights"
              :key="log.id"
              class="flex items-center justify-between px-4 py-2 text-sm"
            >
              <span class="tnum text-text-faint">{{ log.date }}</span>
              <span class="tnum text-text">{{ `${fmtG(log.kg)} кг` }}</span>
            </li>
          </ul>
        </section>

        <BackupCard />
      </div>
    </template>
  </Page>
</template>
