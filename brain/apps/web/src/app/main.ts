import { createApp } from 'vue';
import { installBrain } from '@brain/module-kit';
import { initAmbient, initTheme } from '@brain/ui';
import Shell from '@/shell/Shell.vue';
import { bootBrain } from '@/app/boot';
import { createBrainRouter } from '@/app/router';
import '@/app/app.css';

/**
 * Запуск: сначала ключи, потом данные, потом интерфейс.
 *
 * Порядок разобран в `boot.ts` — коротко, ленды теперь зашифрованы, и открыть
 * их до появления ключа нечем. Интерфейс всё так же поднимается ПОСЛЕ данных
 * там, где данные вообще могут быть: компонент, смонтированный раньше, увидел
 * бы пустое пространство и решил, что данных нет — а они просто ещё в пути.
 */
// Тема — ДО отрисовки: атрибут, поставленный после монтирования, дал бы
// вспышку светлой темы тому, кто выбрал тёмную.
initTheme();
// Свет по часу — до отрисовки, чтобы страница не перекрашивалась на глазах.
initAmbient();

// Офлайн-оболочка: воркер прекэширует сборку, и холодный старт без сети
// перестаёт быть белым экраном. В dev виртуальный модуль отдаёт заглушку.
if ('serviceWorker' in navigator) {
  const { registerSW } = await import('virtual:pwa-register');
  // Новая сборка воркера перехватывает страницу сразу (clientsClaim), но код
  // страницы остаётся старым до перезагрузки — и успевает натворить дел в
  // ленде ключей. Обновился воркер — страница перезагружается немедленно.
  // Только при УЖЕ существующем контроллере: первая установка — не обновление.
  if (navigator.serviceWorker.controller !== null) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      globalThis.location.reload();
    }, { once: true });
  }
  registerSW({ immediate: true });
}

// WebCrypto (`crypto.subtle`) браузер отдаёт только в защищённом контексте —
// HTTPS или localhost. По голому http://<ip> его просто нет, и без проверки
// первый же вызов падал бы криптическим «reading 'generateKey'». Полифилла не
// существует по построению: нужен TLS перед сервером (docs/04-server.md §3).
if (globalThis.crypto?.subtle === undefined) {
  const root = document.querySelector('#app');
  if (root !== null) {
    root.textContent = 'Приложению нужен защищённый контекст: откройте его по HTTPS '
      + '(или на localhost). По обычному http:// браузер не даёт WebCrypto, '
      + 'а без него нечем шифровать данные.';
    root.setAttribute('role', 'alert');
    root.setAttribute('style', 'display:grid;min-height:100dvh;place-items:center;padding:2rem;text-align:center');
  }
  throw new Error('WebCrypto is unavailable: insecure context (serve over HTTPS or use localhost)');
}

try {
  const { spaces, registry } = await bootBrain();

  const app = createApp(Shell);
  installBrain(app, { spaces, registry });
  app.use(createBrainRouter(registry));
  app.mount('#app');
}
catch (error) {
  // Отказ запуска — это почти всегда «браузер не дал хранилище»: приватный
  // режим, отозванная квота, выключенный IndexedDB. Молчать нельзя: пустой
  // экран человек прочитает как «данные пропали».
  const said = error instanceof Error ? error.message : String(error);
  const root = document.querySelector('#app');
  if (root !== null) {
    root.textContent = `Не удалось открыть хранилище: ${said}`;
    root.setAttribute('role', 'alert');
    root.setAttribute('style', 'display:grid;min-height:100dvh;place-items:center;padding:2rem;text-align:center');
  }
  throw error;
}
