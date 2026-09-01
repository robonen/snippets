/**
 * Как выгрузка покидает приложение. Здесь нет решений — только вызов браузера;
 * всё, что можно проверить, живёт в `lib/markdown.ts`, который отдаёт текст.
 * Буфер обмена — через `useClipboard` из `@robonen/vue` прямо на экранах.
 */

/** Сохранить текст файлом. Ссылка живёт ровно один клик. */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
