// v8:hot — эти пять функций стоят на горячем пути всех кодеков формата
// (`unit.ts`, `pack.ts`) и слоя ленда, поэтому они мономорфны по `Uint8Array` и
// не проверяют границы: границы проверены на входе в кодек, а повторная проверка
// на каждом байте стоила бы дороже самой работы.
//
// ПОЧЕМУ отдельный модуль. До сих пор эти функции жили копией в `unit.ts` и
// копией в `pack.ts`, и в шапке `pack.ts` стояло обещание: «абстракция вводится
// по факту третьего повторения — появится третий кодек, выделим». Ленд на байтах
// (S4) и есть третий читатель тех же офсетов; выделяем.
//
// ПОЧЕМУ не `DataView`: замер в шапке `unit.ts` — вид на юнит стоит 58.6 нс и
// +48 Б, ручное чтение big-endian окупает его только с двадцатого чтения одного
// юнита, а платился бы он на каждом разобранном.

/** Секции пакета выровнены на 8 байт — на этом держится арена хранилища (docs/03 §3). */
export function align8(size: number): number {
  return (size + 7) & ~7
}

export function readU16(bin: Uint8Array, at: number): number {
  return ((bin[at] as number) << 8) | (bin[at + 1] as number)
}

export function readU32(bin: Uint8Array, at: number): number {
  return (
    ((bin[at] as number) << 24
    | (bin[at + 1] as number) << 16
    | (bin[at + 2] as number) << 8
    | (bin[at + 3] as number)) >>> 0
  )
}

export function writeU16(bin: Uint8Array, at: number, value: number): void {
  bin[at] = (value >>> 8) & 0xff
  bin[at + 1] = value & 0xff
}

export function writeU32(bin: Uint8Array, at: number, value: number): void {
  bin[at] = (value >>> 24) & 0xff
  bin[at + 1] = (value >>> 16) & 0xff
  bin[at + 2] = (value >>> 8) & 0xff
  bin[at + 3] = value & 0xff
}
