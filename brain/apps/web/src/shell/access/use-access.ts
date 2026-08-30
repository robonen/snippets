import { computed, onMounted, shallowRef } from 'vue';
import { useValue } from '@sync/vue';
import { useSpaces } from '@brain/module-kit';
import { encodeBytes } from '@brain/auth';
import { errorText } from '@/app/errors';
import { deviceIdentity, identityKeeping } from '@/security/identity';
import { KEYS_ID, isSenior, listDevices } from '@/security/keys-land';
import { readVault } from '@/security/vault';
import { readInvite } from '@/security/invites';
import { myMasterId } from '@/security/space';
import type { ComputedRef, ShallowRef } from 'vue';
import type { KeyKeeping } from '@/security/device-keys';
import type { PairedDevice } from '@/security/keys-land';
import type { SpaceVault } from '@/security/vault';
import type { Invite } from '@/security/invites';
import type { Spaces } from '@brain/module-kit';

/**
 * Общее состояние карточек экрана «Доступ»: кто мы, что в ленде `keys` и в
 * каком положении это устройство. Каждая карточка зовёт композабл сама —
 * подписки на ленд дешёвые, а пропс-простыня между шестью компонентами
 * обошлась бы дороже.
 */

/** Relying party passkey — этот origin. */
export const RP_ID = globalThis.location.hostname;

export interface Access {
  readonly spaces: Spaces;
  /** Наш публичный ECDH-ключ (base64url). Пусто — личность ещё поднимается. */
  readonly myPub: ShallowRef<string>;
  /** Где браузер держит ключи устройства; `null` — ещё не выяснили. */
  readonly keeping: ShallowRef<KeyKeeping | null>;
  /** Ключи устройства не поднялись (IndexedDB отказал) — текст для человека. */
  readonly identityError: ShallowRef<string>;
  readonly devices: ComputedRef<readonly PairedDevice[]>;
  readonly liveDevices: ComputedRef<readonly PairedDevice[]>;
  readonly revokedDevices: ComputedRef<readonly PairedDevice[]>;
  /** Живые, кроме этого устройства, — кандидаты на отзыв. */
  readonly liveOthers: ComputedRef<readonly PairedDevice[]>;
  /**
   * Снимки из ленда (`undefined` — мост ещё не читал, `null` — записи нет).
   * Тип структурный, а не `ShallowRef`: у `@sync/vue` своя копия
   * `@vue/reactivity`, и её Ref номинально не совпадает с местным.
   */
  readonly vault: { readonly value: SpaceVault | null | undefined };
  readonly invite: { readonly value: Invite | null | undefined };
  /** Фразовый вход доехал и обе половины сейфа от одного мастера. */
  readonly vaultReady: ComputedRef<boolean>;
  /** Половины сейфа от разных мастеров — основное устройство перепубликует. */
  readonly vaultStale: ComputedRef<boolean>;
  /** Это устройство — в пространстве (сейф наш, нас нет вовсе — тоже наш). */
  readonly member: ComputedRef<boolean>;
}

export function useAccess(): Access {
  const spaces = useSpaces();

  const myPub = shallowRef('');
  const keeping = shallowRef<KeyKeeping | null>(null);
  const identityError = shallowRef('');
  onMounted(async () => {
    try {
      myPub.value = encodeBytes((await deviceIdentity()).pub);
      keeping.value = identityKeeping();
    }
    catch (caught) {
      // Без catch отказ IndexedDB летел бы необработанным отказом промиса.
      identityError.value = errorText(caught, 'не удалось прочитать ключ устройства');
    }
  });

  // Геттеры обязаны ЧИТАТЬ ленд при каждом запуске: мост (@sync/vue)
  // подписывает эффект только на то, что было прочитано. Задвижка перед
  // чтением («ключ ещё не поднялся — верну []») оставила бы эффект без
  // подписки, и он не проснулся бы уже никогда.
  const roster = useValue(() => spaces.open ? listDevices(spaces.space(KEYS_ID)) : []);
  const vault = useValue(() => spaces.open ? readVault(spaces.space(KEYS_ID)) : null);
  const invite = useValue(() => spaces.open ? readInvite(spaces.space(KEYS_ID)) : null);

  const devices = computed(() => roster.value ?? []);
  const liveDevices = computed(() => devices.value.filter(device => !device.revoked));
  const revokedDevices = computed(() => devices.value.filter(device => device.revoked));
  const liveOthers = computed(() => liveDevices.value.filter(device => device.pub !== myPub.value));

  /** Обе половины сейфа обязаны быть от одного мастера. */
  const vaultStale = computed(() => {
    const seen = vault.value;
    return seen !== null && seen !== undefined
      && seen.phrase !== null && seen.ring !== null
      && seen.wrapMaster !== seen.ringMaster;
  });
  const vaultReady = computed(() => (vault.value?.phrase ?? null) !== null && !vaultStale.value);

  /** Это устройство — в пространстве: сейф запечатан НАШИМ мастером (либо сейфа ещё нет). */
  const member = computed(() => {
    const seen = vault.value;
    if (seen === null || seen === undefined || seen.ringMaster === '') return true;
    try {
      if (seen.ringMaster === myMasterId()) return true;
    }
    catch {
      return true;
    }
    // Блоб младшего устройства не лишает старшее пространства: при следующем
    // подъёме старшее перепубликует сейф (`settleSpace`).
    return myPub.value !== '' && isSenior(spaces.space(KEYS_ID), myPub.value, seen.ringBy);
  });

  return {
    spaces,
    myPub,
    keeping,
    identityError,
    devices,
    liveDevices,
    revokedDevices,
    liveOthers,
    vault,
    invite,
    vaultReady,
    vaultStale,
    member,
  };
}
