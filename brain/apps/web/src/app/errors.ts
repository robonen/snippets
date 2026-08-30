/**
 * Текст ошибки для человека. Пустой `message` (так бросает WebCrypto —
 * OperationError без слов) показать нечего: тогда — запасная фраза.
 */
export function errorText(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message !== '' ? caught.message : fallback;
}
