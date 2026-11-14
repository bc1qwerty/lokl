import { test, expect, type Page } from '@playwright/test';
import { resetStorage } from './helpers/storage';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';

// These tests never press Ctrl+S. The other specs all force-save, which is how a
// dead debounce timer (and a timer that wrote one note's text into another)
// reached production unnoticed.

async function freshStart(page: Page) {
  await page.goto(BASE_URL);
  await resetStorage(page);
  await page.reload();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });
  const editBtn = page.getByRole('button', { name: 'Edit' });
  if (await editBtn.isVisible()) await editBtn.click();
}

async function createNote(page: Page, name: string) {
  await page.locator('.sidebar-action-btn').click();
  await page.locator('.new-file-input').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'New File' })).not.toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.tree-item-name', { hasText: name })).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5_000 });
}

async function type(page: Page, text: string) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await editor.pressSequentially(text, { delay: 20 });
}

async function openNote(page: Page, name: string) {
  await page.locator('.tree-item-name', { hasText: name }).click();
}

test('an edit is saved by the debounce alone and survives a reload', async ({ page }) => {
  await freshStart(page);
  await createNote(page, 'auto-note');
  await type(page, 'autosaved text 7c1e');

  await expect(page.locator('.toolbar')).toContainText('Unsaved');
  await expect(page.locator('.toolbar')).not.toContainText('Unsaved', { timeout: 5_000 });

  let dialogs = 0;
  page.on('dialog', async (d) => { dialogs++; await d.accept(); });
  await page.reload();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });
  expect(dialogs, 'beforeunload fired — the note was still dirty').toBe(0);
  await openNote(page, 'auto-note');
  await expect(page.locator('.cm-content')).toContainText('autosaved text 7c1e', { timeout: 8_000 });
});

test('switching notes right after typing keeps both notes intact', async ({ page }) => {
  await freshStart(page);
  await createNote(page, 'note-bbb');
  await type(page, 'CONTENT-OF-B');
  await expect(page.locator('.toolbar')).not.toContainText('Unsaved', { timeout: 5_000 });
  await createNote(page, 'note-aaa');
  await type(page, 'EDIT-OF-A');
  // no wait: leave while the debounce is still pending
  await openNote(page, 'note-bbb');
  await expect(page.locator('.cm-content')).toContainText('CONTENT-OF-B');
  await page.waitForTimeout(1_500); // past the debounce window

  await openNote(page, 'note-aaa');
  await expect(page.locator('.cm-content')).toContainText('EDIT-OF-A');
  await expect(page.locator('.cm-content')).not.toContainText('CONTENT-OF-B');
  await openNote(page, 'note-bbb');
  await expect(page.locator('.cm-content')).toContainText('CONTENT-OF-B');
  await expect(page.locator('.cm-content')).not.toContainText('EDIT-OF-A');
});

test('closing the active tab shows the remaining note, and typing lands in it', async ({ page }) => {
  await freshStart(page);
  await createNote(page, 'tab-one');
  await type(page, 'ONE');
  await createNote(page, 'tab-two');
  await type(page, 'TWO');
  await page.locator('.tab-item.active .tab-close').click();
  await expect(page.locator('.tab-item.active')).toContainText('tab-one');
  await expect(page.locator('.cm-content')).toContainText('ONE');
  await expect(page.locator('.cm-content')).not.toContainText('TWO');
  await openNote(page, 'tab-two');
  await expect(page.locator('.cm-content')).toContainText('TWO');
});

test('"New File" with an existing name opens that note instead of blanking it', async ({ page }) => {
  await freshStart(page);
  await createNote(page, 'todo');
  await type(page, 'do not lose me');
  await expect(page.locator('.toolbar')).not.toContainText('Unsaved', { timeout: 5_000 });
  await createNote(page, 'other');

  await page.locator('.sidebar-action-btn').click();
  await page.locator('.new-file-input').fill('todo');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'New File' })).not.toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.cm-content')).toContainText('do not lose me');
});

// What IndexedDB holds right now, without going through the app.
async function storedRevisions(page: Page, id: string): Promise<string[]> {
  return page.evaluate((docId) => new Promise<string[]>((resolve, reject) => {
    const open = indexedDB.open('_pouch_lokl');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const all = open.result.transaction('by-sequence').objectStore('by-sequence').getAll();
      all.onerror = () => reject(all.error);
      all.onsuccess = () => {
        open.result.close();
        resolve((all.result as Array<{ _doc_id_rev: string; content?: string }>)
          .filter(r => r._doc_id_rev.startsWith(`${docId}::`))
          .map(r => r.content ?? ''));
      };
    };
  }), id);
}

// 2026-11-14: the debounce re-armed on every keystroke, so text typed without a one-second
// pause was never written. Sixty seconds of steady typing, then a crash: nothing left.
test('steady typing is written to storage while the user is still typing', async ({ page }) => {
  await freshStart(page);
  await createNote(page, 'steady');
  const editor = page.locator('.cm-content');
  await editor.click();
  // ~10 s with a key every 250 ms — never idle long enough for the debounce
  const typing = editor.pressSequentially('k'.repeat(40), { delay: 250 });
  await page.waitForTimeout(7500);
  const mid = await storedRevisions(page, 'steady.md');
  await typing;
  expect(Math.max(...mid.map(c => c.length))).toBeGreaterThan(5);
});

// Every save used to keep the previous full text for good (150 saves of a 200KB note = 30MB),
// and emptying the trash returned none of it.
test('saving again does not keep the superseded text in storage', async ({ page }) => {
  await freshStart(page);
  await createNote(page, 'compact');
  for (const word of ['one ', 'two ', 'three ']) {
    await type(page, word);
    await expect(page.locator('.toolbar')).not.toContainText('Unsaved', { timeout: 5_000 });
  }
  await expect.poll(() => storedRevisions(page, 'compact.md'), { timeout: 5_000 }).toHaveLength(1);
  expect((await storedRevisions(page, 'compact.md'))[0]).toContain('three');
});
