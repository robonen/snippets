import { expect, test } from 'vitest'
import { identityOf, mintExchangePair, unwrapSecret, wrapSecret } from '../identity'
import { mintSecret, secretKey, SECRET_BYTES } from '../secret'
import { CryptoError } from '../sealed'

const BIND = new TextEncoder().encode('ленд+датель+получатель+метка')

test('two devices independently derive the same mutual key', async () => {
  const a = await mintExchangePair()
  const b = await mintExchangePair()
  const one = await identityOf(a.algo, a.pair)
  const two = await identityOf(b.algo, b.pair)

  const secret = mintSecret()
  const code = await wrapSecret(await one.mutual(two.algo, two.pub), secret, BIND)
  expect(code.length).toBe(SECRET_BYTES) // ровно gift.code
  expect(code).not.toEqual(secret)

  const back = await unwrapSecret(await two.mutual(one.algo, one.pub), code, BIND)
  expect(back).toEqual(secret)
})

test('a third device cannot remove the wrapping', async () => {
  const a = await mintExchangePair()
  const b = await mintExchangePair()
  const c = await mintExchangePair()
  const one = await identityOf(a.algo, a.pair)
  const two = await identityOf(b.algo, b.pair)
  const spy = await identityOf(c.algo, c.pair)

  const secret = mintSecret()
  const code = await wrapSecret(await one.mutual(two.algo, two.pub), secret, BIND)
  const guess = await unwrapSecret(await spy.mutual(one.algo, one.pub), code, BIND)
  expect(guess).not.toEqual(secret)
})

test('a foreign keyring yields a different secret — and it honestly does not open the land', async () => {
  const a = await mintExchangePair()
  const b = await mintExchangePair()
  const one = await identityOf(a.algo, a.pair)
  const two = await identityOf(b.algo, b.pair)
  const mutual = await one.mutual(two.algo, two.pub)

  const secret = mintSecret()
  const code = await wrapSecret(mutual, secret, BIND)
  const wrong = await unwrapSecret(mutual, code, new TextEncoder().encode('другая связка'))
  expect(wrong).not.toEqual(secret)
  // Ключ из неверного секрета импортируется (это просто 16 байт), но юниты им
  // не откроются — ловит метка GCM; см. sealed.test «чужой ключ не открывает».
  await expect(secretKey(wrong)).resolves.toBeDefined()
})

test('a secret of the wrong length is rejected before WebCrypto', async () => {
  const a = await mintExchangePair()
  const b = await mintExchangePair()
  const one = await identityOf(a.algo, a.pair)
  const two = await identityOf(b.algo, b.pair)
  const mutual = await one.mutual(two.algo, two.pub)

  await expect(wrapSecret(mutual, new Uint8Array(32), BIND)).rejects.toThrow(CryptoError)
  expect(() => secretKey(new Uint8Array(32))).toThrow(/16/)
})
