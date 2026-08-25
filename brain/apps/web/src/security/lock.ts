import { computed, readonly, shallowRef } from 'vue';
import {
  authenticate,
  createKeyring,
  createSalt,
  deviceKek,
  dropDeviceKek,
  isKnownPhrase,
  kekFromAssertion,
  kekFromPassphrase,
  normalizePhrase,
  randomBytes,
  unlockKeyring,
} from '@brain/auth';
import type { Keyring, WrappedDek } from '@brain/auth';
import type { ComputedRef, ShallowRef } from 'vue';
import { dropWrap, listWraps, saveWrap } from './keys';
import { legacyPresent, migrateLegacy, readLegacyWraps } from './migrate-legacy';

/**
 * Замок приложения (docs/01-security.md §5).
 *
 * Пока заперт — связка ключей забыта, а открытые ленды закрыты и выброшены из
 * памяти вкладки (`conceal` снимает их целиком, а не прячет за `v-if`).
 * «Заперто» означает «данных в этой вкладке нет», а не «не показываем».
 *
 * От чего замок по-прежнему НЕ защищает: от кода, исполняемого в этом origin,
 * пока приложение открыто. В вебе против этого средств нет.
 *
 * Обёртки мастера связки — в localStorage устройства (`security/keys.ts`):
 * прежний открытый мета-ленд, существовавший ради них, упразднён вместе с
 * конвертом DEK/KEK (payload юнитов теперь запечатывает ядро). Старые установки
 * проходят одноразовый переезд (`migrate-legacy.ts`) ТЕМ ЖЕ жестом, которым
 * открывали приложение раньше, — отдельного «мастера миграции» нет.
 */

export type LockState = 'locked' | 'open';

/** Метка обёртки под ключом устройства. Она одна на устройство. */
const DEVICE_LABEL = 'это устройство';

/**
 * Чем замок связан с данными. Инъекция, а не импорт: замок отвечает за ключи,
 * а как поднимаются ленды — дело сборки (`app/boot.ts`).
 */
export interface LockBind {
  /** Связка получена: поднять ленды и синк. */
  readonly reveal: (ring: Keyring) => Promise<void>;
  /** Убрать открытое: дописать несохранённое и закрыть ленды. */
  readonly conceal: () => Promise<void>;
}

const state = shallowRef<LockState>('locked');
const ring = shallowRef<Keyring | null>(null);
const wraps = shallowRef<readonly WrappedDek[]>([]);
/** Обёртки прежней схемы: не пустые — экран замка открывает ПЕРЕЕЗД, а не связку. */
let legacyWraps: readonly WrappedDek[] = [];
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
 * ключом устройства. Порядок перевёрнут: пока связки нет, поднимать нечего.
 */
export async function armLock(bind: LockBind): Promise<void> {
  bound = bind;
  refresh();

  if (wraps.value.length === 0 && await legacyPresent()) {
    // Старая установка: обёртки прежнего DEK лежат в старом мета-ленде.
    // Способы доступа человека сохраняются как есть — переезд произойдёт под
    // тем же жестом (unlockBy… ниже увидят legacyWraps).
    legacyWraps = await readLegacyWraps();
  }

  if (keyed(wraps.value).length > 0 || keyed(legacyWraps).length > 0) {
    state.value = 'locked';
    return;
  }
  await openByDevice();
}

/**
 * Первый запуск и всё время до настройки passkey: связка заводится СРАЗУ и
 * мастер заворачивается в неизвлекаемый ключ устройства. «Ключа ещё нет,
 * значит пишем открыто» — дыра ровно там, где её труднее всего заметить.
 */
async function openByDevice(): Promise<void> {
  const kek = await deviceKek();
  if (kek === null) {
    throw new Error(
      'браузер не дал сохранить ключ устройства: без него данные пришлось бы писать открытым '
      + 'текстом, и приложение этого делать не станет',
    );
  }

  // Старая установка без passkey/фразы: переезд под ключом устройства.
  const legacyDevice = legacyWraps.find(wrap => wrap.kind === 'device');
  if (legacyDevice !== undefined) {
    const moved = await migrateLegacy({ wrap: legacyDevice, kek });
    legacyWraps = [];
    save(await moved.wrapFor(kek, { kind: 'device', label: DEVICE_LABEL, salt: EMPTY_SALT }));
    await settle(moved);
    return;
  }

  const found = wraps.value.find(wrap => wrap.kind === 'device');
  if (found !== undefined) {
    await settle(await unlockKeyring(found, kek, localStorage));
    return;
  }

  const fresh = await createKeyring(localStorage);
  save(await fresh.wrapFor(kek, { kind: 'device', label: DEVICE_LABEL, salt: EMPTY_SALT }));
  await settle(fresh);
}

/**
 * Соли у ключа устройства нет: KDF не участвует, KEK берётся у платформы
 * целиком. Пустые байты честнее случайных.
 */
const EMPTY_SALT = new Uint8Array(0);

/**
 * Пора ли запирать после отлучки. Считает НАСТЕННЫЕ часы, а не время таймера:
 * во сне машины таймеры не идут, а разница отметок — идёт.
 */
export function lockedByAway(hiddenAt: number, now: number, idleMs: number): boolean {
  return hiddenAt !== 0 && now - hiddenAt > idleMs;
}

export function lock(): void {
  if (state.value !== 'open') return;
  // Запирать нечем — значит и незачем: человек остался бы перед дверью без ключа.
  if (keyed(wraps.value).length === 0) return;
  // Экран запирается СИНХРОННО: между командой и исчезновением данных не должно
  // быть кадра, в котором они ещё нарисованы. Уборка идёт следом, связка
  // забывается ПОСЛЕ неё — последняя пачка ещё запечатывается её ключами.
  state.value = 'locked';
  const opened = ring.value;
  ring.value = null;
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
  const candidates = keyed(legacyWraps.length > 0 ? legacyWraps : wraps.value)
    .filter(wrap => wrap.kind === 'passkey');
  if (candidates.length === 0) throw new Error('passkey is not set up');

  // Соль общая для всех passkey-обёрток: PRF заказывается ДО того, как станет
  // известно, каким именно ключом человек ответил.
  const salt = (candidates[0] as WrappedDek).salt;
  const assertion = await authenticate({ rpId, challenge: randomBytes(32) }, salt);
  const kek = await kekFromAssertion(assertion, salt);
  if (kek === null) {
    throw new Error('this key does not support PRF — unlock with the recovery phrase');
  }

  await openWithKek(candidates, kek);
}

export async function unlockByPhrase(phrase: string): Promise<void> {
  const candidates = keyed(legacyWraps.length > 0 ? legacyWraps : wraps.value)
    .filter(wrap => wrap.kind === 'passphrase');
  const wrap = candidates[0];
  if (wrap === undefined) throw new Error('recovery phrase is not set up');
  if (!isKnownPhrase(phrase)) throw new Error('this phrase contains words outside the wordlist');

  const kek = await kekFromPassphrase(normalizePhrase(phrase), wrap.salt);
  await openWithKek(candidates, kek);
}

/**
 * Записать новую обёртку ТОГО ЖЕ мастера: второй passkey, фраза. Новый мастер
 * открыл бы пустоту вместо связки, завёрнутой прежним.
 */
export async function addAccess(
  kek: Uint8Array | CryptoKey,
  meta: { kind: WrappedDek['kind']; label: string; salt: Uint8Array },
): Promise<void> {
  const opened = ring.value;
  if (opened === null) throw new Error('keyring is locked: unlock the data first');

  save(await opened.wrapFor(kek, meta));

  // Ключ устройства открывал данные БЕЗ спроса — ровно то, от чего защищает
  // замок (У1). Как только появился способ, который спрашивает человека,
  // тихий путь обязан исчезнуть, иначе замок остаётся декорацией.
  if (meta.kind !== 'device') await forgetDevice();
}

/** Связка — модулям безопасности (пейринг заворачивает её секреты для других устройств). */
export function currentKeyring(): Keyring | null {
  return ring.value;
}

/** Убрать способ доступа. Последний убрать нельзя — данные стали бы недоступны. */
export function removeAccess(label: string): void {
  if (keyed(wraps.value).length < 2) {
    throw new Error('this is the last access method: it cannot be removed');
  }
  dropWrap(label);
  refresh();
}

export function freshSalt(): Uint8Array {
  return createSalt();
}

async function forgetDevice(): Promise<void> {
  const device = wraps.value.find(wrap => wrap.kind === 'device');
  if (device === undefined) return;
  dropWrap(device.label);
  refresh();
  await dropDeviceKek();
}

function save(wrapped: WrappedDek): void {
  saveWrap(wrapped);
  refresh();
}

function refresh(): void {
  wraps.value = listWraps();
}

/** Ключ подошёл: поднять данные и объявить открытым — именно в таком порядке. */
async function settle(opened: Keyring): Promise<void> {
  if (bound === null) throw new Error('lock is not armed: call armLock(…) at startup');
  await bound.reveal(opened);
  ring.value = opened;
  state.value = 'open';
  refresh();
}

async function openWithKek(candidates: readonly WrappedDek[], kek: Uint8Array): Promise<void> {
  // Пробуем все обёртки этого вида: какой именно passkey ответил, мы не знаем,
  // а подходит ровно одна — остальные честно не расшифруются.
  for (const wrap of candidates) {
    let opened: Keyring;
    try {
      if (legacyWraps.length > 0) {
        // Старая установка: тем же KEK открывается прежний DEK, данные
        // переезжают, и мастер новой связки заворачивается под этот же способ —
        // человек продолжает открывать приложение как открывал.
        opened = await migrateLegacy({ wrap, kek });
        legacyWraps = [];
        save(await opened.wrapFor(kek, { kind: wrap.kind, label: wrap.label, salt: wrap.salt }));
      }
      else {
        opened = await unlockKeyring(wrap, kek, localStorage);
      }
    }
    catch {
      // Не та обёртка — пробуем следующую.
      continue;
    }
    await settle(opened);
    return;
  }
  throw new Error('key did not match any wrap');
}
