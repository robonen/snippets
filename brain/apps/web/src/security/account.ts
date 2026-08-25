import { chunkToWire } from '@brain/sync-wire';
import {
  authenticate,
  createDek,
  decodeBytes,
  deviceKek,
  encodeBytes,
  isKnownPhrase,
  kekFromAssertion,
  kekFromPassphrase,
  normalizePhrase,
  openWith,
  packWrap,
  randomBytes,
  register,
  unlock as unlockVault,
  unpackWrap,
} from '@brain/auth';
import { reseal } from '@brain/module-kit';
import {
  fetchLoginOptions,
  fetchRegisterOptions,
  fetchWraps,
  putWraps,
  saveSyncSettings,
  stopSync,
  submitLogin,
  submitRegister,
} from '../sync';
import { deviceMarks } from '../sync/marks';
import {
  addAccess,
  currentChest,
  currentMeta,
  currentVault,
  freshSalt,
  restartSync,
  rewrapDevice,
  swapVault,
} from './lock';
import { dropWrap, listWraps } from './keys';
import type { Assertion, OpenVault, RegisteredPasskey, Sealed, WrappedDek } from '@brain/auth';
import type { LandId } from '@sync/core';
import type { RemoteWrap, RemoteWrapKind } from '../sync';

/**
 * Привязка, присоединение, отзыв (docs/01-security.md §3/§7, план Р-4/Р-5).
 *
 * Здесь и только здесь встречаются вместе: WebAuthn-церемонии (`@brain/auth`,
 * НЕ переписаны — план Р-4), HTTP-край сервера аккаунта (`sync/account.ts`),
 * подмена ключа (`security/lock.ts`) и перепечатка лендов (`reseal` из
 * `@brain/module-kit`). Экраны (`SyncCard.vue`, `SecurityScreen.vue`) знают
 * только эти функции — не то, из чего они собраны.
 *
 * ─── PRF-секрет никогда не едет на сервер ────────────────────────────────────
 *
 * `clientExtensionResults` в assertion-JSON, который уходит на `/auth/login`,
 * ВСЕГДА пустой объект. PRF-вывод — это материал, из которого выводится KEK;
 * отправить его серверу значило бы отправить ключ шифрования тому самому
 * серверу, от которого он защищает данные. Сервер проверяет ТОЛЬКО подпись, и
 * подпись не зависит от PRF-расширения никак.
 */

// ── DOM-ответы WebAuthn → JSON для сервера ────────────────────────────────

function registrationResponseJson(created: RegisteredPasskey): unknown {
  const response = created.response;
  return {
    id: encodeBytes(created.credentialId),
    rawId: encodeBytes(created.credentialId),
    response: {
      clientDataJSON: encodeBytes(new Uint8Array(response.clientDataJSON)),
      attestationObject: encodeBytes(new Uint8Array(response.attestationObject)),
      transports: response.getTransports?.() ?? [],
    },
    clientExtensionResults: { prf: { enabled: created.prf } },
    type: 'public-key',
  };
}

function authenticationResponseJson(assertion: Assertion): unknown {
  const response = assertion.response;
  const userHandle = response.userHandle;
  const body: Record<string, unknown> = {
    clientDataJSON: encodeBytes(new Uint8Array(response.clientDataJSON)),
    authenticatorData: encodeBytes(new Uint8Array(response.authenticatorData)),
    signature: encodeBytes(new Uint8Array(response.signature)),
  };
  if (userHandle !== null && userHandle.byteLength > 0) {
    body.userHandle = encodeBytes(new Uint8Array(userHandle));
  }
  return {
    id: encodeBytes(assertion.credentialId),
    rawId: encodeBytes(assertion.credentialId),
    response: body,
    clientExtensionResults: {},
    type: 'public-key',
  };
}

// ── Обёртки: локальный формат ⇄ проводной формат сервера ─────────────────────

function toRemote(wrap: WrappedDek): RemoteWrap {
  return { label: wrap.label, kind: wrap.kind as RemoteWrapKind, blob: encodeBytes(packWrap(wrap)) };
}

function fromRemote(remote: RemoteWrap): WrappedDek {
  return unpackWrap({ kind: remote.kind, label: remote.label }, decodeBytes(remote.blob));
}

/**
 * Отправить на сервер ВСЕ локальные обёртки, которые ему можно видеть —
 * passkey и фраза, но не ключ устройства (план Р5, `PUT` замещает целиком).
 */
export async function pushWrapsToServer(url: string): Promise<void> {
  const local = listWraps(currentMeta()).filter(wrap => wrap.kind !== 'device');
  await putWraps(url, local.map(toRemote));
}

// ── Привязка: устройство С ДАННЫМИ становится первым бound-устройством ──────

export interface BindOutcome {
  /**
   * Отдал ли этот passkey PRF. `false` — обёртка для него НЕ создана (нечем
   * вывести KEK): регистрация и сессия при этом всё равно состоялись, а
   * единственный путь ко входу с другого устройства остаётся фразой —
   * вызывающий обязан предупредить об этом (план: «жёлтый флаг PRF-матрицы»).
   */
  readonly prf: boolean;
}

/**
 * Привязка (docs/01-security.md §3, план Р-4): регистрация НОВОГО passkey на
 * сервере (задним числом привязать существующий локальный нельзя — assertion
 * не содержит публичного ключа, план Р-4) + обёртка ТЕКУЩЕГО DEK через PRF —
 * тот же приём, что local-only `addPasskey` в `SecurityScreen.vue`, плюс
 * серверная церемония вокруг него.
 *
 * `token` — `SYNC_TOKEN`, спрошенный ОДИН раз в форме привязки и никуда не
 * сохраняемый (план Р2): здесь он живёт ровно два HTTP-вызова.
 */
export async function bindAccount(url: string, token: string): Promise<BindOutcome> {
  const opts = await fetchRegisterOptions(url, token);
  const created = await register({
    rpId: opts.rpId,
    rpName: opts.rpName,
    userHandle: decodeBytes(opts.userHandle),
    userName: opts.userName,
    challenge: decodeBytes(opts.challenge),
  });

  // Регистрация и сессия — БЕЗ УСЛОВИЙ: create() не требует PRF, чтобы быть
  // валидным credential'ом, а сервер про PRF вообще ничего не знает (план Р3).
  await submitRegister(url, token, registrationResponseJson(created));

  let prf = false;
  if (created.prf) {
    // Второе обращение — за самим выводом PRF, тем же приёмом, что addPasskey:
    // на регистрации многие авторизаторы значение ещё не отдают.
    const salt = freshSalt();
    const assertion = await authenticate({ rpId: opts.rpId, challenge: randomBytes(32) }, salt);
    const kek = await kekFromAssertion(assertion, salt);
    if (kek !== null) {
      // Метка — id credential'а, а не константа «passkey»: обёрток на
      // сервере может стать несколько (второй, третий passkey), и метка —
      // единственное, чем присоединение потом узнаёт СВОЙ credential среди
      // чужих (docs/01-security.md §7 «совпал credential_id»).
      await addAccess(kek, { kind: 'passkey', label: encodeBytes(created.credentialId), salt });
      prf = true;
    }
  }

  await pushWrapsToServer(url);
  saveSyncSettings({ url });
  await restartSync();

  return { prf };
}

// ── Присоединение: login (всегда через passkey) → выбор пути к DEK ──────────

export interface LoginOutcome {
  readonly assertion: Assertion;
  readonly salt: Uint8Array;
  readonly remote: readonly RemoteWrap[];
}

/**
 * Вход на сервер — ВСЕГДА через passkey: `/auth/login` не принимает ничего,
 * кроме assertion-ответа (контракт, docs/04-server.md). Фраза — путь только к
 * DEK, а не ко входу: passkey, которым отвечает `get()`, обязан быть уже
 * известен серверу — то есть либо это устройство уже привязано, либо на него
 * СИНХРОНИЗИРОВАЛСЯ через платформу passkey, зарегистрированный на другом
 * (docs/01-security.md §7, «приехавший через связку платформы»).
 */
export async function joinLogin(url: string): Promise<LoginOutcome> {
  const opts = await fetchLoginOptions(url);
  // Соль — ДО того, как известно, каким credential'ом ответит платформа (тот
  // же приём, что `unlockByPasskey` в lock.ts).
  const salt = freshSalt();
  const assertion = await authenticate({ rpId: opts.rpId, challenge: decodeBytes(opts.challenge) }, salt);
  await submitLogin(url, authenticationResponseJson(assertion));
  const remote = await fetchWraps(url);
  return { assertion, salt, remote };
}

/**
 * Путь (а): совпал credential_id — PRF раскрывает его обёртку.
 *
 * `null` — путь честно не подошёл (нет обёртки под этим credential'ом, или
 * авторизатор не отдал PRF): это НЕ отказ, а сигнал вызывающему предложить
 * фразу. Порча/чужой ключ при СОВПАВШЕЙ обёртке — уже настоящий отказ, и он
 * бросает исключение, а не возвращает null: если обёртка нашлась и PRF дал
 * значение, но расшифровка не удалась, молчать об этом нельзя.
 */
export async function unwrapViaPasskey(login: LoginOutcome): Promise<OpenVault | null> {
  const label = encodeBytes(login.assertion.credentialId);
  const found = login.remote.find(wrap => wrap.kind === 'passkey' && wrap.label === label);
  if (found === undefined) return null;

  const kek = await kekFromAssertion(login.assertion, login.salt);
  if (kek === null) return null;

  return unlockVault(fromRemote(found), kek);
}

/** Путь (б): фраза восстановления раскрывает обёртку фразы. */
export async function unwrapViaPhrase(phrase: string, login: LoginOutcome): Promise<OpenVault> {
  const found = login.remote.find(wrap => wrap.kind === 'passphrase');
  if (found === undefined) throw new Error('на сервере нет обёртки для фразы восстановления');
  if (!isKnownPhrase(phrase)) throw new Error('в этой фразе есть слова не из словаря');

  const wrapped = fromRemote(found);
  const kek = await kekFromPassphrase(normalizePhrase(phrase), wrapped.salt);
  return unlockVault(wrapped, kek);
}

/**
 * Завершить присоединение, когда DEK уже раскрыт одним из путей выше.
 *
 * КРИТИЧЕСКИЙ шаг из docs/01-security.md §7: у устройства уже есть свой
 * локальный DEK.
 * - Локальных данных НЕТ (свежий запуск) — просто подставить аккаунтный DEK:
 *   `swapVault` поднимет пустые ленды, дальше их дольёт синк.
 * - Локальные данные ЕСТЬ — перепечатать их под аккаунтным DEK (`reseal`)
 *   ДО подмены, иначе `swapVault` попробует расшифровать акаунтным ключом то,
 *   что всё ещё лежит под локальным, и бросит на первом же ленде.
 */
export async function completeJoin(url: string, to: OpenVault): Promise<void> {
  const chest = currentChest();
  const existing = await chest.lands();

  if (existing.length > 0) {
    const from = currentVault();
    if (from === null) {
      throw new Error('нет открытого хранилища: присоединение возможно только из разблокированного приложения');
    }
    await reseal({ chest, from, to, lands: existing });
  }

  await swapVault(to);

  if (existing.length > 0) {
    // Старые локальные обёртки (passkey/фраза ЭТОГО устройства, настроенные
    // раньше) указывали на DEK, который `reseal` только что заменил, — молча
    // оставлять их значило бы показывать способ доступа, который на самом
    // деле уже не открывает ничего. Честная сторона — убрать и предложить
    // настроить заново (`addPasskey`/фраза из `SecurityScreen.vue` как есть).
    const meta = currentMeta();
    for (const wrap of listWraps(meta).filter(w => w.kind !== 'device')) {
      dropWrap(meta, wrap.label);
    }
  }

  const key = await deviceKek();
  if (key !== null) await rewrapDevice(key);

  saveSyncSettings({ url });
  await restartSync();
}

// ── Отзыв ─────────────────────────────────────────────────────────────────

/** Прямой HTTP `POST /sync/:land/replace` — см. обоснование в `revokeAccess`. */
async function replaceOnServer(url: string, land: string, ifHead: number, chunk: Sealed): Promise<boolean> {
  const origin = url === '' ? '' : url.replace(/\/+$/, '');
  const res = await fetch(`${origin}/sync/${land}/replace?if=${ifHead}`, {
    method: 'POST',
    credentials: 'same-origin',
    body: chunkToWire(chunk) as BodyInit,
  });
  return res.ok;
}

export interface RevokeRemaining {
  readonly wrap: WrappedDek;
  readonly kek: Uint8Array | CryptoKey;
}

/**
 * Отозвать способ доступа (docs/01-security.md §7, план — раздел «Отзыв»).
 *
 * Удалить обёртку МАЛО: снятая раньше копия продолжила бы подходить. Полный
 * шаг — новый DEK → перепечатать ВСЕ ленды → заменить ВСЕ журналы на сервере →
 * новые обёртки для оставшихся способов.
 *
 * `remaining` — свежие KEK для КАЖДОГО оставшегося способа (не для
 * отзываемого), полученные ПОВТОРНЫМ обращением к человеку: passkey — новый
 * `authenticate()`, фраза — новый ввод. Без этого их нечем перевыпустить —
 * `OpenVault` не хранит KEK, которым его открыли, а сохранённого текста фразы
 * нет нигде по построению (docs/01-security.md §6). Собрать эти KEK — работа
 * вызывающего (`SecurityScreen.vue`) ДО вызова этой функции.
 *
 * REPLACE едет ЯВНЫМ HTTP на каждый ленд, а не через движок синка: движок при
 * отставании (`seen !== head`) молча падает на `APPEND` — а для отзыва это
 * ПРОВАЛ, не деградация: старый шифртекст остался бы в журнале сервера.
 * Поэтому синк на время отзыва выключен, а каждый ленд подтверждается
 * отдельно; несогласие сервера (`ifHead` устарел) — честный отказ с просьбой
 * дождаться сети, а не тихая очередь на потом (план: «не пытайся делать это
 * офлайн-очередью»).
 *
 * Отказ ПОСЕРЕДИНЕ (часть лендов сервер принял, часть — нет) оставляет диск
 * перепечатанным под новым DEK для ВСЕХ лендов (`reseal` прошёл целиком ДО
 * цикла подтверждений), но вольт ещё НЕ переключён — старый ключ остаётся
 * действующим локально. Повторный вызов `revokeAccess` безопасен: он заведёт
 * ЕЩЁ один новый DEK и перепечатает всё заново с нуля, не полагаясь на то, что
 * осталось от прерванной попытки.
 */
export async function revokeAccess(url: string, label: string, remaining: readonly RevokeRemaining[]): Promise<void> {
  const chest = currentChest();
  const from = currentVault();
  if (from === null) {
    throw new Error('нет открытого хранилища: отзыв возможен только из разблокированного приложения');
  }

  const lands = await chest.lands();
  if (lands.length === 0) {
    throw new Error('нет запечатанных лендов — отзывать нечего');
  }

  stopSync();

  const newDek = createDek();
  const to = openWith(newDek);
  // `openWith` берёт копию — свой экземпляр лишний, затираем сразу (как в lock.ts).
  newDek.fill(0);

  await reseal({ chest, from, to, lands });

  const marks = deviceMarks(localStorage);
  const unconfirmed: LandId[] = [];
  for (const land of lands) {
    const chunk = (await chest.read(land))[0];
    if (chunk === undefined) {
      throw new Error(`ленд «${land.str}» пуст после перевыпуска — это внутренняя ошибка, отзыв остановлен`);
    }
    const seen = marks.seen(land.str);

    const ok = await replaceOnServer(url, land.str, seen, chunk);
    if (!ok) unconfirmed.push(land);
    else {
      marks.sentUpTo(land.str, 1);
      marks.sawUpTo(land.str, 1);
    }
  }

  if (unconfirmed.length > 0) {
    throw new Error(
      `сервер не подтвердил замену для: ${unconfirmed.map(l => l.str).join(', ')}. `
      + 'Устройство отстало от сервера — подключитесь к сети, дождитесь синхронизации и повторите отзыв.',
    );
  }

  await swapVault(to);

  const meta = currentMeta();
  for (const wrap of listWraps(meta).filter(w => w.kind !== 'device')) {
    dropWrap(meta, wrap.label);
  }

  const deviceKeyValue = await deviceKek();
  if (deviceKeyValue !== null) await rewrapDevice(deviceKeyValue);

  for (const { wrap, kek } of remaining) {
    await addAccess(kek, { kind: wrap.kind, label: wrap.label, salt: wrap.salt });
  }

  await pushWrapsToServer(url);
  await restartSync();

  // Отзываемая метка нарочно не проверяется здесь отдельно: она просто не
  // попадает ни в `remaining` (её каждый раз собирает вызывающий, исключив
  // именно её), ни в новый список обёрток — `label` в сигнатуре существует
  // для сообщений об ошибках и симметрии с остальными функциями файла.
  void label;
}
