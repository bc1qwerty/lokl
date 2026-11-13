import { test, expect, type Page } from '@playwright/test';
import { resetStorage } from './helpers/storage';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';

// Paths around the editor that used to fail without a word: a note name the
// database refuses, the editor bundle not arriving, a trash row gone stale.

async function freshStart(page: Page) {
  await page.goto(BASE_URL);
  await resetStorage(page);
  await page.reload();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });
}

async function newFile(page: Page, name: string) {
  await page.locator('.sidebar-action-btn').click();
  await page.locator('.new-file-input').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'New File' })).not.toBeVisible({ timeout: 5_000 });
}

/** ids of every live document, straight from IndexedDB (PouchDB idb adapter). */
async function noteIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('_pouch_lokl');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rows: any[] = await new Promise((res, rej) => {
      const r = db.transaction('document-store').objectStore('document-store').getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return rows.filter((d) => !d.deleted && d.deletedOrLocal !== '1').map((d) => d.id).sort();
  });
}

test('New File turns awkward names into clean ids and never loses the note', async ({ page }) => {
  await freshStart(page);
  await newFile(page, '/lead');
  await newFile(page, 'trail/');
  await newFile(page, 'x/../y');
  await newFile(page, '_under');
  await expect(page.locator('.toast', { hasText: `created as "-under.md"` })).toBeVisible();
  await expect.poll(() => noteIds(page)).toEqual(['-under.md', 'lead.md', 'trail.md', 'y.md']);

  // a name with nothing usable in it is refused with a message, not created as "/.md"
  await page.locator('.sidebar-action-btn').click();
  await page.locator('.new-file-input').fill('..');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.toast', { hasText: 'not a usable note name' })).toBeVisible();
  expect(await noteIds(page)).toHaveLength(4);
});

test('when the editor bundle cannot be fetched the app stays alive and says so', async ({ page }) => {
  await freshStart(page);
  let blocked = true;
  await page.route(/\/assets\/Editor-[^/]+\.js/, (route) => (blocked ? route.abort() : route.continue()));
  await newFile(page, 'first');

  const failed = page.locator('.editor-load-failed');
  await expect(failed).toBeVisible({ timeout: 10_000 });
  await expect(failed).toContainText('could not be loaded');
  // the rest of the app still answers — it used to be a blank, dead screen
  await page.locator('.sidebar-action-btn').click();
  await expect(page.getByRole('heading', { name: 'New File' })).toBeVisible();
  await page.keyboard.press('Escape');

  // connection back: Retry (or, where the browser will not re-fetch a failed module, Reload) brings the editor
  blocked = false;
  await failed.getByRole('button', { name: 'Retry' }).click();
  const editor = page.locator('.cm-content');
  if (!(await editor.waitFor({ state: 'visible', timeout: 6_000 }).then(() => true, () => false))) {
    await expect(failed).toBeVisible();
    await failed.getByRole('button', { name: 'Reload' }).click();
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });
    await page.locator('.tree-item-name', { hasText: 'first' }).click();
  }
  await expect(editor).toBeVisible({ timeout: 10_000 });
});

test('a note that arrives through another tab is searchable without a reload', async ({ context, page }) => {
  await freshStart(page);
  await newFile(page, 'here');
  const other = await context.newPage();
  await other.goto(BASE_URL);
  await expect(other.locator('.sidebar')).toBeVisible({ timeout: 10_000 });
  await newFile(other, 'elsewhere');
  await other.locator('.cm-content').click();
  await other.keyboard.insertText('xylophone marmalade');
  await expect(other.locator('body')).toContainText('Saved', { timeout: 10_000 });

  await expect(page.locator('.tree-item-name', { hasText: 'elsewhere' })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Control+k');
  await page.locator('.search-input').fill('xylophone');
  await expect(page.locator('.search-results').getByText('elsewhere').first()).toBeVisible({ timeout: 5_000 });
});

// Chromium's OPFS hands out real FileSystemDirectoryHandles, so the folder picker can be pointed at one.
async function withVault(page: Page, files: Record<string, string>) {
  await page.addInitScript(() => {
    (window as any).showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('vault');
  });
  await page.goto(BASE_URL);
  await resetStorage(page);
  await page.evaluate(async (entries) => {
    const root = await navigator.storage.getDirectory();
    const vault = await root.getDirectoryHandle('vault', { create: true });
    for (const [path, text] of Object.entries(entries)) {
      const parts = path.split('/');
      let dir = vault;
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
      const w = await (await dir.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
      await w.write(text);
      await w.close();
    }
  }, files);
  await page.reload();
}

test('folder import brings in "_"-named files under a visible replacement and says what it did', async ({ page }) => {
  await withVault(page, { '_index.md': 'INDEX', '_templates/daily.md': 'TPL', 'a.md': 'A', 'sub/b.md': 'B', 'zzz.md': 'Z' });
  await page.getByRole('button', { name: 'Import from folder' }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });
  // every file is in — the import used to stop at the first "_" name and open a partial vault without a word
  await expect.poll(() => noteIds(page)).toEqual(['-index.md', '-templates/daily.md', 'a.md', 'sub/b.md', 'zzz.md']);
  const toast = page.locator('.toast', { hasText: 'Imported 5 files' });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('_index.md → -index.md');
});

test('a folder with nothing to import says so and stays on the welcome screen', async ({ page }) => {
  await withVault(page, { 'readme.txt': 'not markdown' });
  await page.getByRole('button', { name: 'Import from folder' }).click();
  await expect(page.locator('.toast', { hasText: 'No .md files found' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Start fresh' })).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCount(0);
});
