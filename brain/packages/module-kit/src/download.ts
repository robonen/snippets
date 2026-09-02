import { effectScope } from 'vue';
import { useObjectUrl } from '@robonen/vue';

/**
 * Сохранить текст файлом на устройстве пользователя.
 *
 * Объектный URL выдаёт и отзывает `useObjectUrl` — он же следит, чтобы снимок
 * не завис в памяти до закрытия вкладки. Область создаётся своя и гасится
 * сразу после клика: зовут отсюда и команды палитры, у которых компонентной
 * области нет, а скачивание к этому моменту уже началось.
 */
export function downloadText(name: string, text: string, type = 'text/plain;charset=utf-8'): void {
  const scope = effectScope();
  scope.run(() => {
    const url = useObjectUrl(new Blob([text], { type }));
    if (url.value === undefined) return;
    const link = document.createElement('a');
    link.href = url.value;
    link.download = name;
    link.click();
  });
  scope.stop();
}
