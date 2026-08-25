import { idbStore } from '@sync/core';
import { SYSTEM_ID, createRegistry, idbChest, landId, openSpaces, sealExisting, tappedChest } from '@brain/module-kit';
import type { Registry, Spaces } from '@brain/module-kit';
import { loadModules } from '@/app/modules';
import { MetaModel } from '@/db/meta';
import { INBOX_ID } from '@/db/inbox';
import { moveInbox } from '@/db/migrate';
import { armLock } from '@/security/lock';
import { startSync, stopSync, syncTap } from '@/sync';

/**
 * Порядок запуска.
 *
 * До шифрования он был простым: поднять все ленды, потом решить про замок.
 * Теперь он перевёрнут, и иначе быть не может — зашифрованный ленд нечем
 * открыть, пока ключа нет:
 *
 *   1. мета-ленд (он лежит открытым: в нём обёртки ключа);
 *   2. состояние замка по обёрткам;
 *   3. заперто — отдать управление оболочке, она покажет экран замка;
 *      не настроено — открыть ключом устройства прямо здесь;
 *   4. ключ получен → переезд открытых лендов в запечатанные → подъём.
 *
 * Что видит человек в шаге 3: мета-ленд крошечный, поэтому экран замка
 * появляется практически мгновенно — раньше, чем появился бы список заметок.
 * Ожидание переехало под кнопку «Открыть»: расшифровка идёт, пока она в
 * состоянии загрузки, и содержимое рисуется уже готовым, а не пустым.
 */
export async function bootBrain(): Promise<{ spaces: Spaces; registry: Registry }> {
  const modules = await loadModules();
  const registry = createRegistry(modules);

  // Две базы, и это разделение несёт смысл: `brain` — то, что лежит открытым
  // (только мета-ленд), `brain-sealed` — шифртекст. По месту и опознаётся, что
  // ещё не переехало (см. `sealExisting`).
  const plain = idbStore({ name: 'brain' });
  // Сундук под краном: синхронизация возит ровно те куски, что легли на диск, и
  // узнаёт о них здесь — не заглядывая ни в ключ, ни в открытую пачку
  // (docs/04-server.md §4).
  const chest = tappedChest(idbChest(), syncTap);

  const spaces = await openSpaces({
    modules,
    system: { root: MetaModel.name },
    shell: [{ id: INBOX_ID }],
    store: plain,
    chest,
  });

  await armLock({
    meta: spaces.system(),
    // Присоединению и отзыву (`security/account.ts`) нужен ТОТ ЖЕ сундук, что
    // здесь: перепечатать журнал (`reseal`) и затем поднять его (`unseal`)
    // обязаны читать/писать одно и то же хранилище, не два разных инстанса
    // над одной IndexedDB со своими рассинхронными кэшами номеров кусков.
    chest,
    reveal: async (vault) => {
      // Переезд ДО подъёма: ленд, оставшийся открытым, иначе поднялся бы из
      // сундука пустым, и приложение записало бы новое поверх старого.
      await sealExisting({ plain, chest, vault, keep: [landId(SYSTEM_ID)] });
      await spaces.unseal(vault);
      moveInbox(spaces.system(), spaces.space(INBOX_ID));
      // Синк — последним: он вливает принятое в ЖИВЫЕ ленды, а до `unseal` их
      // нет. Мета-ленда в списке нет намеренно (обёртки ключа не ездят).
      startSync({
        spaces,
        chest,
        vault,
        lands: [INBOX_ID, ...modules.map(module => module.id)].map(id => landId(id)),
      });
    },
    conceal: async () => {
      // Сначала снять синк, потом закрыть ленды: пришедший кусок иначе успел бы
      // влиться в ленд, который уже закрывают.
      stopSync();
      await spaces.seal();
    },
  });

  return { spaces, registry };
}
