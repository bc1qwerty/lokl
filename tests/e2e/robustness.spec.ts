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
  // (the toolbar, not the sidebar: on a phone-sized window the sidebar starts as a closed drawer)
  await expect(page.locator('.toolbar')).toBeVisible({ timeout: 10_000 });
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
  await expect(page.locator('.toast', { hasText: 'No markdown files found' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Start fresh' })).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCount(0);
});

async function openSettings(page: Page) {
  await page.getByTitle('Settings').click();
  await expect(page.locator('.settings-dialog')).toBeVisible({ timeout: 5_000 });
}

test('a link written against a "_" name still opens the note after import renamed it', async ({ page }) => {
  await withVault(page, { '_index.md': 'INDEX BODY', 'a.md': 'see [[_index]] and [[_templates/daily]]', '_templates/daily.md': 'TPL' });
  await page.getByRole('button', { name: 'Import from folder' }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });
  await page.locator('.tree-item-name', { hasText: /^a$/ }).click();
  const links = page.locator('.markdown-preview a.wikilink');
  await expect(links).toHaveCount(2, { timeout: 8_000 });
  // neither is marked broken, and the first one opens the renamed note
  await expect(page.locator('a.wikilink-broken')).toHaveCount(0);
  await links.first().click();
  await expect(page.locator('.tab-item.active')).toHaveAttribute('title', '-index.md', { timeout: 5_000 });
  await expect(page.locator('.cm-content')).toContainText('INDEX BODY');
});

test('importing a folder into a vault never overwrites a note that is already there', async ({ page }) => {
  await withVault(page, { 'n1.md': 'OLD TEXT FROM THE FOLDER', 'extra.md': 'EXTRA', 'same.md': '' });
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });
  await newFile(page, 'same');
  await newFile(page, 'n1');
  await page.locator('.cm-content').click();
  await page.keyboard.insertText('written in the app');
  await expect(page.locator('.toolbar')).toContainText('Saved', { timeout: 10_000 });

  await openSettings(page);
  await page.getByRole('button', { name: 'Import from folder' }).click();
  const toast = page.locator('.toast', { hasText: 'Imported 1 file.' });
  await expect(toast).toBeVisible({ timeout: 10_000 });
  await expect(toast).toContainText('1 already in the vault');
  await expect(toast).toContainText('kept as conflict copies: n1.md');
  await page.keyboard.press('Escape');

  // the note written here is intact; the folder's text sits beside it as a conflict copy
  await expect(page.locator('.cm-content')).toContainText('written in the app');
  await expect(page.locator('.conflict-count')).toHaveText('1', { timeout: 8_000 });
  await expect(page.locator('.tree-item-name', { hasText: 'extra' })).toBeVisible({ timeout: 8_000 });
  const ids = await noteIds(page);
  expect(ids.filter((id) => !id.includes('(conflict-'))).toEqual(['extra.md', 'n1.md', 'same.md']);
  expect(ids.filter((id) => id.startsWith('n1 (conflict-'))).toHaveLength(1);
});

test('an import cut short by a reload is reported on the next start and can be finished from Settings', async ({ page }) => {
  test.setTimeout(180_000);
  const TOTAL = 1500;
  const files: Record<string, string> = {};
  for (let i = 0; i < TOTAL; i++) files[`n${String(i).padStart(4, '0')}.md`] = `body ${i}`;
  await withVault(page, files);
  await page.getByRole('button', { name: 'Import from folder' }).click();
  // somewhere in the middle (100–999 of 1500)
  await expect(page.locator('.welcome')).toContainText(/Importing \d{3} \/ 1500/, { timeout: 60_000 });

  // leaving now asks first…
  let asked = 0;
  page.on('dialog', async (d) => { if (d.type() === 'beforeunload') asked++; await d.accept(); });
  await page.reload();
  expect(asked, 'no beforeunload prompt while the import was writing').toBe(1);

  // …and the partial vault says what happened instead of opening as if complete
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.toast', { hasText: 'import was interrupted' })).toBeVisible({ timeout: 5_000 });
  const before = (await noteIds(page)).length;
  expect(before).toBeGreaterThan(50);
  expect(before).toBeLessThan(TOTAL);

  await openSettings(page);
  await page.getByRole('button', { name: 'Import from folder' }).click();
  await expect(page.locator('.toast', { hasText: 'already in the vault' })).toBeVisible({ timeout: 120_000 });
  expect(await noteIds(page)).toHaveLength(TOTAL);

  // finished: no notice on the next start
  await page.reload();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await expect(page.locator('.toast', { hasText: 'import was interrupted' })).toHaveCount(0);
});

test('"Delete forever" on a trash row names the note and asks first', async ({ page }) => {
  await freshStart(page);
  await newFile(page, 'keepme');
  await newFile(page, 'goner');
  page.once('dialog', (d) => d.accept());   // "Delete goner?"
  await page.locator('.tree-item-name', { hasText: 'goner' }).click({ button: 'right' });
  await page.locator('.context-menu-item.danger').click();
  const toggle = page.locator('.trash-toggle');
  await expect(toggle).toContainText('(1)', { timeout: 5_000 });
  await toggle.click();

  // declined: nothing happens
  let message = '';
  page.once('dialog', (d) => { message = d.message(); return d.dismiss(); });
  await page.locator('.trash-purge').click();
  expect(message).toContain('goner.md');
  await expect(toggle).toContainText('(1)');

  page.once('dialog', (d) => d.accept());
  await page.locator('.trash-purge').click();
  await expect(toggle).toContainText('(0)', { timeout: 5_000 });
  expect(await noteIds(page)).toEqual(['keepme.md']);
});


// A dialog taller than the window used to be cut off at the bottom with no way to scroll:
// on a 720px-high laptop the last Settings buttons — "Import from folder", the one way to
// finish an interrupted import — could not be reached with a mouse.
for (const size of [{ width: 1280, height: 720 }, { width: 1280, height: 600 }, { width: 390, height: 600 }]) {
  test(`every Settings control can be reached at ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await freshStart(page);
    await openSettings(page);
    const dialog = page.locator('.settings-dialog');

    const box = (await dialog.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);

    const controls = dialog.locator('button, select, input');
    const n = await controls.count();
    expect(n).toBeGreaterThan(5);
    for (let i = 0; i < n; i++) {
      const el = controls.nth(i);
      if (!(await el.isVisible())) continue;
      await el.scrollIntoViewIfNeeded();
      // really on screen and on top — not merely "in the DOM"
      const hit = await el.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.top >= 0 && r.bottom <= window.innerHeight && !!top && (top === node || node.contains(top) || top.contains(node));
      });
      expect(hit, `control #${i} (${(await el.textContent())?.trim() || (await el.getAttribute('type'))})`).toBe(true);
    }
  });
}
