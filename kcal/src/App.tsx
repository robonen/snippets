import { computed, watchEffect } from 'vue';
import { useQuery } from 'vue-sync-engine';
import { profileQuery } from './data/defs';
import type { Meal } from './domain/types';
import { activeTab, addSheet, editEntryId, foodForm, openAddSheet } from './ui/state';
import type { Tab } from './ui/state';
import { IconApple, IconBook, IconChart, IconPlus, IconUser } from './ui/icons';
import DiaryScreen from './screens/DiaryScreen';
import StatsScreen from './screens/StatsScreen';
import FoodsScreen from './screens/FoodsScreen';
import ProfileScreen from './screens/ProfileScreen';
import AddSheet from './screens/AddSheet';
import EditEntrySheet from './screens/EditEntrySheet';
import FoodFormSheet from './screens/FoodFormSheet';

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
  const profileQ = useQuery(profileQuery, () => undefined);
  const ready = computed(() => profileQ.data.value !== undefined);
  const hasProfile = computed(() => profileQ.data.value?.exists === true);

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
            {activeTab.value === 'diary' && <DiaryScreen />}
            {activeTab.value === 'stats' && <StatsScreen />}
            {activeTab.value === 'foods' && <FoodsScreen />}
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
                  onClick={() => openAddSheet(mealByHour(new Date().getHours()))}
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

      {addSheet.open && <AddSheet />}
      {editEntryId.value !== null && <EditEntrySheet />}
      {foodForm.open && <FoodFormSheet />}
    </div>
  );
}
