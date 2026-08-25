import { open, seal, unwrapDek, wrapDek } from './crypto';
import type { Sealed, WrappedDek } from './crypto';

/**
 * Открытое хранилище.
 *
 * DEK живёт ТОЛЬКО в этом объекте и только в памяти. Ни localStorage, ни
 * IndexedDB его в открытом виде не видят — иначе замок был бы декорацией:
 * заперто на экране, а ключ лежит рядом (docs/01-security.md §5).
 *
 * Запертое состояние здесь НЕ моделируется: «нет хранилища» — это отсутствие
 * объекта, а не объект с полем `state`. Оболочка держит `OpenVault | null`, и
 * тип сам не даёт шифровать до открытия — проверка не забывается.
 */
export interface OpenVault {
  /** Зашифровать пачку ленда перед отправкой. */
  sealPack(land: string, pack: Uint8Array): Promise<Sealed>;
  /** Расшифровать пачку, пришедшую с сервера. */
  openPack(land: string, sealed: Sealed): Promise<Uint8Array>;
  /**
   * Завернуть ТОТ ЖЕ DEK для нового способа доступа — второй passkey, фраза,
   * ключ устройства.
   *
   * Единственный законный способ добавить доступ: новый DEK открыл бы пустоту
   * вместо данных, зашифрованных прежним, а отдать ключ наружу ради этого
   * означало бы вынести его из объекта, в котором он и живёт.
   */
  wrapFor(
    kek: Uint8Array | CryptoKey,
    meta: { kind: WrappedDek['kind']; label: string; salt: Uint8Array },
  ): Promise<WrappedDek>;
  /** Забыть ключ. После этого объект бесполезен — возьмите новый из `unlock`. */
  lock(): void;
}

/**
 * Открыть хранилище, сняв обёртку своим KEK.
 *
 * Бросает, если KEK не тот: GCM ловит это на проверке целостности, и «открылось
 * во что-то похожее» здесь невозможно.
 */
export async function unlock(wrapped: WrappedDek, kek: Uint8Array | CryptoKey): Promise<OpenVault> {
  const dek = await unwrapDek(wrapped, kek);
  return vaultOf(dek);
}

/** Открыть с только что созданным DEK — первая настройка. */
export function openWith(dek: Uint8Array): OpenVault {
  return vaultOf(dek.slice());
}

function vaultOf(dek: Uint8Array): OpenVault {
  let key: Uint8Array | null = dek;

  const need = (): Uint8Array => {
    if (key === null) throw new Error('хранилище заперто: ключ забыт, откройте заново');
    return key;
  };

  return {
    // Адрес ленда идёт в AAD: шифртекст одного ленда не подставить вместо
    // другого — GCM это заметит.
    sealPack: async (land, pack) => seal(need(), pack, label(land)),
    openPack: async (land, sealed) => open(need(), sealed, label(land)),
    // `async` здесь несущее: `need()` бросает синхронно, а подпись обещает
    // промис — без него отказ запертого хранилища вылетал бы мимо `.catch`.
    wrapFor: async (kek, meta) => wrapDek(need(), kek, meta),
    lock() {
      if (key !== null) {
        // Затираем байты, а не только ссылку: до сборки мусора буфер живёт, и
        // дамп памяти в этом промежутке отдал бы ключ целиком.
        key.fill(0);
        key = null;
      }
    },
  };
}

const encoder = new TextEncoder();

function label(land: string): Uint8Array {
  return encoder.encode(`brain/land/${land}`);
}
