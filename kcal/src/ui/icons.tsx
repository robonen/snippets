import {
  Apple,
  BookOpen,
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  ScanBarcode,
  Search,
  Trash2,
  Upload,
  UserRound,
  Weight,
  X,
} from 'lucide';
import type { IconNode } from 'lucide';

interface IconProps {
  class?: string;
}

/**
 * Иконки — данные из `lucide` (пары [тег, атрибуты] без обёртки svg).
 * Компоненты lucide-vue-next построены на vdom и в чистом Vapor не работают,
 * поэтому рендерим содержимое сами: данные статичны и доверенны — сериализуем
 * их в разметку один раз на модуль и вставляем через v-html.
 */
function toMarkup(node: IconNode): string {
  return node
    .map(([tag, attrs]) => {
      const serialized = Object.entries(attrs)
        .map(([key, value]) => `${key}="${String(value)}"`)
        .join(' ');
      return `<${tag} ${serialized}/>`;
    })
    .join('');
}

function createIcon(node: IconNode) {
  const markup = toMarkup(node);
  return (props: IconProps) => (
    <svg
      class={props.class ?? 'size-5'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      v-html={markup}
    />
  );
}

export const IconBook = createIcon(BookOpen);
export const IconChart = createIcon(ChartColumn);
export const IconApple = createIcon(Apple);
export const IconUser = createIcon(UserRound);
export const IconPlus = createIcon(Plus);
export const IconChevronLeft = createIcon(ChevronLeft);
export const IconChevronRight = createIcon(ChevronRight);
export const IconClose = createIcon(X);
export const IconTrash = createIcon(Trash2);
export const IconSearch = createIcon(Search);
export const IconScale = createIcon(Weight);
export const IconBarcode = createIcon(ScanBarcode);
export const IconDownload = createIcon(Download);
export const IconUpload = createIcon(Upload);
