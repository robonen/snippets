/**
 * `@brain/ui` — общий кит: токены оформления и компоненты поверх
 * `@robonen/primitives`.
 *
 * Здесь не должно появляться ничего доменного. Как только компонент начинает
 * знать про калории, заметки или задачи, его место в модуле: кит без домена —
 * единственное, что позволяет ему оставаться общим. Где домен всё-таки нужен
 * (цвет полосы в `Meter`), он приходит снаружи значением.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * РАСКЛАДКА ПО ПАПКАМ
 *
 * Плоский список из тридцати файлов не отвечал на единственный вопрос, с
 * которым в кит приходят: «а есть ли уже такое?». Папки отвечают, потому что
 * делят не по виду, а по РОЛИ — по тому, что компонент делает с вниманием
 * пользователя и с его данными. Критерий у каждой проверяемый, иначе через
 * месяц он превратится в «куда положилось».
 *
 *   theme/     Значения оформления и выбор темы. Единственное место, которое
 *              знает про `data-theme` и про то, что тем вообще несколько.
 *
 *   overlays/  Рисуются В ПОРТАЛЕ поверх документа и имеют состояние
 *              «открыт/закрыт». Отсюда у них общее: ловушка фокуса, Esc,
 *              возврат фокуса на триггер и появление ОТ триггера.
 *
 *   forms/     Пользователь вводит значение и подтверждает его: `v-model` на
 *              введённое, подпись через `for`, ошибка через `aria-describedby`.
 *              Кнопка здесь же — это последний шаг ввода, а не украшение.
 *
 *   data/      Показывают то, что им дали, и наружу ничего не возвращают.
 *              Очередь тостов (`toast.ts`) лежит рядом с их отображением: это
 *              одна вещь, разделённая только границей «состояние / вид».
 *
 *   layout/    Каркас экрана и переключение его частей. Карточка и шапка держат
 *              раму, вкладки и сегменты решают, ЧТО в этой раме показать.
 *
 * Наружу папок нет: модули импортируют из `@brain/ui` и о раскладке не знают —
 * иначе любая перестановка внутри кита ломала бы двадцать файлов в модулях.
 * Этот файл — единственная публичная граница.
 */

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ВРЕМЕННЫЙ МОСТ: иконки под старыми именами.
 *
 * Кит больше не заворачивает иконки в свою фабрику — компоненты `lucide`
 * прекрасно работают сами, а обёртка стоила лишнего слоя и собственного
 * словаря имён. Модули пока импортируют `IconPlus` и соседей отсюда, поэтому
 * здесь остаётся реэкспорт: снести словарь и двадцать файлов в модулях одним
 * движением — это не рефакторинг, а переучёт.
 *
 * Переезд: в модуле пишется `import { Plus } from 'lucide-vue-next'`, из этого
 * списка строка убирается. Когда список опустеет, исчезнет и он сам.
 */
export {
  Activity as IconTracker,
  Apple as IconKcal,
  ArrowDown as IconDown,
  ArrowUp as IconUp,
  Bookmark as IconBookmark,
  BookOpen as IconNotes,
  CalendarDays as IconCalendar,
  ChartColumn as IconStats,
  Check as IconCheck,
  ChevronDown as IconExpand,
  ChevronLeft as IconBack,
  ChevronRight as IconForward,
  Ellipsis as IconMore,
  Fingerprint as IconPasskey,
  Inbox as IconInbox,
  KeyRound as IconKey,
  ListTodo as IconTasks,
  Lock as IconLock,
  Minus as IconMinus,
  Monitor as IconMonitor,
  Moon as IconMoon,
  Plus as IconPlus,
  Search as IconSearch,
  Settings as IconSettings,
  Sun as IconSun,
  Sun as IconToday,
  TriangleAlert as IconWarning,
  Wallet as IconMoney,
  X as IconClose,
} from 'lucide-vue-next';

export { default as Card } from './layout/Card.vue';
export { default as Disclosure } from './layout/Disclosure.vue';
export { default as EmptyState } from './layout/EmptyState.vue';
export { default as Page } from './layout/Page.vue';
export { default as PageHeader } from './layout/PageHeader.vue';
export { default as SplitView } from './layout/SplitView.vue';
export { default as SegmentedControl } from './layout/SegmentedControl.vue';
export type { Segment } from './layout/SegmentedControl.vue';
export { default as Spinner } from './layout/Spinner.vue';
export { default as Tabs } from './layout/Tabs.vue';
export type { Tab } from './layout/Tabs.vue';
export { default as Toolbar } from './layout/Toolbar.vue';
export type { ToolbarAction } from './layout/Toolbar.vue';

export { default as Button } from './forms/Button.vue';
export { default as Checkbox } from './forms/Checkbox.vue';
export { default as Combobox } from './forms/Combobox.vue';
export type { ComboboxOption } from './forms/Combobox.vue';
export { default as NumberField } from './forms/NumberField.vue';
export { default as RadioCards } from './forms/RadioCards.vue';
export type { RadioCard } from './forms/RadioCards.vue';
export { default as Select } from './forms/Select.vue';
export type { SelectOption } from './forms/Select.vue';
export { default as SwitchField } from './forms/SwitchField.vue';
export { default as TextField } from './forms/TextField.vue';

export { default as ConfirmDialog } from './overlays/ConfirmDialog.vue';
export { default as Menu } from './overlays/Menu.vue';
export type { MenuAction } from './overlays/Menu.vue';
export { default as Palette } from './overlays/Palette.vue';
export type { PaletteGroup, PaletteItem } from './overlays/Palette.vue';
export { default as Popover } from './overlays/Popover.vue';
export { default as Sheet } from './overlays/Sheet.vue';
export { default as Tooltip } from './overlays/Tooltip.vue';
export { default as TooltipProvider } from './overlays/TooltipProvider.vue';

export { default as Badge } from './data/Badge.vue';
export { default as ListRow } from './data/ListRow.vue';
export { default as Meter } from './data/Meter.vue';
export { default as StatTile } from './data/StatTile.vue';
export { default as Toast } from './data/Toast.vue';
export { useToast } from './data/toast';
export type { ToastAction, ToastEntry, ToastOptions } from './data/toast';

export { default as ThemeToggle } from './theme/ThemeToggle.vue';
export { default as Logo } from './theme/Logo.vue';
export { default as Wordmark } from './theme/Wordmark.vue';
export { initTheme, useTheme } from './theme/theme';
export { applyLight, initAmbient, lightAt } from './theme/ambient';
export type { AmbientLight } from './theme/ambient';
export type { ThemeChoice } from './theme/theme';
