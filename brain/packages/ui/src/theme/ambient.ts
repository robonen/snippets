/**
 * Свет по времени суток.
 *
 * Ставит четыре переменные на `<html>`; всё остальное делает CSS
 * (`.ambient::before` в `tokens.css`). Здесь нет ни кадров, ни таймеров чаще
 * раза в четверть часа: угол солнца за минуту не меняется, а страница,
 * открытая фоном на весь день, не должна ничего пересчитывать.
 *
 * Почему это вообще есть: одинаковый экран в семь утра и в полночь — самая
 * заметная примета «сделано по шаблону». Свет, идущий за часом, стоит двух
 * градиентов и делает страницу узнаваемой, ничего не занимая на экране.
 */

export interface AmbientLight {
  /** Положение основного пятна, проценты. */
  readonly x: number;
  readonly y: number;
  /** Оттенок в OKLCH: тёплый на рассвете и закате, холодный днём и ночью. */
  readonly hue: number;
  /** Насколько свет заметен. Ночью почти ноль. */
  readonly strength: number;
}

/**
 * Час → свет. Чистая функция, поэтому проверяется тестом, а не глазами в
 * шесть утра.
 *
 * Опорных точек четыре, между ними — линейная интерполяция по кругу суток:
 * без неё в 11:59 и 12:01 картинка дёргалась бы, а рассвет должен наступать.
 */
const KEYS: ReadonlyArray<{ hour: number; light: AmbientLight }> = [
  // Ночь: свет почти выключен, холодный индиго у горизонта.
  { hour: 0, light: { x: 50, y: 110, hue: 265, strength: 0.02 } },
  // Утро: низкое тёплое солнце слева.
  { hour: 7, light: { x: 12, y: 8, hue: 70, strength: 0.055 } },
  // Полдень: высоко, нейтрально, ровно.
  { hour: 13, light: { x: 50, y: -12, hue: 240, strength: 0.04 } },
  // Вечер: садится вправо, густеет.
  { hour: 19, light: { x: 88, y: 18, hue: 40, strength: 0.06 } },
];

export function lightAt(hour: number): AmbientLight {
  const h = ((hour % 24) + 24) % 24;

  let from = KEYS[KEYS.length - 1]!;
  let to = KEYS[0]!;
  let span = 24 - from.hour + to.hour;
  let passed = h >= from.hour ? h - from.hour : 24 - from.hour + h;

  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i]!;
    const b = KEYS[i + 1]!;
    if (h >= a.hour && h < b.hour) {
      from = a;
      to = b;
      span = b.hour - a.hour;
      passed = h - a.hour;
      break;
    }
  }

  const t = span === 0 ? 0 : passed / span;
  return {
    x: mix(from.light.x, to.light.x, t),
    y: mix(from.light.y, to.light.y, t),
    hue: mixHue(from.light.hue, to.light.hue, t),
    strength: mix(from.light.strength, to.light.strength, t),
  };
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Оттенок — по кругу: путь от 350° к 10° идёт через ноль, а не через 180°. */
function mixHue(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
}

export function applyLight(light: AmbientLight, root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--light-x', `${light.x.toFixed(1)}%`);
  root.style.setProperty('--light-y', `${light.y.toFixed(1)}%`);
  root.style.setProperty('--light-hue', light.hue.toFixed(0));
  root.style.setProperty('--light-strength', light.strength.toFixed(3));
}

/** Раз в пятнадцать минут: чаще нечего показывать, реже — заметен скачок. */
const TICK_MS = 15 * 60 * 1000;

/**
 * Таймер и слушатель здесь заведены руками, а не через `useIntervalFn` и
 * `useEventListener`, и это осознанно: функция вызывается один раз из `main.ts`
 * вне scope компонента, где автоматическая очистка всё равно не сработала бы.
 * Композабл дал бы ту же строчку кода плюс ложное обещание, что за ним кто-то
 * приберёт.
 */
export function initAmbient(): () => void {
  const tick = (): void => {
    applyLight(lightAt(new Date().getHours() + new Date().getMinutes() / 60));
  };
  tick();

  const timer = setInterval(tick, TICK_MS);

  // Пересчёт при возвращении на вкладку. Одного таймера мало: в фоне браузер
  // душит интервалы, а на время сна машины они не идут вовсе — после ночи
  // ноутбук просыпается с вечерним светом на экране, пока не подойдёт
  // следующий тик. Возврат на вкладку — ровно тот момент, когда это видно.
  const wake = (): void => {
    if (document.visibilityState === 'visible') tick();
  };
  document.addEventListener('visibilitychange', wake);

  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', wake);
  };
}
