<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronDown, Plus, Search } from 'lucide-vue-next';
import { Button, EmptyState, Page, PageHeader } from '@brain/ui';
import { useFoods } from '../../db/composables';
import { findByBarcode } from '../../entities/food';
import { draftFromOff } from '../../features/barcode/off';
import { fmtKcal } from '../../lib/format';
import type { Food, FoodDraft } from '../../entities/food';
import type { OffProduct } from '../../features/barcode/off';
import SectionTabs from '../SectionTabs.vue';
import FoodFormSheet from './FoodFormSheet.vue';
import ScanSheet from './ScanSheet.vue';

/**
 * Каталог продуктов: свои и стартовые, все правятся одинаково.
 *
 * Ширина — `list`: строке нужно место под название и калорийность справа, но
 * читать здесь нечего. Освободившуюся ширину забирает не строка, а СЕТКА: с `sm`
 * продукты идут в две колонки, и каталог на полсотни позиций перестаёт быть
 * полосой в один продукт с пустотой на весь остальной экран.
 */
const foods = useFoods();

const query = ref('');
const editing = ref<Food | null>(null);
const draft = ref<FoodDraft | null>(null);
const formOpen = ref(false);
const scanOpen = ref(false);

/**
 * Свёрнутые категории. Хранится ЗАКРЫТОЕ, а не открытое: категорий бывает
 * десяток, и список, у которого по умолчанию закрыто всё, отвечает на вопрос
 * «где мой продукт» лишним нажатием на каждую попытку.
 */
const collapsed = ref(new Set<string>());

const groups = computed(() => {
  const text = query.value.trim().toLowerCase();
  const matched = text === ''
    ? foods.value
    : foods.value.filter(food => food.name.toLowerCase().includes(text));

  const byCategory = new Map<string, Food[]>();
  for (const food of matched) {
    const list = byCategory.get(food.category);
    if (list === undefined) byCategory.set(food.category, [food]);
    else list.push(food);
  }
  return [...byCategory.entries()]
    .map(([category, list]) => ({ category, list }))
    .sort((a, b) => a.category.localeCompare(b.category, 'ru'));
});

const searching = computed(() => query.value.trim() !== '');

// Поиск раскрывает всё: свёрнутая категория с единственным совпадением выглядит
// как «ничего не нашлось», хотя нашлось.
function isOpen(category: string): boolean {
  return searching.value || !collapsed.value.has(category);
}

function toggle(category: string): void {
  const next = new Set(collapsed.value);
  if (!next.delete(category)) next.add(category);
  collapsed.value = next;
}

function edit(food: Food | null): void {
  editing.value = food;
  draft.value = null;
  formOpen.value = true;
}

/**
 * Найденное по штрихкоду открывается формой, а не падает в каталог само: цифры
 * в открытой базе заполняют люди, и сверить их с этикеткой — работа человека.
 * Уже знакомый штрихкод открывает существующий продукт, а не заводит двойника.
 */
function fromBarcode(product: OffProduct): void {
  const known = findByBarcode(foods.value, product.code);
  if (known !== undefined) {
    edit(known);
    return;
  }
  editing.value = null;
  draft.value = draftFromOff(product);
  formOpen.value = true;
}
</script>

<template>
  <Page width="list">
    <SectionTabs class="mb-4" />

    <PageHeader title="Продукты" :subtitle="`${foods.length} в каталоге`">
      <template #action>
        <Button size="sm" @click="scanOpen = true">
          Штрихкод
        </Button>
        <Button tone="primary" size="sm" @click="edit(null)">
          <Plus class="size-4" />
          Продукт
        </Button>
      </template>
    </PageHeader>

    <div class="relative mb-3">
      <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-faint" />
      <input
        v-model="query"
        type="search"
        placeholder="Поиск по каталогу"
        aria-label="Поиск продукта"
        class="h-10 w-full rounded-control border border-line bg-surface pr-3 pl-9 text-sm text-text
               transition-colors placeholder:text-text-faint focus:border-accent focus:outline-none"
      >
    </div>

    <!--
      Одна поверхность со свёрнутыми секциями вместо `Disclosure` на категорию:
      кит рисует каждую секцию отдельной карточкой, а каталог из десяти
      категорий тогда превращается в десять одинаковых прямоугольников — ровно
      то, чего плотный список избегает.
    -->
    <div v-if="groups.length > 0" class="overflow-hidden rounded-card border border-line bg-surface">
      <section v-for="group in groups" :key="group.category" class="border-b border-line last:border-b-0">
        <h2>
          <button
            type="button"
            :aria-expanded="isOpen(group.category)"
            class="pressable flex w-full items-center gap-2 px-4 py-2.5 text-left hoverable"
            @click="toggle(group.category)"
          >
            <ChevronDown
              class="size-3.5 shrink-0 text-text-faint transition-transform duration-(--duration-menu)
                     ease-(--ease-in-out) motion-reduce:transition-none"
              :class="!isOpen(group.category) && '-rotate-90'"
            />
            <span class="min-w-0 flex-1 truncate text-xs font-medium tracking-wide text-text-faint uppercase">
              {{ group.category }}
            </span>
            <span class="tnum shrink-0 text-xs text-text-faint">{{ group.list.length }}</span>
          </button>
        </h2>

        <!--
          Разделители — на самих строках, а не `divide-y`: в две колонки
          `divide-y` ставит линию каждому соседу по потоку и рисует её поперёк
          первого ряда, а вертикальной границы между колонками не даёт вовсе.
          Отсюда точные правила: верхняя линия у всех, кроме первого ряда;
          правая — у левой колонки, кроме одинокой последней строки.
        -->
        <ul
          v-if="isOpen(group.category)"
          class="grid border-t border-line [&>li+li]:border-t [&>li]:border-line
                 sm:grid-cols-2 sm:[&>li:last-child:nth-child(odd)]:border-r-0
                 sm:[&>li:nth-child(2)]:border-t-0 sm:[&>li:nth-child(odd)]:border-r"
        >
          <li v-for="food in group.list" :key="food.id">
            <button
              type="button"
              class="pressable flex h-full w-full items-center gap-3 px-4 py-2 text-left hoverable"
              @click="edit(food)"
            >
              <span class="min-w-0 flex-1 truncate text-sm text-text">{{ food.name }}</span>
              <span class="shrink-0 text-right">
                <span class="tnum block text-sm text-text">{{ fmtKcal(food.kcal) }}</span>
                <span class="block text-[0.625rem] text-text-faint">ккал / 100 г</span>
              </span>
            </button>
          </li>
        </ul>
      </section>
    </div>

    <EmptyState
      v-else-if="searching"
      title="Ничего не нашлось"
      description="Проверьте написание — поиск идёт по имени продукта. Нового можно завести кнопкой «Продукт» или сканом штрихкода."
    >
      <template #action>
        <Button tone="primary" @click="edit(null)">
          <Plus class="size-4" />
          Продукт
        </Button>
      </template>
    </EmptyState>

    <EmptyState
      v-else
      title="Каталог пуст"
      description="Каталог хранит калорийность и БЖУ на 100 г, чтобы дневник считал порцию сам. Заведите продукт руками или отсканируйте штрихкод с упаковки."
    >
      <template #action>
        <Button tone="primary" @click="edit(null)">
          <Plus class="size-4" />
          Продукт
        </Button>
      </template>
    </EmptyState>

    <FoodFormSheet v-model:open="formOpen" :food="editing" :draft="draft" />
    <ScanSheet v-model:open="scanOpen" @found="fromBarcode" />
  </Page>
</template>
