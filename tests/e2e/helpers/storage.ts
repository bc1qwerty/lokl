import type { Page } from '@playwright/test';

/**
 * Wipe every client-side persistence layer lokl touches so each test
 * starts from a known-empty state. Must be called AFTER navigating to
 * the app's origin (about:blank can't access same-origin OPFS).
 *
 * Layers reset:
 *   1. cookies
 *   2. IndexedDB (PouchDB lives here)
 *   3. OPFS (Origin Private File System)
 *   4. localStorage + sessionStorage
 *   5. ServiceWorker registrations (SW caches survive otherwise)
 */
export async function resetStorage(page: Page): Promise<void> {
  await page.context().clearCookies();

  await page.evaluate(async () => {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      await Promise.all(
        dbs.map((db) =>
          db.name
            ? new Promise<void>((resolve) => {
                const req = indexedDB.deleteDatabase(db.name!);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
              })
            : Promise.resolve(),
        ),
      );
    }

    try {
      if (navigator.storage?.getDirectory) {
        const root = await navigator.storage.getDirectory();
        // @ts-expect-error values() is on FileSystemDirectoryHandle but not in DOM lib yet
        for await (const handle of (root as any).values()) {
          try {
            await root.removeEntry(handle.name, { recursive: true });
          } catch {
            // ignore per-entry failures
          }
        }
      }
    } catch {
      // OPFS unavailable — ignore
    }

    localStorage.clear();
    sessionStorage.clear();

    if (navigator.serviceWorker?.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => undefined)));
    }
  });
}
