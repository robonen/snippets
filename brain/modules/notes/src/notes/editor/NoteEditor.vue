<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import {
  WritekitBubbleMenu,
  WritekitContent,
  WritekitRoot,
  WritekitSlashMenu,
  blockById,
  caret,
  createDoc,
  createNode,
  createTransaction,
  createWritekit,
  createWritekitState,
  inlineText,
  isCollapsed,
  isInlineContent,
  isTextSelection,
} from '@robonen/writekit';
import type { WritekitDocument, WritekitState } from '@robonen/writekit';
import { Bold, Code, Highlighter, Italic, Strikethrough, Underline } from 'lucide-vue-next';
import type { Note } from '../entities/note';
import { linkQueryAt } from '../lib/wikilink';
import LinkPicker from '../screens/note/LinkPicker.vue';
import EditorContext from './EditorContext.vue';
import { parseMarkdown, serializeMarkdown } from './markdown';
import { notesRegistry } from './registry';

/**
 * Редактор тела заметки на `@robonen/writekit`.
 *
 * Снаружи — обычный `v-model` со строкой markdown: экран и ленд не знают о
 * документе редактора, а редактор не знает о ленде. Между ними — кодек
 * (`editor/markdown.ts`), и каждое изменение документа сразу уезжает наверх
 * строкой; задержку записи держит экран, как и раньше.
 *
 * Экземпляр редактора — на одну заметку: экран монтирует компонент с
 * `:key="id"`, поэтому смена адреса даёт свежую историю отмены и свежий
 * документ, а не транзакцию `setDoc` поверх чужого прошлого.
 *
 * Подсказка `[[…]]` перенесена из `<textarea>` как есть: разбор строки под
 * курсором — тот же `lib/wikilink.ts`, только текст берётся из текущего блока,
 * а вставка идёт транзакцией редактора.
 */
const { modelValue, notes } = defineProps<{
  /** Тело заметки в markdown. */
  modelValue: string;
  /** Куда можно сослаться по `[[…]]`. */
  notes: readonly Note[];
}>();

const emit = defineEmits<{
  'update:modelValue': [markdown: string];
}>();

const BUBBLE_MARKS = ['bold', 'italic', 'underline', 'strike', 'highlight', 'code'];
const MARK_ICONS = { bold: Bold, italic: Italic, underline: Underline, strike: Strikethrough, highlight: Highlighter, code: Code } as const;
const MARK_TITLES: Record<string, string> = {
  bold: 'Жирный (Ctrl+B)',
  italic: 'Курсив (Ctrl+I)',
  underline: 'Подчёркнутый (Ctrl+U)',
  strike: 'Зачёркнутый',
  highlight: 'Выделение',
  code: 'Код (Ctrl+E)',
};

/** Документ из markdown; пустой текст — один пустой абзац, чтобы было куда встать курсору. */
function documentOf(markdown: string): WritekitDocument {
  const blocks = parseMarkdown(markdown);
  return createDoc(blocks.length === 0 ? [createNode('paragraph', { content: [] })] : blocks);
}

const writekit = createWritekit({
  state: createWritekitState({ registry: notesRegistry, doc: documentOf(modelValue) }),
});

/** Последняя строка, которую мы отдали или получили: отсекает эхо собственных правок. */
let last = modelValue;

writekit.on('docChange', (next) => {
  const markdown = serializeMarkdown(next.doc);
  if (markdown === last) return;
  last = markdown;
  emit('update:modelValue', markdown);
});

// Значение снаружи сменилось не нашей правкой (например, отмена удаления
// вернула снимок): заменить документ, не засоряя историю отмены.
watch(() => modelValue, (markdown) => {
  if (markdown === last) return;
  last = markdown;
  writekit.dispatch(createTransaction(writekit.state).setDoc(documentOf(markdown)).setMeta('addToHistory', false));
});

onBeforeUnmount(() => {
  writekit.destroy();
});

// ── Подсказка по «[[» ────────────────────────────────────────────────────────

const linkQuery = ref<string | undefined>();
const picking = ref(false);
type FocusBlock = (blockId: string, offset: number | 'start' | 'end') => void;
let focusBlock: FocusBlock | null = null;

/** Контекст редактора отдал способ вернуть фокус в блок (см. `EditorContext`). */
function bindFocus(next: FocusBlock): void {
  focusBlock = next;
}

/** Блок с курсором и его текст — если курсор один и стоит в текстовом блоке. */
function caretIn(state: WritekitState): { blockId: string; text: string; at: number } | null {
  const selection = state.selection;
  if (!isTextSelection(selection) || !isCollapsed(selection)) return null;
  const block = blockById(state.doc, selection.focus.blockId);
  if (block === null || !isInlineContent(block.content)) return null;
  return { blockId: block.id, text: inlineText(block.content), at: selection.focus.offset };
}

function syncQuery(state: WritekitState): void {
  const found = caretIn(state);
  linkQuery.value = found === null ? undefined : linkQueryAt(found.text, found.at);
}

writekit.on('selectionChange', syncQuery);
writekit.on('docChange', syncQuery);

// Подсказка всплывает на переходе «снаружи → внутри [[»: держать её открытой
// на каждой букве значило бы открывать её заново после каждого закрытия.
watch(linkQuery, (now, before) => {
  if (now !== undefined && before === undefined) picking.value = true;
});

/** Вставить `[[заголовок]]`, дописав незакрытую пару скобок, если она есть. */
function insert(title: string): void {
  const state = writekit.state;
  const found = caretIn(state);
  if (found === null) return;
  const query = linkQueryAt(found.text, found.at);
  const from = query === undefined ? found.at : found.at - query.length - '[['.length;
  const link = `[[${title.trim()}]]`;
  const end = from + link.length;
  writekit.dispatch(
    createTransaction(state)
      .replaceInline(found.blockId, from, found.at, [{ text: link, marks: [] }])
      .setSelection(caret(found.blockId, end)),
  );
  linkQuery.value = undefined;
  picking.value = false;
  focusBlock?.(found.blockId, end);
}

/**
 * Клик по квадратику чек-листа. Квадратик нарисован стилями (`notes.css`):
 * у writekit есть команда переключения, но нет своего элемента управления, —
 * поэтому попадание в левое поле пункта переключает `checked` здесь.
 */
function onClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const item = target.closest<HTMLElement>('[data-list="todo"]');
  if (item === null || event.clientX - item.getBoundingClientRect().left > 28) return;
  const blockId = item.closest<HTMLElement>('[data-block-id]')?.dataset['blockId'];
  if (blockId === undefined) return;
  const state = writekit.state;
  const block = blockById(state.doc, blockId);
  if (block === null) return;
  event.preventDefault();
  writekit.dispatch(createTransaction(state).setAttrs(blockId, { ...block.attrs, checked: block.attrs['checked'] !== true }));
}

// Фокус ушёл в подсказку — примитив ставит его на содержимое при открытии.
// Вернуть его в текст обязан редактор: он один знает позицию курсора.
watch(picking, (open) => {
  if (open) return;
  const found = caretIn(writekit.state);
  if (found !== null) focusBlock?.(found.blockId, found.at);
});
</script>

<template>
  <div class="note-editor flex max-w-[68ch] flex-col gap-3">
    <div class="flex items-end justify-between gap-2">
      <p class="text-xs leading-relaxed text-text-faint">
        «/» — вставить блок, выделение — форматирование, [[ — ссылка на заметку.
      </p>
      <LinkPicker
        v-model:open="picking"
        :notes="notes"
        :query="linkQuery ?? ''"
        @pick="insert"
      />
    </div>

    <div @click="onClick">
      <WritekitRoot :writekit="writekit" spellcheck>
        <EditorContext @ready="bindFocus" />
        <WritekitContent aria-label="Текст заметки" />
        <WritekitBubbleMenu :marks="BUBBLE_MARKS">
          <template #default="{ active, toggle }">
            <button
              v-for="mark in BUBBLE_MARKS"
              :key="mark"
              type="button"
              :title="MARK_TITLES[mark]"
              :aria-label="MARK_TITLES[mark]"
              :data-active="active(mark) ? '' : undefined"
              @mousedown.prevent
              @click="toggle(mark)"
            >
              <component :is="MARK_ICONS[mark as keyof typeof MARK_ICONS]" class="size-4" />
            </button>
          </template>
        </WritekitBubbleMenu>
        <WritekitSlashMenu />
      </WritekitRoot>
    </div>
  </div>
</template>
