import { computed, readonly, shallowRef } from 'vue';
import {
  authenticate,
  createDek,
  createSalt,
  deviceKek,
  dropDeviceKek,
  isKnownPhrase,
  kekFromAssertion,
  kekFromPassphrase,
  normalizePhrase,
  openWith,
  randomBytes,
  unlock as unlockVault,
} from '@brain/auth';
import type { OpenVault, WrappedDek } from '@brain/auth';
import type { Chest } from '@brain/module-kit';
import type { ComputedRef, ShallowRef } from 'vue';
import type { Space } from '@sync/core';
import { dropWrap, listWraps, saveWrap } from './keys';

/**
 * Замок приложения (docs/01-security.md §5).
 *
 * Что замок даёт теперь, когда ленды на диске зашифрованы: пока он заперт, DEK
 * забыт, а расшифрованные ленды закрыты и выброшены из памяти вкладки —
 * `conceal` снимает их целиком, а не прячет за `v-if`. Значит, «заперто»
 * означает «данных в этой вкладке нет», а не «данные есть, но не показываем».
 *
 * От чего он по-прежнему НЕ защищает: от кода, исполняемого в этом origin, пока
 * приложение открыто. Расшифрованный ленд в этот момент лежит в памяти, и в вебе
 * против этого средств нет.
 *
 * Счётчика бездействия здесь НЕТ намеренно: он живёт в `Shell.vue` на
 * `useIdle`, то есть внутри scope компонента, где снимается сам. Модульный
 * `setInterval` пришлось бы снимать вручную, а главное — второй счётчик рядом
 * с первым неизбежно с ним расходится: этот считал время от разблокировки, а не
 * от последнего действия, и захлопывал замок посреди работы.
 */

export type LockState = 'locked' | 'open';

/** Метка обёртки под ключом устройства. Она одна на устройство. */
const DEVICE_LABEL = 'это устройство';

/**
 * Чем замок связан с данными.
 *
 * Инъекция, а не импорт: замок отвечает за ключи, а не за хранилища, и знать,
 * как ленды переезжают на шифртекст, ему незачем. Сборка подаёт две операции.
 */
export interface LockBind {
  /** Ленд с обёртками ключа — тот, который лежит открытым. */
  readonly meta: Space;
  /**
   * Сундук запечатанных лендов. Не операция, а ссылка: замку он нужен только
   * затем, чтобы отдать наружу (`currentChest`) — присоединению и отзыву
   * (`security/account.ts`) есть куда перепечатать журналы (`reseal` из
   * `@brain/module-kit`) ДО того, как `reveal` поднимет ленды новым ключом.
   */
  readonly chest: Chest;
  /** Ключ получен: поднять зашифрованные ленды. */
  readonly reveal: (vault: OpenVault) => Promise<void>;
  /** Убрать расшифрованное: дописать несохранённое и закрыть ленды. */
  readonly conceal: () => Promise<void>;
}

const state = shallowRef<LockState>('locked');
const vault = shallowRef<OpenVault | null>(null);
const wraps = shallowRef<readonly WrappedDek[]>([]);
let bound: LockBind | null = null;

/** Способы доступа, которые спрашивают человека. Ключ устройства не спрашивает. */
function keyed(list: readonly WrappedDek[]): readonly WrappedDek[] {
  return list.filter(wrap => wrap.kind !== 'device');
}

export function useLock(): {
  state: Readonly<ShallowRef<LockState>>;
  configured: ComputedRef<boolean>;
  /** Способы доступа, которыми человек управляет на экране «Доступ». */
  access: ComputedRef<readonly WrappedDek[]>;
  lock: () => void;
} {
  const access = computed(() => keyed(wraps.value));
  return {
    state: readonly(state),
    configured: computed(() => access.value.length > 0),
    access,
    lock,
  };
}

/**
 * Состояние замка на старте — и, если способ доступа не настроен, открытие
 * ключом устройства.
 *
 * ПОРЯДОК ЗДЕСЬ ПЕРЕВЁРНУТ по сравнению с тем, как было до шифрования: раньше
 * сначала поднимались все ленды, а замок лишь закрывал экран. Теперь наоборот —
 * пока ключа нет, шифрованный ленд открыть нечем, и поднимать нечего.
 */
export async function armLock(bind: LockBind): Promise<void> {
  bound = bind;
  refresh();

  if (keyed(wraps.value).length > 0) {
    state.value = 'locked';
    return;
  }
  await openByDevice();
}

/**
 * Первый запуск и всё время до настройки passkey: ключ данных заводится СРАЗУ и
 * заворачивается в неизвлекаемый ключ устройства.
 *
 * Отложить это до настройки нельзя. «Ключа ещё нет, значит пишем открыто» —
 * это дыра ровно там, где её труднее всего заметить: первые дни приложение
 * складывает заметки текстом, а человек уверен, что настроил шифрование потом.
 */
async function openByDevice(): Promise<void> {
  const kek = await deviceKek();
  if (kek === null) {
    throw new Error(
      'браузер не дал сохранить ключ устройства: без него данные пришлось бы писать открытым '
      + 'текстом, и приложение этого делать не станет',
    );
  }

  const found = wraps.value.find(wrap => wrap.kind === 'device');
  if (found !== undefined) {
    await settle(await unlockVault(found, kek));
    return;
  }

  const dek = createDek();
  const opened = openWith(dek);
  // `openWith` берёт копию, поэтому наш экземпляр — лишний: затираем, чтобы
  // ключ жил ровно в одном месте.
  dek.fill(0);
  save(await opened.wrapFor(kek, { kind: 'device', label: DEVICE_LABEL, salt: EMPTY_SALT }));
  await settle(opened);
}

/**
 * Соли у ключа устройства нет: KDF не участвует, KEK берётся у платформы
 * целиком. Пустые байты честнее случайных — те намекали бы на вывод, которого
 * не происходит.
 */
const EMPTY_SALT = new Uint8Array(0);

/**
 * Пора ли запирать после отлучки — правило из docs/01-security.md §5 («вкладка
 * в фоне дольше N минут»), вынесенное сюда, чтобы его можно было проверить.
 *
 * Считает НАСТЕННЫЕ часы, а не время таймера, и в этом весь смысл: во сне
 * машины таймеры не идут, поэтому счётчик бездействия проспит отлучку вместе
 * с ноутбуком, а разница отметок — нет.
 *
 * `hiddenAt === 0` — «вкладку ещё ни разу не прятали»; в этом случае запирать
 * нечего, иначе первое же переключение окна запирало бы приложение.
 */
export function lockedByAway(hiddenAt: number, now: number, idleMs: number): boolean {
  return hiddenAt !== 0 && now - hiddenAt > idleMs;
}

export function lock(): void {
  if (state.value !== 'open') return;
  // Запирать нечем — значит и незачем. Пока настроен только ключ устройства,
  // экран замка не открылся бы ни пальцем, ни фразой: человек остался бы перед
  // дверью без ключа, и спасала бы только перезагрузка страницы.
  if (keyed(wraps.value).length === 0) return;
  // Экран запирается СИНХРОННО: между командой «заблокировать» и исчезновением
  // данных не должно быть кадра, в котором они ещё нарисованы. Уборка идёт
  // следом и ключ забывает ПОСЛЕ неё — последняя пачка ещё запечатывается.
  state.value = 'locked';
  const opened = vault.value;
  vault.value = null;
  void (async () => {
    try {
      await bound?.conceal();
    }
    finally {
      opened?.lock();
    }
  })();
}

/** Открыть passkey: биометрия плюс вывод ключа из PRF одним обращением. */
export async function unlockByPasskey(rpId: string): Promise<void> {
  const passkeys = wraps.value.filter(wrap => wrap.kind === 'passkey');
  if (passkeys.length === 0) throw new Error('passkey не настроен');

  // Соль общая для всех passkey-обёрток: PRF заказывается ДО того, как станет
  // известно, каким именно ключом человек ответил.
  const salt = passkeys[0]!.salt;
  const assertion = await authenticate({ rpId, challenge: randomBytes(32) }, salt);
  const kek = await kekFromAssertion(assertion, salt);
  if (kek === null) {
    throw new Error('этот ключ не умеет PRF — откройте фразой восстановления');
  }

  await openWithKek(passkeys, kek);
}

export async function unlockByPhrase(phrase: string): Promise<void> {
  const wrap = wraps.value.find(entry => entry.kind === 'passphrase');
  if (wrap === undefined) throw new Error('фраза восстановления не настроена');
  if (!isKnownPhrase(phrase)) throw new Error('в этой фразе есть слова не из словаря');

  const kek = await kekFromPassphrase(normalizePhrase(phrase), wrap.salt);
  await openWithKek([wrap], kek);
}

/**
 * Записать новую обёртку того же ключа: второй passkey, фраза.
 *
 * Заворачивает ТЕКУЩИЙ DEK через `wrapFor`, а не заводит новый: новый открыл бы
 * пустоту вместо данных, зашифрованных прежним.
 */
export async function addAccess(
  // `CryptoKey` — сверх исходной сигнатуры: `rewrapDevice` ниже заворачивает
  // ключом устройства, а он неизвлекаемый и байтов не даёт по построению
  // (§5.1). `wrapFor` оба вида уже принимал, здесь просто перестали сужать.
  kek: Uint8Array | CryptoKey,
  meta: { kind: WrappedDek['kind']; label: string; salt: Uint8Array },
): Promise<void> {
  const opened = vault.value;
  if (opened === null) throw new Error('хранилище заперто: сначала откройте данные');

  save(await opened.wrapFor(kek, meta));

  // Ключ устройства открывал данные БЕЗ спроса — ровно то, от чего защищает
  // замок (У1). Как только появился способ, который спрашивает человека,
  // тихий путь обязан исчезнуть, иначе замок остаётся декорацией.
  if (meta.kind !== 'device') await forgetDevice();
}

/**
 * Перезавернуть обёртку ключа устройства под ТЕКУЩИМ DEK.
 *
 * Присоединение свежего устройства без локальных данных (`security/account.ts`,
 * docs/01-security.md §7, «просто заменить DEK на аккаунтный: перезавернуть
 * device-обёртку»): вызывается ПОСЛЕ `swapVault`, когда `vault.value` уже
 * указывает на аккаунтный DEK, — устройство продолжает открываться ключом
 * устройства без спроса, как и до присоединения, только теперь на аккаунтные
 * данные, а не на осиротевший локальный DEK, который они заменили.
 */
export async function rewrapDevice(kek: CryptoKey): Promise<void> {
  await addAccess(kek, { kind: 'device', label: DEVICE_LABEL, salt: EMPTY_SALT });
}

export function currentVault(): OpenVault | null {
  return vault.value;
}

/** Мета-ленд — тем, кому нужно читать или писать обёртки напрямую (`security/account.ts`). */
export function currentMeta(): Space {
  return need().meta;
}

/** Сундук запечатанных лендов — тем, кому нужно перепечатать журналы (`reseal`). */
export function currentChest(): Chest {
  return need().chest;
}

/**
 * Заменить открытый ключ ДРУГИМ: снять живые ленды, поднять их заново под
 * новым вольтом. Присоединение с уже имеющимися локальными данными и отзыв
 * способа доступа (`security/account.ts`, docs/01-security.md §7) — оба меняют
 * DEK у данных, которые уже лежат на диске, а не заводят его для пустоты.
 *
 * Журналы лендов ОБЯЗАНЫ быть уже перепечатаны под `to` (`reseal` из
 * `@brain/module-kit`) ДО этого вызова: `reveal` поднимет их, читая сундук
 * заново под новым ключом, — и если журнал всё ещё под старым, подъём бросит.
 *
 * `state` не трогается (остаётся `'open'`): вызывающий уже разблокирован —
 * иначе экрану присоединения/отзыва неоткуда было бы взяться, — и мигать
 * полноэкранным замком посреди операции нечем оправдать.
 */
export async function swapVault(to: OpenVault): Promise<void> {
  const bind = need();
  const opened = vault.value;
  // Сначала погасить синк и дописать несохранённое ПОД СТАРЫМ ключом, потом
  // забыть его: `reseal` читает сундук ДО этого вызова, но закрыть ленды всё
  // равно нужно раньше, чем `reveal` попробует их переоткрыть.
  await bind.conceal();
  // `opened !== to` — ЗАЩИТА ОТ РЕАЛЬНОГО ДЕФЕКТА, а не перестраховка: `restartSync`
  // зовёт `swapVault` с ТЕМ ЖЕ вольтом, что уже открыт (чтобы просто пересобрать
  // цикл reveal/conceal и подхватить новые настройки синка). Безусловный
  // `opened?.lock()` в этом случае забывал бы ключ у `to` — ОН ЖЕ `opened` — и
  // приложение оставалось бы с открытым замком, но мёртвым вольтом сразу после
  // привязки/присоединения/отзыва. Поймано `security/account.test.ts`.
  if (opened !== null && opened !== to) opened.lock();
  vault.value = null;
  await bind.reveal(to);
  vault.value = to;
  refresh();
}

/**
 * Перезапустить синк с ТЕМ ЖЕ ключом — после привязки сервера (`bindAccount`,
 * `security/account.ts`): адрес в `sync/settings.ts` только что сохранён, а
 * запущенный (или ни разу не запускавшийся) движок его ещё не видел.
 *
 * Реализован через `swapVault` с текущим же вольтом: `reveal` перечитывает
 * `sync/settings.ts` заново при каждом вызове (`sync/index.ts`), так что цикл
 * «погасить → поднять» — самый короткий путь подхватить новый адрес, не заводя
 * отдельного канала «просто дёрни `startSync`» мимо уже проверенного пути.
 * Цена — лишний проход перепечатки лендов (`unseal` тем же ключом, без реальной
 * расшифровки заново — данные и так в памяти decode-friendly пачками), заметная
 * только на очень большом пространстве и только один раз при привязке.
 */
export async function restartSync(): Promise<void> {
  const opened = vault.value;
  if (opened === null) return;
  await swapVault(opened);
}

/** Убрать способ доступа. Последний убрать нельзя — данные стали бы недоступны. */
export function removeAccess(label: string): void {
  if (keyed(wraps.value).length < 2) {
    throw new Error('это последний способ доступа: убрать его нельзя');
  }
  dropWrap(need().meta, label);
  refresh();
}

export function freshSalt(): Uint8Array {
  return createSalt();
}

async function forgetDevice(): Promise<void> {
  const device = wraps.value.find(wrap => wrap.kind === 'device');
  if (device === undefined) return;
  dropWrap(need().meta, device.label);
  refresh();
  await dropDeviceKek();
}

function save(wrapped: WrappedDek): void {
  saveWrap(need().meta, wrapped);
  refresh();
}

function refresh(): void {
  wraps.value = listWraps(need().meta);
}

function need(): LockBind {
  if (bound === null) throw new Error('замок не собран: вызовите armLock(…) на старте');
  return bound;
}

/** Ключ подошёл: поднять данные и объявить открытым — именно в таком порядке. */
async function settle(opened: OpenVault): Promise<void> {
  await need().reveal(opened);
  vault.value = opened;
  state.value = 'open';
  // Обёртки перечитываются после подъёма: переезд инбокса и починка мета-ленда
  // могли их тронуть.
  refresh();
}

async function openWithKek(candidates: readonly WrappedDek[], kek: Uint8Array): Promise<void> {
  // Пробуем все обёртки этого вида: какой именно passkey ответил, мы не знаем,
  // а подходит ровно одна — остальные честно не расшифруются.
  for (const wrap of candidates) {
    let opened: OpenVault;
    try {
      opened = await unlockVault(wrap, kek);
    }
    catch {
      // Не та обёртка — пробуем следующую.
      continue;
    }
    await settle(opened);
    return;
  }
  throw new Error('ключ не подошёл ни к одной обёртке');
}
