import { computed, shallowRef, watch } from 'vue';
import { Status, useEntity, useMutation } from 'vue-sync-engine';
import { DB_NAME, ProfileEntity, saveProfileMutation } from '../data/defs';
import { downloadBackupFile, exportBackup, importBackup } from '../data/backup';
import type { BackupPayload } from '../data/backup';
import { bmr, computeTargets, roundTo, safeKcalFloor, tdee } from '../domain/calc';
import { fmtKcal } from '../domain/format';
import { ACTIVITY_LEVELS, GOAL_LABELS, PROFILE_ID } from '../domain/types';
import type { Goal, Profile, Sex } from '../domain/types';
import { IconDownload, IconUpload } from '../ui/icons';
import HelpSection from './HelpSection';

const GOALS: readonly Goal[] = ['lose', 'maintain', 'gain'];

/** Онбординг при первом входе и настройки в дальнейшем — одна форма. */
export default function ProfileScreen(props: { onboarding?: boolean }) {
  const profile = useEntity(ProfileEntity, () => PROFILE_ID);
  const save = useMutation(saveProfileMutation);

  const source = profile.value;
  const sex = shallowRef<Sex>(source?.sex ?? 'male');
  const age = shallowRef(source?.age ?? 30);
  const heightCm = shallowRef(source?.heightCm ?? 175);
  const weightKg = shallowRef(source?.weightKg ?? 75);
  const activity = shallowRef(source?.activity ?? 1.375);
  const goal = shallowRef<Goal>(source?.goal ?? 'lose');

  const targetKcal = shallowRef(source?.targetKcal ?? 0);
  const targetProtein = shallowRef(source?.targetProtein ?? 0);
  const targetFat = shallowRef(source?.targetFat ?? 0);
  const targetCarbs = shallowRef(source?.targetCarbs ?? 0);

  const valid = computed(() =>
    age.value >= 10 && age.value <= 100
    && heightCm.value >= 120 && heightCm.value <= 230
    && weightKg.value >= 30 && weightKg.value <= 300,
  );

  const recompute = () => {
    if (!valid.value) return;
    const targets = computeTargets({
      sex: sex.value,
      age: age.value,
      heightCm: heightCm.value,
      weightKg: weightKg.value,
      activity: activity.value,
      goal: goal.value,
    });
    targetKcal.value = targets.kcal;
    targetProtein.value = targets.protein;
    targetFat.value = targets.fat;
    targetCarbs.value = targets.carbs;
  };

  // Цели следуют за параметрами; ручную правку ниже можно сделать перед сохранением.
  watch([sex, age, heightCm, weightKg, activity, goal], recompute);
  if (!source) recompute();

  const bmrValue = computed(() =>
    valid.value ? Math.round(bmr(sex.value, age.value, heightCm.value, weightKg.value)) : 0,
  );
  const tdeeValue = computed(() =>
    valid.value ? roundTo(tdee(sex.value, age.value, heightCm.value, weightKg.value, activity.value), 10) : 0,
  );
  const belowFloor = computed(() => targetKcal.value > 0 && targetKcal.value < safeKcalFloor(sex.value));

  const submit = () => {
    if (!valid.value || targetKcal.value <= 0) return;
    const now = Date.now();
    const next: Profile = {
      id: PROFILE_ID,
      sex: sex.value,
      age: age.value,
      heightCm: heightCm.value,
      weightKg: weightKg.value,
      activity: activity.value,
      goal: goal.value,
      targetKcal: targetKcal.value,
      targetProtein: targetProtein.value,
      targetFat: targetFat.value,
      targetCarbs: targetCarbs.value,
      createdAt: profile.value?.createdAt ?? now,
      updatedAt: now,
    };
    save.mutate({ profile: next });
  };

  // ── бэкап ─────────────────────────────────────────────────────────────────
  const importing = shallowRef(false);
  const notice = shallowRef('');

  const doExport = async () => {
    downloadBackupFile(await exportBackup());
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    importing.value = true;
    try {
      const payload = JSON.parse(await file.text()) as BackupPayload;
      await importBackup(payload);
      location.reload();
    }
    catch (error) {
      notice.value = error instanceof Error ? error.message : 'Не удалось прочитать файл';
      importing.value = false;
    }
  };

  const wipeAll = () => {
    if (!globalThis.confirm('Удалить все данные приложения? Действие необратимо.')) return;
    indexedDB.deleteDatabase(DB_NAME);
    location.reload();
  };

  const numeric = (raw: string): number => {
    const value = Number(raw.replace(',', '.'));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };

  // 16px обязательны: при меньшем шрифте iOS Safari зумит страницу на фокусе.
  const fieldClass = 'w-full rounded-xl border hairline bg-raised/70 px-3.5 py-2.5 text-[16px] text-ink outline-none transition focus:border-ember/50 tnum';
  const chipClass = (active: boolean) =>
    `flex-1 rounded-xl border px-3 py-2 text-[13px] transition ${active
      ? 'border-ember/60 bg-ember/15 text-ember-bright'
      : 'border-white/10 text-ink-soft hover:border-white/20 hover:text-ink'}`;

  return (
    <div class="flex flex-col gap-5 pb-6">
      <div class="animate-rise">
        {props.onboarding
          ? (
              <div class="pt-6 text-center">
                <div class="text-display text-[40px] leading-none font-light text-ember-bright">Ккал</div>
                <h1 class="text-display mt-4 text-xl font-medium">Настроим дневник</h1>
                <p class="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-ink-soft">
                  Пара параметров — и посчитаем вашу дневную норму калорий и белка.
                  Всё хранится только на этом устройстве.
                </p>
              </div>
            )
          : <h1 class="text-display text-xl font-medium">Профиль</h1>}
      </div>

      {/* Параметры тела */}
      <section class="animate-rise flex flex-col gap-4 rounded-3xl border hairline bg-surface/80 p-5" style={{ animationDelay: '40ms' }}>
        <div class="flex gap-2">
          <button type="button" class={chipClass(sex.value === 'male')} onClick={() => (sex.value = 'male')}>Мужчина</button>
          <button type="button" class={chipClass(sex.value === 'female')} onClick={() => (sex.value = 'female')}>Женщина</button>
        </div>

        <div class="grid grid-cols-3 gap-2">
          <div>
            <label class="mb-1.5 block text-[12px] text-ink-faint">Возраст</label>
            <input
              type="number"
              inputmode="numeric"
              min="10"
              max="100"
              value={age.value}
              onInput={event => (age.value = numeric(event.currentTarget.value))}
              class={fieldClass}
            />
          </div>
          <div>
            <label class="mb-1.5 block text-[12px] text-ink-faint">Рост, см</label>
            <input
              type="number"
              inputmode="numeric"
              min="120"
              max="230"
              value={heightCm.value}
              onInput={event => (heightCm.value = numeric(event.currentTarget.value))}
              class={fieldClass}
            />
          </div>
          <div>
            <label class="mb-1.5 block text-[12px] text-ink-faint">Вес, кг</label>
            <input
              type="number"
              inputmode="decimal"
              min="30"
              max="300"
              step="0.1"
              value={weightKg.value}
              onInput={event => (weightKg.value = numeric(event.currentTarget.value))}
              class={fieldClass}
            />
          </div>
        </div>

        <div>
          <label class="mb-1.5 block text-[12px] text-ink-faint">Активность</label>
          <div class="flex flex-col gap-1.5">
            {ACTIVITY_LEVELS.map(level => (
              <button
                type="button"
                class={`flex items-baseline justify-between rounded-xl border px-3.5 py-2.5 text-left transition ${activity.value === level.value
                  ? 'border-ember/60 bg-ember/12'
                  : 'border-white/10 hover:border-white/20'}`}
                onClick={() => (activity.value = level.value)}
              >
                <span class={`text-[14px] ${activity.value === level.value ? 'text-ember-bright' : 'text-ink'}`}>{level.label}</span>
                <span class="text-[12px] text-ink-faint">{level.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label class="mb-1.5 block text-[12px] text-ink-faint">Цель</label>
          <div class="flex gap-2">
            {GOALS.map(value => (
              <button type="button" class={chipClass(goal.value === value)} onClick={() => (goal.value = value)}>
                {GOAL_LABELS[value]}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Расчёт и цели */}
      <section class="animate-rise rounded-3xl border hairline bg-surface/80 p-5" style={{ animationDelay: '80ms' }}>
        <div class="mb-4 flex justify-around text-center">
          <div>
            <div class="text-display text-[24px] font-light tnum">{fmtKcal(bmrValue.value)}</div>
            <div class="mt-0.5 text-[11px] text-ink-faint">базовый обмен</div>
          </div>
          <div>
            <div class="text-display text-[24px] font-light tnum">{fmtKcal(tdeeValue.value)}</div>
            <div class="mt-0.5 text-[11px] text-ink-faint">суточный расход</div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="mb-1.5 block text-[12px] text-ink-faint">Цель, ккал</label>
            <input
              type="number"
              inputmode="numeric"
              min="0"
              value={targetKcal.value}
              onInput={event => (targetKcal.value = numeric(event.currentTarget.value))}
              class={fieldClass}
            />
          </div>
          <div>
            <label class="mb-1.5 block text-[12px] text-ink-faint">Белки, г</label>
            <input
              type="number"
              inputmode="numeric"
              min="0"
              value={targetProtein.value}
              onInput={event => (targetProtein.value = numeric(event.currentTarget.value))}
              class={fieldClass}
            />
          </div>
          <div>
            <label class="mb-1.5 block text-[12px] text-ink-faint">Жиры, г</label>
            <input
              type="number"
              inputmode="numeric"
              min="0"
              value={targetFat.value}
              onInput={event => (targetFat.value = numeric(event.currentTarget.value))}
              class={fieldClass}
            />
          </div>
          <div>
            <label class="mb-1.5 block text-[12px] text-ink-faint">Углеводы, г</label>
            <input
              type="number"
              inputmode="numeric"
              min="0"
              value={targetCarbs.value}
              onInput={event => (targetCarbs.value = numeric(event.currentTarget.value))}
              class={fieldClass}
            />
          </div>
        </div>

        {belowFloor.value && (
          <p class="mt-3 rounded-xl border border-over/30 bg-over/10 px-3.5 py-2.5 text-[12px] leading-relaxed text-over-bright">
            Цель ниже безопасного минимума (
            {fmtKcal(safeKcalFloor(sex.value))}
            {' '}
            ккал).
            Долгий жёсткий дефицит вредит — лучше худеть медленнее.
          </p>
        )}

        <p class="mt-3 text-[12px] leading-relaxed text-ink-faint">
          Цели пересчитываются из параметров выше, но перед сохранением их можно
          поправить вручную. Формула — Миффлина—Сан Жеора.
        </p>

        <button
          type="button"
          class="mt-4 w-full rounded-2xl bg-ember py-3.5 text-[15px] font-medium text-[#1a1006] transition hover:bg-ember-bright disabled:opacity-40"
          disabled={!valid.value || targetKcal.value <= 0}
          onClick={submit}
        >
          {props.onboarding ? 'Начать вести дневник' : 'Сохранить'}
        </button>
        {!props.onboarding && save.status.value === Status.Success && (
          <p class="mt-2 text-center text-[12px] text-protein">Сохранено</p>
        )}
      </section>

      {/* Данные */}
      {!props.onboarding && (
        <section class="animate-rise rounded-3xl border hairline bg-surface/80 p-5" style={{ animationDelay: '120ms' }}>
          <h2 class="mb-3 text-[13px] text-ink-soft">Данные</h2>
          <div class="flex gap-2">
            <button
              type="button"
              class="flex flex-1 items-center justify-center gap-2 rounded-xl border hairline px-3 py-2.5 text-[13px] text-ink-soft transition hover:border-white/20 hover:text-ink"
              onClick={doExport}
            >
              <IconDownload class="size-4" />
              Экспорт JSON
            </button>
            <label class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border hairline px-3 py-2.5 text-[13px] text-ink-soft transition hover:border-white/20 hover:text-ink">
              <IconUpload class="size-4" />
              {importing.value ? 'Импорт…' : 'Импорт JSON'}
              <input
                type="file"
                accept="application/json"
                class="hidden"
                onChange={event => void doImport(event.currentTarget.files?.[0])}
              />
            </label>
          </div>
          {notice.value && <p class="mt-2 text-[12px] text-over-bright">{notice.value}</p>}
          <p class="mt-3 text-[12px] leading-relaxed text-ink-faint">
            Всё хранится в IndexedDB этого браузера. Делайте экспорт время от
            времени — браузер может очистить данные сайта.
          </p>
          <button
            type="button"
            class="mt-4 w-full rounded-xl border border-over/30 py-2.5 text-[13px] text-over-bright transition hover:bg-over/12"
            onClick={wipeAll}
          >
            Стереть все данные
          </button>
        </section>
      )}

      {!props.onboarding && <HelpSection />}
    </div>
  );
}
