import { onMounted, shallowRef, watch } from 'vue';

/**
 * Намерение «записать трату», поднятое командой палитры.
 *
 * Команда получает только пространство модуля (`ModuleContext`), а поле ввода
 * живёт на экране — им нужен общий сигнал. Счётчик, а не флаг: две команды
 * подряд обязаны сработать дважды, а `true → true` не изменение и наблюдателя не
 * разбудит.
 */
const requests = shallowRef(0);

/** Последний увиденный экраном запрос — чтобы поднятый до монтирования не пропал. */
let seen = 0;

export function requestEntry(): void {
  requests.value += 1;
}

/**
 * Отзываться на запрос, пока экран смонтирован. Запрос, поднятый до монтирования
 * (палитру позвали с «Сегодня»), отрабатывает сразу после.
 */
export function onEntryRequested(open: () => void): void {
  const consume = (): void => {
    if (requests.value === seen) return;
    seen = requests.value;
    open();
  };
  watch(requests, consume);
  onMounted(consume);
}
