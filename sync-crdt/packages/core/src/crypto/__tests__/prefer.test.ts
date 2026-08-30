import { expect, test } from 'vitest'
import { identityOf, mintExchangePair } from '../identity'
import { mintSignerPair, signerOf } from '../signer'

// Приложение может попросить P-256 явно: платформа, умеющая X25519/Ed25519,
// не обязательно умеет их сохранить (WebKit теряет такие ключи в IndexedDB).

test('mintExchangePair honours an explicit P-256 preference', async () => {
  const minted = await mintExchangePair('p256')
  expect(minted.algo).toBe('p256')
  const identity = await identityOf(minted.algo, minted.pair)
  expect(identity.algo).toBe('p256')
})

test('mintSignerPair honours an explicit P-256 preference', async () => {
  const minted = await mintSignerPair('p256')
  expect(minted.algo).toBe('p256')
  const signer = await signerOf(minted.algo, minted.pair)
  expect(signer.algo).toBe('p256')
})
