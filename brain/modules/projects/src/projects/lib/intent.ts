import { onMounted, shallowRef, watch } from 'vue';

/**
 * Намерение «завести проект», поднятое командой палитры.
 *
 * Команда получает только пространство модуля (`ModuleContext`), а форма живёт
 * на экране — им нужен общий сигнал. Счётчик, а не флаг: две команды подряд
 * обязаны открыть форму дважды, а `true → true` не изменение и наблюдателя не
 * разбудит.
 */
const requests = shallowRef(0);

/** Последний увиденный экраном запрос — чтобы поднятый до монтирования не пропал. */
let seen = 0;

export function requestAdd(): void {
  requests.value += 1;
}

/**
 * Открывать форму по запросу, пока экран смонтирован. Запрос, поднятый до
 * монтирования (палитра позвала команду с «Сегодня»), отрабатывает сразу после.
 */
export function onAddRequested(open: () => void): void {
  const consume = (): void => {
    if (requests.value === seen) return;
    seen = requests.value;
    open();
  };
  watch(requests, consume);
  onMounted(consume);
}
