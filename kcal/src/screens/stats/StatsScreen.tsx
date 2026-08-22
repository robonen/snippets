import { computed, shallowRef } from 'vue';
import { useActions, useEntries, useProfile, useWeights } from '@/db/composables';
import type { DaySummary } from '@/db/composables';
import { dayShort, dayTitle, lastDays, todayISO } from '@/shared/lib/dates';
import { fmtG, fmtKcal } from '@/shared/lib/format';
import type { WeightLog } from '@/entities/profile';
import { IconScale, IconTrash } from '@/shared/ui/icons';

const PERIODS = [7, 14, 30] as const;

export default function StatsScreen(props: {
  /** Открыть день в дневнике (переключает вкладку). */
  onShowDay: (date: string) => void;
}) {
  const profile = useProfile().data;
  const entries = useEntries();
  const summaries = computed<DaySummary[]>(() => {
    const byDate = new Map<string, DaySummary>();
    for (const entry of entries.value) {
      let day = byDate.get(entry.date);
      if (!day) {
        day = { date: entry.date, kcal: 0, protein: 0, fat: 0, carbs: 0, entries: 0 };
        byDate.set(entry.date, day);
      }
      day.kcal += entry.kcal;
      day.protein += entry.protein;
      day.fat += entry.fat;
      day.carbs += entry.carbs;
      day.entries += 1;
    }
    return [...byDate.values()];
  });
  const weights = useWeights();
  const actions = useActions();

  const period = shallowRef<7 | 14 | 30>(14);
  const selectedBar = shallowRef(todayISO());

  const target = computed(() => profile.value?.targetKcal ?? 2000);

  const days = computed(() => {
    const byDate = new Map(summaries.value.map(day => [day.date, day]));
    return lastDays(period.value).map(date =>
      byDate.get(date) ?? { date, kcal: 0, protein: 0, fat: 0, carbs: 0, entries: 0 },
    );
  });

  const chartMax = computed(() => {
    const peak = Math.max(target.value, ...days.value.map(day => day.kcal));
    return peak * 1.08;
  });

  const selectedDay = computed(() =>
    days.value.find(day => day.date === selectedBar.value) ?? null,
  );

  const tracked = computed(() => days.value.filter(day => day.entries > 0));
  const averages = computed(() => {
    const list = tracked.value;
    if (list.length === 0) return null;
    const total = list.reduce(
      (acc, day) => ({ kcal: acc.kcal + day.kcal, protein: acc.protein + day.protein }),
      { kcal: 0, protein: 0 },
    );
    const onTarget = list.filter(day => day.kcal <= target.value).length;
    return {
      kcal: total.kcal / list.length,
      protein: total.protein / list.length,
      onTargetShare: Math.round((onTarget / list.length) * 100),
    };
  });

  // ── вес ───────────────────────────────────────────────────────────────────
  const weightInput = shallowRef(0);
  const latestWeight = computed(() => weights.value.at(-1) ?? null);
  const weightDelta = computed(() => {
    const list = weights.value;
    const latest = list.at(-1);
    if (!latest || list.length < 2) return null;
    const weekAgoDate = lastDays(8)[0] ?? latest.date;
    const reference = [...list].reverse().find(item => item.date <= weekAgoDate) ?? list[0];
    if (!reference || reference.id === latest.id) return null;
    return latest.kg - reference.kg;
  });

  const sparkPoints = computed(() => {
    const list = weights.value.slice(-30);
    if (list.length < 2) return '';
    const min = Math.min(...list.map(item => item.kg));
    const max = Math.max(...list.map(item => item.kg));
    const span = Math.max(max - min, 0.5);
    return list
      .map((item, index) => {
        const x = (index / (list.length - 1)) * 100;
        const y = 26 - ((item.kg - min) / span) * 22 + 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });

  const submitWeight = () => {
    if (weightInput.value <= 0) return;
    const date = todayISO();
    const weight: WeightLog = { id: date, date, kg: weightInput.value, createdAt: Date.now() };
    actions.logWeight(weight);
    weightInput.value = 0;
  };

  const numeric = (raw: string): number => {
    const value = Number(raw.replace(',', '.'));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };

  return (
    <div class="flex flex-col gap-5 pb-6">
      <div class="animate-rise flex items-center justify-between">
        <h1 class="text-display text-xl font-medium">Статистика</h1>
        <div class="flex gap-1 rounded-full border hairline bg-surface/60 p-1">
          {PERIODS.map(value => (
            <button
              type="button"
              class={`rounded-full px-3 py-1 text-[12px] transition ${period.value === value ? 'bg-ember/20 text-ember-bright' : 'text-ink-faint hover:text-ink'}`}
              onClick={() => (period.value = value)}
            >
              {value}
              {' '}
              дн
            </button>
          ))}
        </div>
      </div>

      {/* График калорий по дням */}
      <section class="animate-rise rounded-3xl border hairline bg-surface/80 p-5" style={{ animationDelay: '40ms' }}>
        <div class="mb-3 flex items-baseline justify-between">
          <h2 class="text-[13px] text-ink-soft">Калории по дням</h2>
          <span class="text-[12px] text-ink-faint tnum">
            {`цель ${fmtKcal(target.value)}`}
          </span>
        </div>

        {selectedDay.value && (
          <button
            type="button"
            class="mb-3 flex w-full items-baseline justify-between rounded-xl bg-raised/50 px-3.5 py-2 text-left transition hover:bg-raised"
            onClick={() => selectedDay.value && props.onShowDay(selectedDay.value.date)}
          >
            <span class="text-[13px] text-ink-soft">{dayTitle(selectedDay.value.date)}</span>
            <span class="text-[13px] tnum">
              {selectedDay.value.entries > 0
                ? (
                    <span>
                      {fmtKcal(selectedDay.value.kcal)}
                      {' '}
                      ккал · Б
                      {' '}
                      {fmtG(selectedDay.value.protein)}
                    </span>
                  )
                : <span class="text-ink-faint">нет записей</span>}
            </span>
          </button>
        )}

        <div class="relative h-36">
          {/* Линия цели */}
          <div
            class="absolute right-0 left-0 z-10 border-t border-dashed border-ink-soft/40"
            style={{ bottom: `${(target.value / chartMax.value) * 100}%` }}
          />
          <div class="flex h-full items-end gap-0.75">
            {days.value.map(day => (
              <button
                type="button"
                aria-label={`${day.date}: ${Math.round(day.kcal)} ккал`}
                class="group flex h-full flex-1 flex-col items-center justify-end"
                onClick={() => (selectedBar.value = day.date)}
              >
                <div
                  class={`w-full rounded-t-sm transition-colors ${day.kcal > 0 ? '' : 'min-h-0.5'} ${selectedBar.value === day.date
                    ? 'bg-ember-bright'
                    : day.kcal > target.value ? 'bg-over/80 group-hover:bg-over' : 'bg-ember/65 group-hover:bg-ember'}`}
                  style={{ height: `${Math.max((day.kcal / chartMax.value) * 100, day.kcal > 0 ? 2 : 1)}%` }}
                />
              </button>
            ))}
          </div>
        </div>
        <div class="mt-1.5 flex justify-between text-[10px] text-ink-faint tnum">
          <span>{dayShort(days.value[0]?.date ?? todayISO())}</span>
          <span>{dayShort(days.value.at(-1)?.date ?? todayISO())}</span>
        </div>
      </section>

      {/* Средние за период */}
      {averages.value && (
        <section class="animate-rise grid grid-cols-3 gap-2" style={{ animationDelay: '80ms' }}>
          <div class="rounded-2xl border hairline bg-surface/60 px-3 py-3 text-center">
            <div class="text-display text-[22px] font-light tnum">{fmtKcal(averages.value.kcal)}</div>
            <div class="mt-0.5 text-[11px] text-ink-faint">ккал в среднем</div>
          </div>
          <div class="rounded-2xl border hairline bg-surface/60 px-3 py-3 text-center">
            <div class="text-display text-[22px] font-light tnum">{fmtG(averages.value.protein)}</div>
            <div class="mt-0.5 text-[11px] text-ink-faint">белка в день, г</div>
          </div>
          <div class="rounded-2xl border hairline bg-surface/60 px-3 py-3 text-center">
            <div class="text-display text-[22px] font-light tnum">
              {averages.value.onTargetShare}
              %
            </div>
            <div class="mt-0.5 text-[11px] text-ink-faint">дней в цели</div>
          </div>
        </section>
      )}

      {/* Вес */}
      <section class="animate-rise rounded-3xl border hairline bg-surface/80 p-5" style={{ animationDelay: '120ms' }}>
        <div class="mb-3 flex items-center gap-2">
          <IconScale class="size-4.5 text-ink-soft" />
          <h2 class="flex-1 text-[13px] text-ink-soft">Вес</h2>
          {weightDelta.value !== null && (
            <span class={`text-[12px] tnum ${weightDelta.value <= 0 ? 'text-protein' : 'text-ink-faint'}`}>
              {weightDelta.value > 0 ? '+' : ''}
              {fmtG(weightDelta.value)}
              {' '}
              кг за неделю
            </span>
          )}
        </div>

        {latestWeight.value && (
          <div class="mb-3 flex items-end justify-between">
            <div>
              <span class="text-display text-[36px] leading-none font-light tnum">{fmtG(latestWeight.value.kg)}</span>
              <span class="ml-1 text-[13px] text-ink-faint">кг</span>
            </div>
            {sparkPoints.value && (
              <svg class="h-8 w-36" viewBox="0 0 100 30" preserveAspectRatio="none">
                <polyline
                  points={sparkPoints.value}
                  fill="none"
                  stroke="var(--color-ember-bright)"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            )}
          </div>
        )}

        <div class="flex gap-2">
          <input
            type="number"
            inputmode="decimal"
            min="1"
            step="0.1"
            placeholder="Вес сегодня, кг"
            value={weightInput.value || ''}
            onInput={event => (weightInput.value = numeric(event.currentTarget.value))}
            class="w-full flex-1 rounded-xl border hairline bg-raised/70 px-3.5 py-2.5 text-[16px] text-ink outline-none transition focus:border-ember/50 placeholder:text-ink-faint tnum"
          />
          <button
            type="button"
            class="rounded-xl bg-ember px-4 text-[14px] font-medium text-[#1a1006] transition hover:bg-ember-bright disabled:opacity-40"
            disabled={weightInput.value <= 0}
            onClick={submitWeight}
          >
            Записать
          </button>
        </div>

        {weights.value.length > 0 && (
          <div class="mt-3 flex flex-col">
            {[...weights.value].reverse().slice(0, 5).map(item => (
              <div class="flex items-center gap-2 border-t hairline py-2 text-[13px]">
                <span class="flex-1 text-ink-faint">{dayTitle(item.date)}</span>
                <span class="tnum">
                  {fmtG(item.kg)}
                  {' '}
                  кг
                </span>
                <button
                  type="button"
                  aria-label="Удалить замер"
                  class="grid size-7 place-items-center rounded-full text-ink-faint transition hover:bg-over/15 hover:text-over-bright"
                  onClick={() => actions.removeWeight(item.id)}
                >
                  <IconTrash class="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <p class="mt-3 text-[12px] leading-relaxed text-ink-faint">
          Взвешивайтесь утром натощак. Смотрите на тренд за неделю, а не на
          ежедневные колебания — вода и еда в желудке шумят на ±1 кг.
        </p>
      </section>
    </div>
  );
}
