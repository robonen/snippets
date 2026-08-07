import { computed, shallowRef } from 'vue';
import { useEntity, useMutation, useQuery } from 'vue-sync-engine';
import { useCloseWatcher } from '@robonen/vue';
import { FoodEntity, foodsQuery, removeFoodMutation, upsertFoodMutation } from '../data/defs';
import { useEntities } from '../data/composables';
import type { Food } from '../domain/types';
import { foodForm } from '../ui/state';
import { IconClose, IconTrash } from '../ui/icons';

/** Создание и правка продукта каталога. Значения нутриентов — на 100 г. */
export default function FoodFormSheet() {
  const existing = useEntity(FoodEntity, () => foodForm.foodId ?? undefined);
  const foodsQ = useQuery(foodsQuery, () => undefined);
  const foods = useEntities(FoodEntity, () => foodsQ.data.value?.ids);

  const upsert = useMutation(upsertFoodMutation);
  const remove = useMutation(removeFoodMutation);

  const close = () => (foodForm.open = false);
  useCloseWatcher().onClose(close);

  const source = existing.value;
  const name = shallowRef(source?.name ?? '');
  const category = shallowRef(source?.category ?? 'Моё');
  const kcal = shallowRef(source?.kcal ?? 0);
  const protein = shallowRef(source?.protein ?? 0);
  const fat = shallowRef(source?.fat ?? 0);
  const carbs = shallowRef(source?.carbs ?? 0);
  const pieceGrams = shallowRef(source?.pieceGrams ?? 0);

  const categories = computed(() => [...new Set(foods.value.map(food => food.category))].sort((a, b) => a.localeCompare(b, 'ru')));

  const save = () => {
    if (name.value.trim() === '' || kcal.value <= 0) return;
    const base = existing.value;
    const food: Food = {
      id: base?.id ?? crypto.randomUUID(),
      name: name.value.trim(),
      category: category.value.trim() || 'Моё',
      kcal: kcal.value,
      protein: protein.value,
      fat: fat.value,
      carbs: carbs.value,
      ...(pieceGrams.value > 0 ? { pieceGrams: pieceGrams.value } : {}),
      usedCount: base?.usedCount ?? 0,
      lastUsedAt: base?.lastUsedAt ?? 0,
      ...(base?.lastAmountG ? { lastAmountG: base.lastAmountG } : {}),
      createdAt: base?.createdAt ?? Date.now(),
    };
    upsert.mutate({ food });
    close();
  };

  const removeFood = () => {
    const base = existing.value;
    if (!base) return;
    remove.mutate({ id: base.id });
    close();
  };

  const numeric = (raw: string): number => {
    const value = Number(raw.replace(',', '.'));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };

  // 16px обязательны: при меньшем шрифте iOS Safari зумит страницу на фокусе.
  const fieldClass = 'w-full rounded-xl border hairline bg-raised/70 px-3.5 py-2.5 text-[16px] text-ink outline-none transition focus:border-ember/50 placeholder:text-ink-faint';

  return (
    <div class="fixed inset-0 z-50 flex items-end justify-center">
      <div class="animate-fade-in absolute inset-0 bg-black/65 backdrop-blur-[2px]" onClick={close} />

      <div class="animate-sheet-up relative flex max-h-[90dvh] w-full max-w-105 flex-col rounded-t-3xl border border-b-0 hairline bg-[#191511] shadow-[0_-24px_80px_rgba(0,0,0,0.5)]">
        <div class="flex items-center gap-2 px-5 pt-4 pb-3">
          <h2 class="text-display flex-1 text-lg font-medium">{existing.value ? 'Продукт' : 'Новый продукт'}</h2>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-9 place-items-center rounded-full text-ink-soft transition hover:bg-white/6"
            onClick={close}
          >
            <IconClose class="size-5" />
          </button>
        </div>

        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-8">
          <input
            type="text"
            placeholder="Название"
            value={name.value}
            onInput={event => (name.value = event.currentTarget.value)}
            class={fieldClass}
          />
          <div>
            <label class="mb-1.5 block text-[12px] text-ink-faint">Категория</label>
            <input
              type="text"
              list="food-form-categories"
              value={category.value}
              onInput={event => (category.value = event.currentTarget.value)}
              class={fieldClass}
            />
            <datalist id="food-form-categories">
              {categories.value.map(item => (
                <option value={item} />
              ))}
            </datalist>
          </div>

          <p class="text-[12px] text-ink-faint">Значения указываются на 100 г продукта.</p>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="mb-1.5 block text-[12px] text-ink-faint">Ккал / 100 г</label>
              <input
                type="number"
                inputmode="decimal"
                min="0"
                value={kcal.value || ''}
                onInput={event => (kcal.value = numeric(event.currentTarget.value))}
                class={`${fieldClass} tnum`}
              />
            </div>
            <div>
              <label class="mb-1.5 block text-[12px] text-ink-faint">Вес 1 шт, г</label>
              <input
                type="number"
                inputmode="decimal"
                min="0"
                value={pieceGrams.value || ''}
                onInput={event => (pieceGrams.value = numeric(event.currentTarget.value))}
                class={`${fieldClass} tnum`}
              />
            </div>
          </div>
          <div class="grid grid-cols-3 gap-2">
            {([
              ['Белки', protein],
              ['Жиры', fat],
              ['Углеводы', carbs],
            ] as const).map(([label, model]) => (
              <div>
                <label class="mb-1.5 block text-[12px] text-ink-faint">
                  {label}
                  , г
                </label>
                <input
                  type="number"
                  inputmode="decimal"
                  min="0"
                  value={model.value || ''}
                  onInput={event => (model.value = numeric(event.currentTarget.value))}
                  class={`${fieldClass} text-center tnum`}
                />
              </div>
            ))}
          </div>

          <div class="flex gap-2">
            {existing.value && (
              <button
                type="button"
                aria-label="Удалить продукт"
                class="grid size-12 shrink-0 place-items-center rounded-2xl border border-over/30 text-over-bright transition hover:bg-over/15"
                onClick={removeFood}
              >
                <IconTrash class="size-5" />
              </button>
            )}
            <button
              type="button"
              class="flex-1 rounded-2xl bg-ember py-3.5 text-[15px] font-medium text-[#1a1006] transition hover:bg-ember-bright disabled:opacity-40"
              disabled={name.value.trim() === '' || kcal.value <= 0}
              onClick={save}
            >
              Сохранить
            </button>
          </div>

          {existing.value && (
            <p class="text-[12px] leading-relaxed text-ink-faint">
              Записи в дневнике хранят свой снимок значений — правка продукта
              не меняет уже записанные дни.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
