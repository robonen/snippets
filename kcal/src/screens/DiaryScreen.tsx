import { computed } from 'vue';
import { useEntity, useQuery } from 'vue-sync-engine';
import { EntryEntity, FoodEntity, ProfileEntity, entriesByDayQuery, foodsQuery } from '../data/defs';
import { useEntities } from '../data/composables';
import { sumNutrients } from '../domain/calc';
import { dayTitle, shiftISODate, todayISO } from '../domain/dates';
import { fmtAmount, fmtKcal } from '../domain/format';
import { MEALS, MEAL_LABELS, PROFILE_ID } from '../domain/types';
import type { Entry, Meal } from '../domain/types';
import { editEntryId, goToday, openAddSheet, selectedDate } from '../ui/state';
import { IconChevronLeft, IconChevronRight, IconPlus } from '../ui/icons';
import ProgressRing from '../components/ProgressRing';
import MacroBar from '../components/MacroBar';

export default function DiaryScreen() {
  const profile = useEntity(ProfileEntity, () => PROFILE_ID);
  const day = useQuery(entriesByDayQuery, () => ({ date: selectedDate.value }));
  const entries = useEntities(EntryEntity, () => day.data.value?.ids);
  // Каталог нужен только ради pieceGrams — чтобы подписывать порции «2 шт · 110 г».
  const foodsQ = useQuery(foodsQuery, () => undefined);
  const foods = useEntities(FoodEntity, () => foodsQ.data.value?.ids);
  const pieceByFoodId = computed(() => {
    const map = new Map<string, number | undefined>();
    for (const food of foods.value) map.set(food.id, food.pieceGrams);
    return map;
  });
  const totals = computed(() => sumNutrients(entries.value));
  const isToday = computed(() => selectedDate.value === todayISO());

  const byMeal = computed(() => {
    const map = new Map<Meal, Entry[]>();
    for (const meal of MEALS) map.set(meal, []);
    for (const entry of entries.value) map.get(entry.meal)?.push(entry);
    return map;
  });

  return (
    <div class="flex flex-col gap-5 pb-6">
      {/* Навигация по дням */}
      <div class="animate-rise flex items-center justify-between">
        <button
          type="button"
          aria-label="Предыдущий день"
          class="grid size-10 place-items-center rounded-full text-ink-soft transition hover:bg-white/5 hover:text-ink"
          onClick={() => (selectedDate.value = shiftISODate(selectedDate.value, -1))}
        >
          <IconChevronLeft />
        </button>
        <div class="text-center">
          <div class="text-display text-xl font-medium">{dayTitle(selectedDate.value)}</div>
          {!isToday.value && (
            <button type="button" class="mt-0.5 text-xs text-ember-bright/90 hover:text-ember-bright" onClick={goToday}>
              вернуться к сегодня
            </button>
          )}
        </div>
        <button
          type="button"
          aria-label="Следующий день"
          class="grid size-10 place-items-center rounded-full text-ink-soft transition hover:bg-white/5 hover:text-ink"
          onClick={() => (selectedDate.value = shiftISODate(selectedDate.value, 1))}
        >
          <IconChevronRight />
        </button>
      </div>

      {/* Итог дня: кольцо + макросы */}
      <section
        class="animate-rise rounded-3xl border hairline bg-surface/80 px-5 pt-6 pb-5"
        style={{ animationDelay: '40ms' }}
      >
        <ProgressRing eaten={totals.value.kcal} target={profile.value?.targetKcal ?? 2000} />
        <div class="mt-6 flex gap-4">
          <MacroBar label="Белки" color="protein" value={totals.value.protein} target={profile.value?.targetProtein ?? 120} />
          <MacroBar label="Жиры" color="fat" value={totals.value.fat} target={profile.value?.targetFat ?? 70} />
          <MacroBar label="Углеводы" color="carbs" value={totals.value.carbs} target={profile.value?.targetCarbs ?? 250} />
        </div>
      </section>

      {/* Приёмы пищи */}
      {MEALS.map((meal, index) => {
        const list = byMeal.value.get(meal) ?? [];
        const mealKcal = list.reduce((acc, entry) => acc + entry.kcal, 0);
        return (
          <section class="animate-rise" style={{ animationDelay: `${80 + index * 40}ms` }}>
            <div class="mb-2 flex items-baseline justify-between px-1">
              <h2 class="text-display text-[17px] font-medium">{MEAL_LABELS[meal]}</h2>
              {list.length > 0 && (
                <span class="text-[13px] text-ink-faint tnum">
                  {fmtKcal(mealKcal)}
                  {' '}
                  ккал
                </span>
              )}
            </div>
            <div class="overflow-hidden rounded-2xl border hairline bg-surface/60">
              {list.map(entry => (
                <button
                  type="button"
                  class="flex w-full items-center gap-3 border-b hairline px-4 py-3 text-left transition last:border-b-0 hover:bg-white/4"
                  onClick={() => (editEntryId.value = entry.id)}
                >
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-[15px]">{entry.name}</div>
                    <div class="mt-0.5 text-xs text-ink-faint">
                      {fmtAmount(entry.amountG, entry.foodId ? pieceByFoodId.value.get(entry.foodId) : undefined)}
                    </div>
                  </div>
                  <div class="text-[15px] text-ink-soft tnum">{fmtKcal(entry.kcal)}</div>
                </button>
              ))}
              <button
                type="button"
                class="flex w-full items-center gap-2 px-4 py-3 text-[14px] text-ember-bright/90 transition hover:bg-ember/8 hover:text-ember-bright"
                onClick={() => openAddSheet(meal)}
              >
                <IconPlus class="size-4" />
                Добавить
              </button>
            </div>
          </section>
        );
      })}

      {entries.value.length === 0 && (
        <p class="animate-rise px-6 text-center text-[13px] leading-relaxed text-ink-faint" style={{ animationDelay: '240ms' }}>
          Пока пусто. Нажмите «Добавить» в любом приёме пищи —
          недавние продукты будут под рукой, запись занимает пару касаний.
        </p>
      )}
    </div>
  );
}
