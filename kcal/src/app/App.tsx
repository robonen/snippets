import { computed, reactive, shallowRef, watchEffect } from 'vue';
import { useProfile } from '@/db/composables';
import type { Meal } from '@/entities/entry';
import { todayISO } from '@/shared/lib/dates';
import { IconApple, IconBook, IconChart, IconPlus, IconUser } from '@/shared/ui/icons';
import DiaryScreen from '@/screens/diary/DiaryScreen';
import StatsScreen from '@/screens/stats/StatsScreen';
import FoodsScreen from '@/screens/foods/FoodsScreen';
import ProfileScreen from '@/screens/profile/ProfileScreen';
import AddSheet from '@/screens/add/AddSheet';
import EditEntrySheet from '@/screens/edit-entry/EditEntrySheet';
import FoodFormSheet from '@/screens/food-form/FoodFormSheet';

type Tab = 'diary' | 'stats' | 'foods' | 'profile';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'diary', label: 'Дневник' },
  { id: 'stats', label: 'Статистика' },
  { id: 'foods', label: 'Продукты' },
  { id: 'profile', label: 'Профиль' },
];

/** Приём пищи по времени суток — разумный дефолт для кнопки «+». */
function mealByHour(hour: number): Meal {
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

function tabIcon(tab: Tab, active: boolean) {
  const cls = `size-5.5 ${active ? 'text-ember-bright' : 'text-ink-faint'}`;
  if (tab === 'diary') return <IconBook class={cls} />;
  if (tab === 'stats') return <IconChart class={cls} />;
  if (tab === 'foods') return <IconApple class={cls} />;
  return <IconUser class={cls} />;
}

export default function App() {
  const profile = useProfile();
  const ready = profile.ready;
  const hasProfile = profile.exists;

  // Навигация — состояние каркаса. Экраны получают её пропсами и вверх не
  // смотрят: направление зависимостей одно — от app вниз.
  const activeTab = shallowRef<Tab>('diary');
  const selectedDate = shallowRef(todayISO());
  const addSheet = reactive({ open: false, meal: 'breakfast' as Meal });
  const editEntryId = shallowRef<string | null>(null);
  const foodForm = reactive({ open: false, foodId: null as string | null });

  const openAdd = (meal: Meal) => {
    addSheet.meal = meal;
    addSheet.open = true;
  };
  const openFoodForm = (foodId: string | null) => {
    foodForm.foodId = foodId;
    foodForm.open = true;
  };
  const showDay = (date: string) => {
    selectedDate.value = date;
    activeTab.value = 'diary';
  };

  const sheetOpen = computed(() => addSheet.open || editEntryId.value !== null || foodForm.open);
  watchEffect(() => {
    document.documentElement.classList.toggle('overflow-hidden', sheetOpen.value);
  });

  return (
    <div class="pt-screen-safe mx-auto flex min-h-dvh w-full max-w-105 flex-col px-4">
      {!ready.value && (
        <div class="flex flex-1 items-center justify-center">
          <span class="text-display animate-pulse text-2xl font-light text-ember-bright">Ккал</span>
        </div>
      )}

      {ready.value && !hasProfile.value && (
        <div class="pb-10">
          <ProfileScreen onboarding />
        </div>
      )}

      {ready.value && hasProfile.value && (
        <>
          <main class="pb-nav-safe flex-1">
            {activeTab.value === 'diary' && (
              <DiaryScreen
                date={selectedDate.value}
                onDateChange={date => (selectedDate.value = date)}
                onAdd={openAdd}
                onEdit={id => (editEntryId.value = id)}
              />
            )}
            {activeTab.value === 'stats' && <StatsScreen onShowDay={showDay} />}
            {activeTab.value === 'foods' && <FoodsScreen onEditFood={openFoodForm} />}
            {activeTab.value === 'profile' && <ProfileScreen />}
          </main>

          {/* Нижняя навигация */}
          <nav class="fixed inset-x-0 bottom-0 z-40 flex justify-center">
            <div class="pb-bar-safe flex w-full max-w-105 items-end border-t hairline bg-[#151210]/92 px-2 pt-2 backdrop-blur-md">
              {TABS.slice(0, 2).map(tab => (
                <button
                  type="button"
                  class="flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 transition hover:bg-white/4"
                  onClick={() => (activeTab.value = tab.id)}
                >
                  {tabIcon(tab.id, activeTab.value === tab.id)}
                  <span class={`text-[10px] ${activeTab.value === tab.id ? 'text-ember-bright' : 'text-ink-faint'}`}>{tab.label}</span>
                </button>
              ))}

              <div class="flex flex-1 justify-center">
                <button
                  type="button"
                  aria-label="Добавить запись"
                  class="grid size-13 -translate-y-3 place-items-center rounded-full bg-ember text-[#1a1006] shadow-[0_10px_30px_rgba(207,119,40,0.35)] transition hover:bg-ember-bright active:scale-95"
                  onClick={() => openAdd(mealByHour(new Date().getHours()))}
                >
                  <IconPlus class="size-6" />
                </button>
              </div>

              {TABS.slice(2).map(tab => (
                <button
                  type="button"
                  class="flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 transition hover:bg-white/4"
                  onClick={() => (activeTab.value = tab.id)}
                >
                  {tabIcon(tab.id, activeTab.value === tab.id)}
                  <span class={`text-[10px] ${activeTab.value === tab.id ? 'text-ember-bright' : 'text-ink-faint'}`}>{tab.label}</span>
                </button>
              ))}
            </div>
          </nav>
        </>
      )}

      {addSheet.open && (
        <AddSheet
          date={selectedDate.value}
          meal={addSheet.meal}
          onClose={() => (addSheet.open = false)}
        />
      )}
      {editEntryId.value !== null && (
        <EditEntrySheet entryId={editEntryId.value} onClose={() => (editEntryId.value = null)} />
      )}
      {foodForm.open && (
        <FoodFormSheet foodId={foodForm.foodId} onClose={() => (foodForm.open = false)} />
      )}
    </div>
  );
}
