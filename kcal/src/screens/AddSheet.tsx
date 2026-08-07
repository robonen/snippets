import { computed, onMounted, shallowRef } from 'vue';
import { useRef } from 'vue-jsx-vapor';
import { useMutation, useQuery } from 'vue-sync-engine';
import { useCloseWatcher } from '@robonen/vue';
import { groupBy } from '@robonen/stdlib';
import { focus } from '@robonen/platform/browsers';
import { FoodEntity, addEntryMutation, foodsQuery, upsertFoodMutation } from '../data/defs';
import { useEntities } from '../data/composables';
import { fetchOffByBarcode } from '../data/off';
import type { OffProduct } from '../data/off';
import { defaultAmount, portionNutrients } from '../domain/calc';
import { fmtG, fmtKcal } from '../domain/format';
import { MEALS, MEAL_LABELS } from '../domain/types';
import type { Entry, Food, Meal } from '../domain/types';
import { addSheet, selectedDate } from '../ui/state';
import { IconBarcode, IconChevronLeft, IconClose, IconSearch } from '../ui/icons';
import BarcodeScanner, { isBarcodeScanSupported } from '../components/BarcodeScanner';

type Step = 'pick' | 'amount' | 'quick' | 'food';

const GRAM_PRESETS = [50, 100, 150, 200, 300];

export default function AddSheet() {
  const step = shallowRef<Step>('pick');
  const query = shallowRef('');
  const meal = shallowRef<Meal>(addSheet.meal);
  const searchEl = useRef();

  const foodsQ = useQuery(foodsQuery, () => undefined);
  const foods = useEntities(FoodEntity, () => foodsQ.data.value?.ids);

  const addEntry = useMutation(addEntryMutation);
  const upsertFood = useMutation(upsertFoodMutation);

  const close = () => (addSheet.open = false);
  useCloseWatcher().onClose(close);
  onMounted(() => focus(searchEl.value as HTMLElement | null));

  // ── выбор продукта ────────────────────────────────────────────────────────
  const trimmed = computed(() => query.value.trim().toLowerCase());
  const filtered = computed(() =>
    trimmed.value === ''
      ? foods.value
      : foods.value.filter(food => food.name.toLowerCase().includes(trimmed.value)),
  );
  const recents = computed(() =>
    [...foods.value]
      .filter(food => food.usedCount > 0)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, 8),
  );
  const groups = computed(() => {
    const grouped = groupBy(filtered.value, food => food.category);
    return Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  });

  // ── порция ────────────────────────────────────────────────────────────────
  const selectedFood = shallowRef<Food | null>(null);
  const amountG = shallowRef(100);

  const pickFood = (food: Food) => {
    selectedFood.value = food;
    amountG.value = defaultAmount(food);
    step.value = 'amount';
  };

  const preview = computed(() =>
    selectedFood.value ? portionNutrients(selectedFood.value, amountG.value) : null,
  );

  const submitAmount = () => {
    const food = selectedFood.value;
    if (!food || amountG.value <= 0) return;
    const entry: Entry = {
      id: crypto.randomUUID(),
      date: selectedDate.value,
      meal: meal.value,
      foodId: food.id,
      name: food.name,
      amountG: amountG.value,
      ...portionNutrients(food, amountG.value),
      createdAt: Date.now(),
    };
    addEntry.mutate({ entry });
    close();
  };

  // ── быстрая запись ────────────────────────────────────────────────────────
  const quickName = shallowRef('');
  const quickKcal = shallowRef(0);
  const quickProtein = shallowRef(0);
  const quickFat = shallowRef(0);
  const quickCarbs = shallowRef(0);

  const submitQuick = () => {
    if (quickKcal.value <= 0) return;
    const entry: Entry = {
      id: crypto.randomUUID(),
      date: selectedDate.value,
      meal: meal.value,
      name: quickName.value.trim() || 'Быстрая запись',
      kcal: Math.round(quickKcal.value),
      protein: quickProtein.value,
      fat: quickFat.value,
      carbs: quickCarbs.value,
      createdAt: Date.now(),
    };
    addEntry.mutate({ entry });
    close();
  };

  // ── новый продукт ─────────────────────────────────────────────────────────
  const foodName = shallowRef('');
  const foodCategory = shallowRef('Моё');
  const foodKcal = shallowRef(0);
  const foodProtein = shallowRef(0);
  const foodFat = shallowRef(0);
  const foodCarbs = shallowRef(0);
  const foodPiece = shallowRef(0);
  const foodBarcode = shallowRef('');
  const categories = computed(() => [...new Set(foods.value.map(food => food.category))].sort((a, b) => a.localeCompare(b, 'ru')));

  const submitFood = async () => {
    if (foodName.value.trim() === '' || foodKcal.value <= 0) return;
    const food: Food = {
      id: crypto.randomUUID(),
      name: foodName.value.trim(),
      category: foodCategory.value.trim() || 'Моё',
      kcal: foodKcal.value,
      protein: foodProtein.value,
      fat: foodFat.value,
      carbs: foodCarbs.value,
      ...(foodPiece.value > 0 ? { pieceGrams: foodPiece.value } : {}),
      ...(foodBarcode.value !== '' ? { barcode: foodBarcode.value } : {}),
      usedCount: 0,
      lastUsedAt: 0,
      createdAt: Date.now(),
    };
    await upsertFood.mutateAsync({ food });
    pickFood(food);
  };

  // ── база упаковок (Open Food Facts, только штрихкоды) ─────────────────────
  const offBusy = shallowRef(false);
  const offError = shallowRef('');
  const scannerOpen = shallowRef(false);
  const barcodeInput = shallowRef('');
  const scanSupported = isBarcodeScanSupported();

  /** Продукт из базы: уже сканировали раньше — сразу к порции, иначе на проверку формы. */
  const applyOffProduct = (product: OffProduct) => {
    const existing = foods.value.find(food => food.barcode === product.code);
    if (existing) {
      pickFood(existing);
      return;
    }
    foodName.value = product.brand && !product.name.toLowerCase().includes(product.brand.toLowerCase())
      ? `${product.name} (${product.brand})`
      : product.name;
    foodCategory.value = 'Упакованное';
    foodKcal.value = product.kcal;
    foodProtein.value = product.protein;
    foodFat.value = product.fat;
    foodCarbs.value = product.carbs;
    foodPiece.value = product.servingGrams ?? 0;
    foodBarcode.value = product.code;
    step.value = 'food';
  };

  const lookupBarcode = async (code: string) => {
    const digits = code.trim();
    if (digits === '' || offBusy.value) return;
    scannerOpen.value = false;
    offBusy.value = true;
    offError.value = '';
    try {
      const product = await fetchOffByBarcode(digits);
      if (product) {
        barcodeInput.value = '';
        applyOffProduct(product);
      }
      else {
        offError.value = `Штрихкод ${digits} не найден в базе — заведите продукт вручную с упаковки.`;
      }
    }
    catch (cause) {
      offError.value = cause instanceof Error ? cause.message : 'База недоступна';
    }
    finally {
      offBusy.value = false;
    }
  };

  const numeric = (raw: string): number => {
    const value = Number(raw.replace(',', '.'));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };

  // 16px обязательны: при меньшем шрифте iOS Safari зумит страницу на фокусе.
  const fieldClass = 'w-full rounded-xl border hairline bg-raised/70 px-3.5 py-2.5 text-[16px] text-ink outline-none transition focus:border-ember/50 placeholder:text-ink-faint';
  const chipClass = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-[13px] transition ${active
      ? 'border-ember/60 bg-ember/15 text-ember-bright'
      : 'border-white/10 text-ink-soft hover:border-white/20 hover:text-ink'}`;

  return (
    <div class="fixed inset-0 z-50 flex items-end justify-center">
      <div class="sheet-overlay" onClick={close} />

      <div class="sheet-panel max-h-[90dvh]">
        {/* Шапка */}
        <div class="flex items-center gap-2 px-5 pt-4 pb-3">
          {step.value !== 'pick' && (
            <button
              type="button"
              aria-label="Назад"
              class="grid size-9 place-items-center rounded-full text-ink-soft transition hover:bg-white/6"
              onClick={() => (step.value = 'pick')}
            >
              <IconChevronLeft class="size-5" />
            </button>
          )}
          <h2 class="text-display flex-1 text-lg font-medium">
            {step.value === 'pick' && `${MEAL_LABELS[meal.value]} · добавить`}
            {step.value === 'amount' && (selectedFood.value?.name ?? '')}
            {step.value === 'quick' && 'Быстрая запись'}
            {step.value === 'food' && 'Новый продукт'}
          </h2>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-9 place-items-center rounded-full text-ink-soft transition hover:bg-white/6"
            onClick={close}
          >
            <IconClose class="size-5" />
          </button>
        </div>

        {/* Приём пищи */}
        <div class="flex gap-1.5 px-5 pb-3">
          {MEALS.map(m => (
            <button type="button" class={chipClass(meal.value === m)} onClick={() => (meal.value = m)}>
              {MEAL_LABELS[m]}
            </button>
          ))}
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
          {/* ── Шаг: выбор ── */}
          {step.value === 'pick' && (
            <div class="flex flex-col gap-4">
              <div class="relative">
                <IconSearch class="absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-ink-faint" />
                <input
                  ref={searchEl}
                  type="search"
                  placeholder="Найти продукт…"
                  value={query.value}
                  onInput={event => (query.value = event.currentTarget.value)}
                  class={`${fieldClass} pl-10`}
                />
              </div>

              <div class="flex gap-2">
                <button
                  type="button"
                  class="flex-1 rounded-xl border border-dashed border-white/15 px-3 py-2.5 text-[13px] text-ink-soft transition hover:border-ember/40 hover:text-ember-bright"
                  onClick={() => (step.value = 'quick')}
                >
                  Только калории
                </button>
                <button
                  type="button"
                  class="flex-1 rounded-xl border border-dashed border-white/15 px-3 py-2.5 text-[13px] text-ink-soft transition hover:border-ember/40 hover:text-ember-bright"
                  onClick={() => (step.value = 'food')}
                >
                  Новый продукт
                </button>
              </div>

              {trimmed.value === '' && recents.value.length > 0 && (
                <div>
                  <h3 class="mb-2 text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">Недавние</h3>
                  <div class="flex flex-wrap gap-1.5">
                    {recents.value.map(food => (
                      <button
                        type="button"
                        class="rounded-full border border-white/10 bg-raised/60 px-3 py-1.5 text-[13px] text-ink transition hover:border-ember/50 hover:text-ember-bright"
                        onClick={() => pickFood(food)}
                      >
                        {food.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {groups.value.map(([category, list]) => (
                <div>
                  <h3 class="mb-1.5 text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">{category}</h3>
                  <div class="overflow-hidden rounded-2xl border hairline bg-surface/50">
                    {list.map(food => (
                      <button
                        type="button"
                        class="flex w-full items-center gap-3 border-b hairline px-4 py-2.5 text-left transition last:border-b-0 hover:bg-white/4"
                        onClick={() => pickFood(food)}
                      >
                        <span class="min-w-0 flex-1 truncate text-[14px]">{food.name}</span>
                        <span class="shrink-0 text-[12px] text-ink-faint tnum">
                          {fmtKcal(food.kcal)}
                          {' '}
                          / 100 г
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {filtered.value.length === 0 && (
                <p class="py-2 text-center text-[13px] text-ink-faint">
                  В каталоге не нашлось — отсканируйте штрихкод упаковки ниже
                  или создайте «Новый продукт».
                </p>
              )}

              {/* ── База упаковок: только штрихкоды (Open Food Facts) ── */}
              <div class="flex flex-col gap-2 border-t hairline pt-4">
                <h3 class="text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">Штрихкод упаковки</h3>

                {scanSupported && !scannerOpen.value && (
                  <button
                    type="button"
                    class="flex items-center justify-center gap-2 rounded-xl border border-white/12 px-3 py-2.5 text-[13px] text-ink-soft transition hover:border-ember/40 hover:text-ember-bright"
                    onClick={() => (scannerOpen.value = true)}
                  >
                    <IconBarcode class="size-5" />
                    Сканировать камерой
                  </button>
                )}

                {scannerOpen.value && (
                  <BarcodeScanner
                    onDetected={code => void lookupBarcode(code)}
                    onCancel={() => (scannerOpen.value = false)}
                  />
                )}

                <div class="flex gap-2">
                  <input
                    type="text"
                    inputmode="numeric"
                    placeholder="Цифры под штрихкодом…"
                    value={barcodeInput.value}
                    onInput={event => (barcodeInput.value = event.currentTarget.value.replaceAll(/\D/g, ''))}
                    onKeydown={(event) => {
                      if (event.key === 'Enter') void lookupBarcode(barcodeInput.value);
                    }}
                    class={`${fieldClass} tnum`}
                  />
                  <button
                    type="button"
                    class="shrink-0 rounded-xl border border-white/12 px-4 text-[13px] text-ink-soft transition not-disabled:hover:border-ember/40 not-disabled:hover:text-ember-bright disabled:opacity-40"
                    disabled={barcodeInput.value.length < 8 || offBusy.value}
                    onClick={() => void lookupBarcode(barcodeInput.value)}
                  >
                    {offBusy.value ? 'Ищем…' : 'Найти'}
                  </button>
                </div>

                {offError.value !== '' && (
                  <p class="rounded-xl border border-over/25 bg-over/8 px-3.5 py-2.5 text-[12px] leading-relaxed text-over-bright">
                    {offError.value}
                  </p>
                )}

                <p class="text-[11px] leading-relaxed text-ink-faint/80">
                  КБЖУ подтянутся из Open Food Facts — открытой базы упаковок.
                  Её заполняют люди, поэтому цифры стоит сверить с этикеткой.
                </p>
              </div>
            </div>
          )}

          {/* ── Шаг: порция ── */}
          {step.value === 'amount' && selectedFood.value && (
            <div class="flex flex-col gap-5">
              <div class="rounded-2xl border hairline bg-surface/60 px-5 py-4 text-center">
                <div class="text-display text-[44px] leading-none font-light">{preview.value ? fmtKcal(preview.value.kcal) : 0}</div>
                <div class="mt-1 text-[12px] text-ink-faint">ккал в порции</div>
                <div class="mt-3 flex justify-center gap-4 text-[12px] text-ink-soft tnum">
                  <span>
                    <span class="text-protein">Б</span>
                    {' '}
                    {fmtG(preview.value?.protein ?? 0)}
                  </span>
                  <span>
                    <span class="text-fat">Ж</span>
                    {' '}
                    {fmtG(preview.value?.fat ?? 0)}
                  </span>
                  <span>
                    <span class="text-carbs">У</span>
                    {' '}
                    {fmtG(preview.value?.carbs ?? 0)}
                  </span>
                </div>
              </div>

              <div>
                <label class="mb-1.5 block text-[12px] text-ink-faint">Порция, граммы</label>
                <input
                  type="number"
                  inputmode="decimal"
                  min="1"
                  value={amountG.value}
                  onInput={event => (amountG.value = numeric(event.currentTarget.value))}
                  class={`${fieldClass} text-center text-lg tnum`}
                />
                <div class="mt-2 flex flex-wrap gap-1.5">
                  {GRAM_PRESETS.map(grams => (
                    <button type="button" class={chipClass(amountG.value === grams)} onClick={() => (amountG.value = grams)}>
                      {grams}
                      {' '}
                      г
                    </button>
                  ))}
                </div>
                {selectedFood.value.pieceGrams && (
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    {[1, 2, 3].map(count => (
                      <button
                        type="button"
                        class={chipClass(amountG.value === count * (selectedFood.value?.pieceGrams ?? 0))}
                        onClick={() => (amountG.value = count * (selectedFood.value?.pieceGrams ?? 0))}
                      >
                        {`${count} шт · ${count * (selectedFood.value?.pieceGrams ?? 0)} г`}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                class="rounded-2xl bg-ember py-3.5 text-[15px] font-medium text-[#1a1006] transition hover:bg-ember-bright disabled:opacity-40"
                disabled={amountG.value <= 0}
                onClick={submitAmount}
              >
                Добавить в
                {' '}
                {MEAL_LABELS[meal.value].toLowerCase()}
              </button>
            </div>
          )}

          {/* ── Шаг: быстрая запись ── */}
          {step.value === 'quick' && (
            <div class="flex flex-col gap-4">
              <p class="text-[13px] leading-relaxed text-ink-faint">
                Когда некогда взвешивать — запишите оценку калорий, чтобы день остался честным.
                Б/Ж/У можно не указывать.
              </p>
              <input
                type="text"
                placeholder="Название (необязательно)"
                value={quickName.value}
                onInput={event => (quickName.value = event.currentTarget.value)}
                class={fieldClass}
              />
              <div>
                <label class="mb-1.5 block text-[12px] text-ink-faint">Калории</label>
                <input
                  type="number"
                  inputmode="numeric"
                  min="1"
                  placeholder="350"
                  value={quickKcal.value || ''}
                  onInput={event => (quickKcal.value = numeric(event.currentTarget.value))}
                  class={`${fieldClass} text-center text-lg tnum`}
                />
              </div>
              <div class="grid grid-cols-3 gap-2">
                {([
                  ['Белки', quickProtein],
                  ['Жиры', quickFat],
                  ['Углеводы', quickCarbs],
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
              <button
                type="button"
                class="rounded-2xl bg-ember py-3.5 text-[15px] font-medium text-[#1a1006] transition hover:bg-ember-bright disabled:opacity-40"
                disabled={quickKcal.value <= 0}
                onClick={submitQuick}
              >
                Записать
              </button>
            </div>
          )}

          {/* ── Шаг: новый продукт ── */}
          {step.value === 'food' && (
            <div class="flex flex-col gap-4">
              <input
                type="text"
                placeholder="Название продукта"
                value={foodName.value}
                onInput={event => (foodName.value = event.currentTarget.value)}
                class={fieldClass}
              />
              <div>
                <label class="mb-1.5 block text-[12px] text-ink-faint">Категория</label>
                <input
                  type="text"
                  list="food-categories"
                  value={foodCategory.value}
                  onInput={event => (foodCategory.value = event.currentTarget.value)}
                  class={fieldClass}
                />
                <datalist id="food-categories">
                  {categories.value.map(category => (
                    <option value={category} />
                  ))}
                </datalist>
              </div>
              {foodBarcode.value !== ''
                ? (
                    <p class="rounded-xl border border-ember/25 bg-ember/8 px-3.5 py-2.5 text-[12px] leading-relaxed text-ember-bright/90">
                      Значения подставлены из Open Food Facts — сверьте с этикеткой и поправьте, если расходятся.
                    </p>
                  )
                : <p class="text-[12px] text-ink-faint">Значения указываются на 100 г продукта.</p>}
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="mb-1.5 block text-[12px] text-ink-faint">Ккал / 100 г</label>
                  <input
                    type="number"
                    inputmode="decimal"
                    min="0"
                    value={foodKcal.value || ''}
                    onInput={event => (foodKcal.value = numeric(event.currentTarget.value))}
                    class={`${fieldClass} tnum`}
                  />
                </div>
                <div>
                  <label class="mb-1.5 block text-[12px] text-ink-faint">Вес 1 шт, г (если есть)</label>
                  <input
                    type="number"
                    inputmode="decimal"
                    min="0"
                    value={foodPiece.value || ''}
                    onInput={event => (foodPiece.value = numeric(event.currentTarget.value))}
                    class={`${fieldClass} tnum`}
                  />
                </div>
              </div>
              <div class="grid grid-cols-3 gap-2">
                {([
                  ['Белки', foodProtein],
                  ['Жиры', foodFat],
                  ['Углеводы', foodCarbs],
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
              <button
                type="button"
                class="rounded-2xl bg-ember py-3.5 text-[15px] font-medium text-[#1a1006] transition hover:bg-ember-bright disabled:opacity-40"
                disabled={foodName.value.trim() === '' || foodKcal.value <= 0}
                onClick={submitFood}
              >
                Сохранить и выбрать порцию
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
