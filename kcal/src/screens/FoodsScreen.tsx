import { computed, shallowRef } from 'vue';
import { useQuery } from 'vue-sync-engine';
import { groupBy } from '@robonen/stdlib';
import { FoodEntity, foodsQuery } from '../data/defs';
import { useEntities } from '../data/composables';
import { fmtG, fmtKcal } from '../domain/format';
import { foodForm } from '../ui/state';
import { IconPlus, IconSearch } from '../ui/icons';

export default function FoodsScreen() {
  const foodsQ = useQuery(foodsQuery, () => undefined);
  const foods = useEntities(FoodEntity, () => foodsQ.data.value?.ids);
  const query = shallowRef('');

  const filtered = computed(() => {
    const needle = query.value.trim().toLowerCase();
    return needle === '' ? foods.value : foods.value.filter(food => food.name.toLowerCase().includes(needle));
  });

  const groups = computed(() => {
    const grouped = groupBy(filtered.value, food => food.category);
    return Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  });

  return (
    <div class="flex flex-col gap-4 pb-6">
      <div class="animate-rise flex items-center justify-between">
        <h1 class="text-display text-xl font-medium">Продукты</h1>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-full border border-ember/40 px-3.5 py-1.5 text-[13px] text-ember-bright transition hover:bg-ember/12"
          onClick={() => {
            foodForm.foodId = null;
            foodForm.open = true;
          }}
        >
          <IconPlus class="size-4" />
          Новый
        </button>
      </div>

      <div class="animate-rise relative" style={{ animationDelay: '40ms' }}>
        <IconSearch class="absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-ink-faint" />
        <input
          type="search"
          placeholder="Поиск по каталогу…"
          value={query.value}
          onInput={event => (query.value = event.currentTarget.value)}
          class="w-full rounded-xl border hairline bg-raised/70 py-2.5 pr-3.5 pl-10 text-[15px] text-ink outline-none transition focus:border-ember/50 placeholder:text-ink-faint"
        />
      </div>

      {groups.value.map(([category, list], index) => (
        <section class="animate-rise" style={{ animationDelay: `${80 + index * 30}ms` }}>
          <h2 class="mb-1.5 px-1 text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">{category}</h2>
          <div class="overflow-hidden rounded-2xl border hairline bg-surface/60">
            {list.map(food => (
              <button
                type="button"
                class="flex w-full items-center gap-3 border-b hairline px-4 py-3 text-left transition last:border-b-0 hover:bg-white/4"
                onClick={() => {
                  foodForm.foodId = food.id;
                  foodForm.open = true;
                }}
              >
                <div class="min-w-0 flex-1">
                  <div class="truncate text-[14px]">{food.name}</div>
                  <div class="mt-0.5 text-[11px] text-ink-faint tnum">
                    Б
                    {' '}
                    {fmtG(food.protein)}
                    {' '}
                    · Ж
                    {' '}
                    {fmtG(food.fat)}
                    {' '}
                    · У
                    {' '}
                    {fmtG(food.carbs)}
                    {food.pieceGrams ? ` · 1 шт = ${fmtG(food.pieceGrams)} г` : ''}
                  </div>
                </div>
                <div class="shrink-0 text-[13px] text-ink-soft tnum">
                  {fmtKcal(food.kcal)}
                  {' '}
                  <span class="text-[11px] text-ink-faint">/100 г</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}

      {filtered.value.length === 0 && (
        <p class="py-8 text-center text-[13px] text-ink-faint">Ничего не нашлось.</p>
      )}
    </div>
  );
}
