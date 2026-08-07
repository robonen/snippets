import { computed, shallowRef } from 'vue';
import { useEntity, useMutation } from 'vue-sync-engine';
import { useCloseWatcher } from '@robonen/vue';
import { EntryEntity, removeEntryMutation, updateEntryMutation } from '../data/defs';
import { round1 } from '../domain/calc';
import { fmtG, fmtKcal } from '../domain/format';
import { MEALS, MEAL_LABELS } from '../domain/types';
import type { Entry, Meal } from '../domain/types';
import { editEntryId } from '../ui/state';
import { IconClose, IconTrash } from '../ui/icons';

/**
 * Правка записи: порция (пересчёт нутриентов пропорцией — работает и для
 * записей без продукта-источника), приём пищи, удаление.
 */
export default function EditEntrySheet() {
  const entry = useEntity(EntryEntity, () => editEntryId.value ?? undefined);

  const update = useMutation(updateEntryMutation);
  const remove = useMutation(removeEntryMutation);

  const close = () => (editEntryId.value = null);
  useCloseWatcher().onClose(close);

  // Локальные правки поверх записи; null — «не менялось».
  const draftAmount = shallowRef<number | null>(null);
  const draftKcal = shallowRef<number | null>(null);
  const draftMeal = shallowRef<Meal | null>(null);

  const amount = computed(() => draftAmount.value ?? entry.value?.amountG ?? 0);
  const meal = computed(() => draftMeal.value ?? entry.value?.meal ?? 'snack');

  /** Нутриенты после правки порции: масштабируем снапшот записи. */
  const scaled = computed(() => {
    const current = entry.value;
    if (!current) return null;
    if (current.amountG && draftAmount.value !== null && draftAmount.value > 0) {
      const factor = draftAmount.value / current.amountG;
      return {
        kcal: Math.round(current.kcal * factor),
        protein: round1(current.protein * factor),
        fat: round1(current.fat * factor),
        carbs: round1(current.carbs * factor),
      };
    }
    if (!current.amountG && draftKcal.value !== null) {
      return { kcal: Math.round(draftKcal.value), protein: current.protein, fat: current.fat, carbs: current.carbs };
    }
    return { kcal: current.kcal, protein: current.protein, fat: current.fat, carbs: current.carbs };
  });

  const save = () => {
    const current = entry.value;
    const nutrients = scaled.value;
    if (!current || !nutrients) return;
    const patch: Partial<Entry> = { ...nutrients, meal: meal.value };
    if (current.amountG && draftAmount.value !== null && draftAmount.value > 0) {
      patch.amountG = draftAmount.value;
    }
    update.mutate({ id: current.id, patch });
    close();
  };

  const removeEntry = () => {
    const current = entry.value;
    if (!current) return;
    remove.mutate({ id: current.id });
    close();
  };

  const numeric = (raw: string): number => {
    const value = Number(raw.replace(',', '.'));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };

  const fieldClass = 'w-full rounded-xl border hairline bg-raised/70 px-3.5 py-2.5 text-[15px] text-ink outline-none transition focus:border-ember/50';
  const chipClass = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-[13px] transition ${active
      ? 'border-ember/60 bg-ember/15 text-ember-bright'
      : 'border-white/10 text-ink-soft hover:border-white/20 hover:text-ink'}`;

  return (
    <div class="fixed inset-0 z-50 flex items-end justify-center">
      <div class="animate-fade-in absolute inset-0 bg-black/65 backdrop-blur-[2px]" onClick={close} />

      <div class="animate-sheet-up relative flex w-full max-w-105 flex-col rounded-t-3xl border border-b-0 hairline bg-[#191511] shadow-[0_-24px_80px_rgba(0,0,0,0.5)]">
        <div class="flex items-center gap-2 px-5 pt-4 pb-3">
          <h2 class="text-display min-w-0 flex-1 truncate text-lg font-medium">{entry.value?.name ?? ''}</h2>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-9 shrink-0 place-items-center rounded-full text-ink-soft transition hover:bg-white/6"
            onClick={close}
          >
            <IconClose class="size-5" />
          </button>
        </div>

        {entry.value && (
          <div class="flex flex-col gap-4 px-5 pb-8">
            <div class="rounded-2xl border hairline bg-surface/60 px-5 py-3.5 text-center">
              <span class="text-display text-[34px] leading-none font-light">{fmtKcal(scaled.value?.kcal ?? 0)}</span>
              <span class="ml-1.5 text-[12px] text-ink-faint">ккал</span>
              <div class="mt-2 flex justify-center gap-4 text-[12px] text-ink-soft tnum">
                <span>
                  <span class="text-protein">Б</span>
                  {' '}
                  {fmtG(scaled.value?.protein ?? 0)}
                </span>
                <span>
                  <span class="text-fat">Ж</span>
                  {' '}
                  {fmtG(scaled.value?.fat ?? 0)}
                </span>
                <span>
                  <span class="text-carbs">У</span>
                  {' '}
                  {fmtG(scaled.value?.carbs ?? 0)}
                </span>
              </div>
            </div>

            <div class="flex flex-wrap gap-1.5">
              {MEALS.map(m => (
                <button type="button" class={chipClass(meal.value === m)} onClick={() => (draftMeal.value = m)}>
                  {MEAL_LABELS[m]}
                </button>
              ))}
            </div>

            {entry.value.amountG
              ? (
                  <div>
                    <label class="mb-1.5 block text-[12px] text-ink-faint">Порция, граммы</label>
                    <input
                      type="number"
                      inputmode="decimal"
                      min="1"
                      value={amount.value}
                      onInput={event => (draftAmount.value = numeric(event.currentTarget.value))}
                      class={`${fieldClass} text-center text-lg tnum`}
                    />
                  </div>
                )
              : (
                  <div>
                    <label class="mb-1.5 block text-[12px] text-ink-faint">Калории</label>
                    <input
                      type="number"
                      inputmode="numeric"
                      min="1"
                      value={draftKcal.value ?? entry.value.kcal}
                      onInput={event => (draftKcal.value = numeric(event.currentTarget.value))}
                      class={`${fieldClass} text-center text-lg tnum`}
                    />
                  </div>
                )}

            <div class="flex gap-2">
              <button
                type="button"
                aria-label="Удалить запись"
                class="grid size-12 shrink-0 place-items-center rounded-2xl border border-over/30 text-over-bright transition hover:bg-over/15"
                onClick={removeEntry}
              >
                <IconTrash class="size-5" />
              </button>
              <button
                type="button"
                class="flex-1 rounded-2xl bg-ember py-3.5 text-[15px] font-medium text-[#1a1006] transition hover:bg-ember-bright"
                onClick={save}
              >
                Сохранить
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
