import { createRegistry, openSpaces } from '@brain/module-kit';
import type { Registry, Spaces } from '@brain/module-kit';
import { loadModules } from '@/app/modules';
import { INBOX_ID } from '@/db/inbox';
import { armLock } from '@/security/lock';
import { KEYS_ID } from '@/security/keys-land';
import { deviceSigner } from '@/security/signing';
import { assembleSpace, concealSpace, healPhraseEntry, revealSpace } from '@/security/space';

/**
 * Порядок запуска.
 *
 *   1. модули и подписант — его `peer` (хэш ключа подписи) становится адресом
 *      устройства в лендах, иначе печати не докажут авторство сандов;
 *   2. ленды собираются закрытыми, оркестровке отдаётся сборка;
 *   3. состояние замка по обёрткам из localStorage (ленды НЕ нужны):
 *      заперто — оболочка показывает экран замка, иначе связка открывается
 *      ключом устройства, и `reveal` поднимает ленды и синк.
 *
 * Всё, что сложнее (кто в пространстве, сейф, приглашения, отзыв), — в
 * `security/space.ts`: boot только соединяет замок с оркестровкой.
 */
export async function bootBrain(): Promise<{ spaces: Spaces; registry: Registry }> {
  const modules = await loadModules();
  const registry = createRegistry(modules);

  const signer = await deviceSigner();
  const spaces = openSpaces({
    modules,
    shell: [{ id: INBOX_ID }, { id: KEYS_ID }],
    peer: signer.peer,
  });

  assembleSpace({
    spaces,
    signer,
    dataLands: [INBOX_ID, ...modules.map(module => module.id)],
  });

  await armLock({
    reveal: revealSpace,
    conceal: concealSpace,
    phraseUnlocked: healPhraseEntry,
  });

  return { spaces, registry };
}
