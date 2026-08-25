/**
 * Как выгрузка покидает приложение.
 *
 * Тестами не покрыто и покрыто не будет: здесь нет ни одного решения — только
 * вызовы браузера. Всё, что можно проверить, живёт в `entities/export.ts`,
 * который отдаёт текст и ничего про браузер не знает.
 */

/** Сохранить текст файлом. Ссылка живёт ровно один клик. */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Объектная ссылка держит весь текст в памяти, пока её не отозвали, а
  // страница приложения живёт до закрытия вкладки.
  URL.revokeObjectURL(url);
}

/**
 * Положить текст в буфер обмена. `false` — браузер не дал: без https и без
 * жеста пользователя доступа к буферу нет, и молчать об этом нельзя.
 *
 * Обычная функция, а не `useClipboard`: её зовут из обработчика нажатия, где
 * области действия у композабла уже нет. Да и брать от него нечего — `copied`
 * и `text` здесь не нужны, а отказ буфера он отдаёт исключением, и `try`
 * вернулся бы ровно сюда же.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  }
  catch {
    return false;
  }
}
