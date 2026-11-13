import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { resetStorage } from './helpers/storage';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';

// Each test here is an interleaving that once lost or corrupted a note:
// typing while a save is in flight, a rename/delete racing the debounce,
// another tab removing the open note, a save that fails. None of them press
// Ctrl+S — the debounce is the thing under test.

async function freshStart(page: Page) {
  await page.goto(BASE_URL);
  await resetStorage(page);
  await page.reload();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await ready(page);
}

async function ready(page: Page) {
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });
  const editBtn = page.getByRole('button', { name: 'Edit' });
  if (await editBtn.isVisible()) await editBtn.click();
}

async function createNote(page: Page, name: string) {
  await page.locator('.sidebar-action-btn').click();
  await page.locator('.new-file-input').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'New File' })).not.toBeVisible({ timeout: 5_000 });
  await expect(treeItem(page, name)).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5_000 });
}

function treeItem(page: Page, name: string) {
  return page.locator('.tree-item-name', { hasText: new RegExp(`^${name}$`) });
}

async function type(page: Page, text: string, delay = 15) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await editor.pressSequentially(text, { delay });
}

async function saved(page: Page) {
  await expect(page.locator('.toolbar')).not.toContainText('Unsaved', { timeout: 8_000 });
  await expect(page.locator('.toolbar')).not.toContainText('Saving', { timeout: 8_000 });
}

async function editorText(page: Page): Promise<string> {
  return (await page.locator('.cm-content').innerText()).replace(/\n+$/, '');
}

/** Reload without the page being dirty (a beforeunload prompt fails the test). */
async function reloadClean(page: Page) {
  let prompts = 0;
  const onDialog = async (d: import('@playwright/test').Dialog) => { prompts++; await d.accept(); };
  page.on('dialog', onDialog);
  await page.reload();
  await ready(page);
  page.off('dialog', onDialog);
  expect(prompts, 'beforeunload fired — something was still unsaved').toBe(0);
}

async function openSecondTab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(BASE_URL);
  await ready(page);
  return page;
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('text typed while a save is in flight is neither erased from the editor nor lost on disk', async ({ page }) => {
  await freshStart(page);
  await createNote(page, 'inflight');
  await page.locator('.cm-content').click();

  // The save window is a few ms, so the keystroke is injected from inside the
  // page at the exact moment the toolbar flips to "Saving…".
  await page.evaluate(() => {
    const w = window as unknown as { __injected: number; __armed: boolean };
    w.__injected = 0;
    w.__armed = false;
    new MutationObserver(() => {
      const saving = (document.querySelector('.toolbar')?.textContent ?? '').includes('Saving');
      if (saving && w.__armed) {
        w.__armed = false; // once per round — the injected text causes a save of its own
        w.__injected++;
        (document.querySelector('.cm-content') as HTMLElement).focus();
        document.execCommand('insertText', false, `<S${w.__injected}>`);
      }
    }).observe(document.querySelector('.toolbar')!, { subtree: true, childList: true, characterData: true });
  });

  for (let round = 1; round <= 4; round++) {
    await page.evaluate(() => { (window as unknown as { __armed: boolean }).__armed = true; });
    await page.locator('.cm-content').pressSequentially(`r${round} `, { delay: 10 });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __injected: number }).__injected), { timeout: 8_000 })
      .toBe(round);
    // Right after the save completes — this is when the editor used to be
    // reset to the snapshot the save had started with.
    await page.waitForTimeout(150);
    expect(await editorText(page)).toContain(`<S${round}>`);
    await saved(page);
  }
  await saved(page);

  const injected = await page.evaluate(() => (window as unknown as { __injected: number }).__injected);
  const before = await editorText(page);
  for (let i = 1; i <= injected; i++) expect(before, `marker ${i} missing from the editor`).toContain(`<S${i}>`);

  await reloadClean(page);
  await treeItem(page, 'inflight').click();
  await expect(page.locator('.cm-content')).toContainText('<S1>', { timeout: 8_000 });
  expect(await editorText(page)).toBe(before);
});

test('keystrokes that land while the editor is switching notes are not dropped', async ({ page }) => {
  await freshStart(page);
  await createNote(page, 'dest');
  await createNote(page, 'src');
  const typed = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  await page.locator('.cm-content').click();

  await Promise.all([
    page.locator('.cm-content').pressSequentially(typed, { delay: 3 }),
    (async () => {
      await page.waitForTimeout(60);
      // a programmatic click: the mouse does not steal the keystrokes' target
      await page.evaluate(() => {
        const el = [...document.querySelectorAll('.tree-item')].find((e) => e.textContent?.includes('dest'));
        (el as HTMLElement).click();
      });
    })(),
  ]);
  await expect(page.locator('.tab-item.active')).toContainText('dest', { timeout: 5_000 });
  await saved(page);

  const inDest = await editorText(page);
  await treeItem(page, 'src').click();
  await expect(page.locator('.tab-item.active')).toContainText('src');
  const inSrc = await editorText(page);
  // Every character ended up in exactly one of the two notes, in order.
  expect(inSrc + inDest).toBe(typed);
  expect(inSrc.length, 'the switch happened before anything was typed').toBeGreaterThan(0);
});

test('deleting a note right after typing in it does not bring it back', async ({ page }) => {
  await freshStart(page);
  await createNote(page, 'keeper');
  await createNote(page, 'doomed');
  await type(page, 'last words');

  // confirm() is answered late, so the debounce is long overdue when the
  // delete proceeds — it used to fire after the delete and recreate the note.
  page.once('dialog', async (d) => { await new Promise((r) => setTimeout(r, 1_500)); await d.accept(); });
  await treeItem(page, 'doomed').click({ button: 'right' });
  await page.locator('.context-menu-item.danger').click();

  await expect(treeItem(page, 'doomed')).toHaveCount(0, { timeout: 8_000 });
  await page.waitForTimeout(2_500); // past any straggling timer
  await expect(treeItem(page, 'doomed')).toHaveCount(0);
  await expect(page.locator('.tree-item-name')).toHaveCount(1);

  // exactly one trash entry, and it holds what was typed
  const toggle = page.locator('.trash-toggle');
  await expect(toggle).toContainText('(1)', { timeout: 5_000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.locator('.trash-path')).toHaveText(['doomed.md']);
  await page.locator('.trash-restore').click();
  await treeItem(page, 'doomed').click();
  await expect(page.locator('.cm-content')).toContainText('last words', { timeout: 8_000 });
});

test('renaming a note in one tab does not resurrect an empty copy in another tab', async ({ context, page }) => {
  await freshStart(page);
  await createNote(page, 'alpha');
  await type(page, 'alpha body');
  await saved(page);
  await createNote(page, 'other');

  const second = await openSecondTab(context);
  const errors = trackErrors(second);
  await treeItem(second, 'alpha').click();
  await expect(second.locator('.cm-content')).toContainText('alpha body', { timeout: 8_000 });

  await treeItem(page, 'alpha').click({ button: 'right' });
  await page.locator('.context-menu-item', { hasText: 'Rename' }).click();
  await page.locator('.new-file-input').fill('beta');
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(treeItem(page, 'beta')).toBeVisible({ timeout: 5_000 });

  // the other tab: the note it had open is gone, nothing is written back
  await expect(treeItem(second, 'beta')).toBeVisible({ timeout: 8_000 });
  await expect(second.locator('.tab-item', { hasText: 'alpha' })).toHaveCount(0, { timeout: 5_000 });
  await second.waitForTimeout(2_500); // past the debounce that used to save ""
  for (const p of [page, second]) {
    await expect(treeItem(p, 'alpha')).toHaveCount(0);
    await expect(treeItem(p, 'beta')).toHaveCount(1);
  }
  await treeItem(second, 'beta').click();
  await expect(second.locator('.cm-content')).toContainText('alpha body', { timeout: 8_000 });
  expect(errors).toEqual([]);
  await second.close();
});

test('a note trashed in another tab closes here without an error', async ({ context, page }) => {
  await freshStart(page);
  await createNote(page, 'shared');
  await type(page, 'shared body');
  await saved(page);

  const second = await openSecondTab(context);
  const errors = trackErrors(second);
  await treeItem(second, 'shared').click();
  await expect(second.locator('.cm-content')).toContainText('shared body', { timeout: 8_000 });

  page.once('dialog', (d) => d.accept());
  await treeItem(page, 'shared').click({ button: 'right' });
  await page.locator('.context-menu-item.danger').click();

  await expect(second.locator('.tab-item')).toHaveCount(0, { timeout: 8_000 });
  await second.waitForTimeout(2_000);
  await expect(treeItem(second, 'shared')).toHaveCount(0);
  await expect(second.locator('.trash-toggle')).toContainText('(1)');
  expect(errors).toEqual([]);
  await second.close();
});

// Two ways storage fails in the field:
//  'abort' — the write's transaction is aborted (what a full disk does);
//  'dead'  — the connection itself dies; PouchDB calls it a "global failure"
//            and every later call on that handle throws.
for (const mode of ['abort', 'dead'] as const) {
  test(`a save that fails (${mode}) keeps the text and lands by itself once storage works again`, async ({ page }) => {
    await page.addInitScript((mode) => {
      const w = window as unknown as { __failWrites: boolean };
      w.__failWrites = false;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
        if (w.__failWrites && mode === 'dead') throw new DOMException('simulated write failure', 'QuotaExceededError');
        const req = put.apply(this, args);
        if (w.__failWrites) this.transaction.abort();
        return req;
      };
    }, mode);
    await freshStart(page);
    await createNote(page, 'fragile');
    await type(page, 'before the outage ');
    await saved(page);

    await page.evaluate(() => { (window as unknown as { __failWrites: boolean }).__failWrites = true; });
    await type(page, 'typed during the outage');
    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.toolbar')).toContainText('Unsaved');
    await expect(page.locator('.cm-content')).toContainText('typed during the outage');

    // Storage recovers. No further keystroke: the retry has to do it alone.
    await page.evaluate(() => { (window as unknown as { __failWrites: boolean }).__failWrites = false; });
    await expect(page.locator('.toolbar')).not.toContainText('Unsaved', { timeout: 30_000 });
    await expect(page.locator('.toast-error')).toHaveCount(1); // one toast for the whole streak
    // the rest of the app still works on the (possibly replaced) connection
    await createNote(page, 'after');
    await reloadClean(page);
    await treeItem(page, 'fragile').click();
    await expect(page.locator('.cm-content')).toContainText('before the outage typed during the outage', { timeout: 8_000 });
  });
}

test('an edit made elsewhere while typing here is kept as a conflict copy and shown in the panel', async ({ context, page }) => {
  await freshStart(page);
  await createNote(page, 'contested');
  await type(page, 'base ');
  await saved(page);

  const second = await openSecondTab(context);
  await treeItem(second, 'contested').click();
  await expect(second.locator('.cm-content')).toContainText('base', { timeout: 8_000 });

  // Tab 1 starts typing and stays dirty; tab 2 saves its own version meanwhile.
  await type(page, 'mine', 5);
  await type(second, 'theirs', 5);
  await second.keyboard.press('ControlOrMeta+s');
  await saved(second);
  await saved(page);

  for (const p of [page, second]) {
    await expect(p.locator('.conflict-panel')).toBeVisible({ timeout: 8_000 });
    await expect(p.locator('.conflict-count')).toHaveText('1');
  }
  // the copy holds the other tab's text; the note itself holds one of the two, whole
  await page.locator('.conflict-open').first().click();
  const copy = await editorText(page);
  await page.locator('.conflict-open-orig').first().click();
  await expect(page.locator('.tab-item.active')).toContainText('contested');
  const original = await editorText(page);
  expect([copy, original].sort()).toEqual(['base mine', 'base theirs']);
  await second.close();
});

test('"open original" on a conflict copy follows the note through a rename', async ({ context, page }) => {
  await freshStart(page);
  await createNote(page, 'moving');
  await type(page, 'base ');
  await saved(page);
  const second = await openSecondTab(context);
  await treeItem(second, 'moving').click();
  await expect(second.locator('.cm-content')).toContainText('base', { timeout: 8_000 });
  await type(page, 'mine', 5);
  await type(second, 'theirs', 5);
  await second.keyboard.press('ControlOrMeta+s');
  await saved(second);
  await saved(page);
  await second.close();
  await expect(page.locator('.conflict-count')).toHaveText('1', { timeout: 8_000 });

  await treeItem(page, 'moving').click({ button: 'right' });
  await page.locator('.context-menu-item', { hasText: 'Rename' }).click();
  await page.locator('.new-file-input').fill('moved');
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(treeItem(page, 'moved')).toBeVisible({ timeout: 5_000 });

  await page.locator('.conflict-open').first().click();
  await page.locator('.conflict-open-orig').first().click();
  await expect(page.locator('.tab-item.active')).toContainText('moved', { timeout: 5_000 });
  await expect(page.locator('.cm-content')).toContainText('base');
});

async function dbContent(page: Page, id: string): Promise<string | null> {
  return page.evaluate(async (docId) => {
    const PouchDB = (window as unknown as { PouchDB?: unknown }).PouchDB;
    void PouchDB;
    return new Promise<string | null>((resolve) => {
      const open = indexedDB.open('_pouch_lokl');
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const idb = open.result;
        const tx = idb.transaction(['document-store', 'by-sequence'], 'readonly');
        const get = tx.objectStore('document-store').get(docId);
        get.onsuccess = () => {
          const meta = get.result;
          if (!meta) { idb.close(); resolve(null); return; }
          const seq = tx.objectStore('by-sequence').get(meta.seq);
          seq.onsuccess = () => { idb.close(); resolve(seq.result?.content ?? null); };
          seq.onerror = () => { idb.close(); resolve(null); };
        };
        get.onerror = () => { idb.close(); resolve(null); };
      };
    });
  }, id);
}

// Undo history used to be one shared history across notes, and switching notes
// was an ordinary edit in it. Cmd+Z right after opening a note undid the switch:
// the note was blanked (or filled with the previous note's text) and autosaved.
test('undo right after opening or switching notes never touches the note', async ({ page }) => {
  await freshStart(page);
  await createNote(page, 'alpha');
  await type(page, 'ALPHA-TEXT');
  await saved(page);
  await createNote(page, 'beta');
  await type(page, 'BETA-TEXT');
  await saved(page);

  // Fresh load → open alpha → open beta → undo, redo.
  await reloadClean(page);
  await treeItem(page, 'alpha').click();
  await expect(page.locator('.cm-content')).toContainText('ALPHA-TEXT');
  await treeItem(page, 'beta').click();
  await expect(page.locator('.cm-content')).toContainText('BETA-TEXT');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(1500); // past the autosave debounce
  expect(await editorText(page)).toBe('BETA-TEXT');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.keyboard.press('ControlOrMeta+y');
  await page.waitForTimeout(1500);
  expect(await editorText(page)).toBe('BETA-TEXT');
  expect(await dbContent(page, 'beta.md')).toBe('BETA-TEXT');
  expect(await dbContent(page, 'alpha.md')).toBe('ALPHA-TEXT');

  // Undo still works inside one note, and stops at the note's own beginning.
  await type(page, ' more');
  await page.keyboard.press('ControlOrMeta+z');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(1500);
  expect(await editorText(page)).toBe('BETA-TEXT');

  // Back to alpha right after editing beta: alpha's undo must not replay beta's edits.
  await type(page, ' again');
  await treeItem(page, 'alpha').click();
  await expect(page.locator('.cm-content')).toContainText('ALPHA-TEXT');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(1500);
  expect(await editorText(page)).toBe('ALPHA-TEXT');
  expect(await dbContent(page, 'alpha.md')).toBe('ALPHA-TEXT');
  expect(await dbContent(page, 'beta.md')).toBe('BETA-TEXT again');
});

// With no note open the editor used to stay live: typing there had nowhere to be
// saved, and that orphan text then blocked opening any note.
test('there is no editor to type into until a note is open, and notes still open afterwards', async ({ page }) => {
  await freshStart(page);
  await createNote(page, 'only');
  await type(page, 'ONLY-TEXT');
  await saved(page);

  await reloadClean(page);
  await expect(page.locator('.cm-content')).toHaveCount(0);
  await page.keyboard.type('stray keys');
  await treeItem(page, 'only').click();
  await expect(page.locator('.cm-content')).toContainText('ONLY-TEXT', { timeout: 5_000 });

  // Closing the last tab takes the editor (and the closed note's text) away.
  await page.locator('.tab-close').first().click();
  await expect(page.locator('.cm-content')).toHaveCount(0);
  await page.keyboard.type('more stray keys');
  await treeItem(page, 'only').click();
  await expect(page.locator('.cm-content')).toContainText('ONLY-TEXT', { timeout: 5_000 });
  expect(await editorText(page)).toBe('ONLY-TEXT');
  await page.waitForTimeout(1500);
  expect(await dbContent(page, 'only.md')).toBe('ONLY-TEXT');
});
