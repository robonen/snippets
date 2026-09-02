import { onMounted, shallowRef, watch } from 'vue';

/**
 * Намерение «завести запись», поднятое командой палитры и забираемое экраном.
 *
 * Команда получает только пространство модуля (`ModuleContext`), а форма живёт
 * на экране — им нужен общий сигнал. Это не `createEventHook` из
 * `@robonen/vue`: у хука нет памяти, а заявка поднимается ДО монтирования
 * экрана (палитра позвала команду с «Сегодня») и обязана дождаться его.
 * Поэтому внутри счётчик, а не флаг: две команды подряд открывают форму
 * дважды, а `true → true` не изменение и наблюдателя не разбудит.
 */
export interface Intent {
  /** Поднять заявку — из команды палитры или другого экрана. */
  request(): void;
  /**
   * Открывать форму по заявке, пока экран смонтирован. Заявка, поднятая до
   * монтирования, отрабатывает сразу после него.
   */
  onRequested(open: () => void): void;
}

export function createIntent(): Intent {
  const requests = shallowRef(0);
  /** Последняя заявка, которую экран уже увидел. */
  let seen = 0;

  return {
    request() {
      requests.value += 1;
    },
    onRequested(open) {
      const consume = (): void => {
        if (requests.value === seen) return;
        seen = requests.value;
        open();
      };
      watch(requests, consume);
      onMounted(consume);
    },
  };
}
