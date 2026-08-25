// Типы ключей WebCrypto без `lib.dom` — тот же приём, что у `store/idb-api.ts`:
// ядро собирается с `lib: ["es2023"]`, где имени `CryptoKey` как ТИПА нет.
// Вместо копии интерфейса типы ВЫВОДЯТСЯ из глобального значения `crypto`,
// которое типизировано в любой целевой среде (@types/node у нас, lib.dom у
// потребителя): у каждого читателя d.ts алиас резолвится в его собственный
// `CryptoKey`, и второго источника правды о форме ключа не появляется.

/** Ключ WebCrypto — то, что возвращает `crypto.subtle.importKey`. */
export type SubtleKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>

type Minted = Awaited<ReturnType<typeof crypto.subtle.generateKey>>

/** Пара ключей WebCrypto — ветвь `generateKey` с приватной половиной. */
export type SubtleKeyPair = Extract<Minted, { privateKey: unknown }>
