import { onMounted, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { ShallowRef } from 'vue';

/**
 * Разделы дневника и переходы между ними.
 *
 * Разделы — настоящие маршруты, а не вкладки в состоянии экрана: у статистики
 * и каталога должны быть ссылки, иначе на них нельзя ни сослаться из палитры,
 * ни вернуться кнопкой «назад».
 */
export type Section = 'diary' | 'foods' | 'stats' | 'profile';

export interface SectionInfo {
  id: Section;
  title: string;
}

export const SECTIONS: readonly SectionInfo[] = [
  { id: 'diary', title: 'Дневник' },
  { id: 'foods', title: 'Продукты' },
  { id: 'stats', title: 'Статистика' },
  { id: 'profile', title: 'Профиль' },
];

/** Имена маршрутов: пути вешает оболочка под `/kcal`, имена принадлежат модулю. */
export const SECTION_ROUTE: Record<Section, string> = {
  diary: 'kcal:diary',
  foods: 'kcal:foods',
  stats: 'kcal:stats',
  profile: 'kcal:profile',
};

/**
 * Заявка «показать раздел», поднятая командой палитры.
 *
 * Команда не может увести экран сама: `ModuleContext` намеренно отдаёт модулю
 * только его пространство, роутером владеет оболочка. Поэтому команда оставляет
 * заявку, а тот, кто сейчас на экране, её забирает и переходит.
 */
const pending: ShallowRef<Section | null> = shallowRef(null);

export function requestSection(section: Section): void {
  pending.value = section;
}

/**
 * Забирать заявки, пока компонент смонтирован.
 *
 * `takeOnMount` — забрать и ту, что подняли до монтирования: так команда,
 * позванная из чужого модуля, доводит человека до места, когда он войдёт в
 * дневник. Виджету «Сегодня» это не годится: он монтируется на главной, и
 * человека, нажавшего «Сегодня», унесло бы в дневник без всякой просьбы.
 */
export function useSectionRequests(takeOnMount = false): void {
  const router = useRouter();

  const take = (): void => {
    const next = pending.value;
    if (next === null) return;
    // Заявка одноразовая: иначе экран возвращался бы в неё при каждом показе.
    pending.value = null;
    void router.push({ name: SECTION_ROUTE[next] });
  };

  watch(pending, take);
  if (takeOnMount) onMounted(take);
}
