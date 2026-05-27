import { test, expect, type Page } from '@playwright/test';
import { resetStorage } from './helpers/storage';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';

// ─── helpers ────────────────────────────────────────────────────────────────

async function freshStart(page: Page) {
  await page.goto(BASE_URL);
  await resetStorage(page);
  await page.reload();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });
}

async function createNote(page: Page, name: string) {
  await page.locator('.sidebar-action-btn').click();
  await expect(page.getByRole('heading', { name: 'New File' })).toBeVisible();
  await page.locator('.new-file-input').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'New File' })).not.toBeVisible({ timeout: 5_000 });
  const displayName = name.replace(/\.md$/, '');
  await expect(page.locator('.tree-item-name', { hasText: displayName })).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5_000 });
}

async function typeAndForceSave(page: Page, text: string) {
  const editBtn = page.getByRole('button', { name: 'Edit' });
  if (await editBtn.isVisible()) {
    await editBtn.click();
  }
  const editor = page.locator('.cm-content');
  await editor.click();
  await editor.pressSequentially(text, { delay: 30 });
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(1_500);
}

/**
 * Right-click a sidebar file row (matching displayName) to open the context
 * menu, then click the Delete item.
 */
async function deleteViaSidebar(page: Page, displayName: string) {
  const treeItem = page.locator('.tree-item-name', { hasText: displayName });
  await treeItem.click({ button: 'right' });
  // ContextMenu renders with class="context-menu"
  await expect(page.locator('.context-menu')).toBeVisible({ timeout: 3_000 });
  const deleteBtn = page.locator('.context-menu-item.danger');
  await expect(deleteBtn).toBeVisible();
  await deleteBtn.click();
  // Give the UI time to process the delete and re-render
  await page.waitForTimeout(800);
}

/**
 * Expand the TrashPanel by clicking its toggle button.
 * The button text is "Trash (N)" — it only opens when N > 0.
 */
async function openTrashPanel(page: Page) {
  const toggle = page.locator('.trash-toggle');
  await expect(toggle).toBeVisible({ timeout: 5_000 });
  // Wait until the count is non-zero (i.e. note has been trashed)
  await expect(toggle).not.toContainText('(0)', { timeout: 5_000 });
  // Only click if not already expanded
  const expanded = await toggle.getAttribute('aria-expanded');
  if (expanded !== 'true') {
    await toggle.click();
  }
  await expect(page.locator('.trash-list')).toBeVisible({ timeout: 3_000 });
}

// ─── TEST 1: delete → disappears from main list, appears in Trash ────────────

test('delete note → disappears from main list, appears in Trash', async ({ page }) => {
  // Dismiss any beforeunload prompts
  page.on('dialog', async (dialog) => { await dialog.accept(); });

  await freshStart(page);

  const noteName = 'trash-test-note';
  await createNote(page, noteName);

  // Delete via context menu
  await deleteViaSidebar(page, noteName);

  // Note should no longer appear in the main file tree
  await expect(page.locator('.tree-item-name', { hasText: noteName })).not.toBeVisible({ timeout: 5_000 });

  // Open TrashPanel and confirm the note is listed there
  await openTrashPanel(page);
  await expect(page.locator('.trash-path', { hasText: `${noteName}.md` })).toBeVisible({ timeout: 5_000 });
});

// ─── TEST 2: restore from Trash → reappears in main list with original content

test('restore from Trash → reappears in main list with original content', async ({ page }) => {
  page.on('dialog', async (dialog) => { await dialog.accept(); });

  await freshStart(page);

  const noteName = 'restore-test-note';
  const noteContent = 'restore-verify-content-a7f2';
  await createNote(page, noteName);
  await typeAndForceSave(page, noteContent);

  // Delete via context menu
  await deleteViaSidebar(page, noteName);
  await expect(page.locator('.tree-item-name', { hasText: noteName })).not.toBeVisible({ timeout: 5_000 });

  // Open trash and restore
  await openTrashPanel(page);
  const restoreBtn = page.locator('.trash-restore', {
    // title attribute is "restore: noteName.md"
    has: page.locator(`[aria-label*="${noteName}"]`),
  }).or(
    page.locator(`button.trash-restore[aria-label*="${noteName}"]`)
  );
  await expect(restoreBtn.first()).toBeVisible({ timeout: 5_000 });
  await restoreBtn.first().click();

  // Wait for sidebar to refresh and show the note again
  await expect(page.locator('.tree-item-name', { hasText: noteName })).toBeVisible({ timeout: 8_000 });

  // Open the note and verify content
  await page.locator('.tree-item-name', { hasText: noteName }).click();
  await expect(page.locator('.cm-content')).toContainText(noteContent, { timeout: 8_000 });
});

// ─── TEST 3: permanently delete from Trash → note is gone from both lists ────

test('permanently delete from Trash → note is gone from both lists', async ({ page }) => {
  page.on('dialog', async (dialog) => { await dialog.accept(); });

  await freshStart(page);

  const noteName = 'purge-test-note';
  await createNote(page, noteName);

  // Delete via context menu → goes to Trash
  await deleteViaSidebar(page, noteName);
  await expect(page.locator('.tree-item-name', { hasText: noteName })).not.toBeVisible({ timeout: 5_000 });

  // Open trash and permanently delete
  await openTrashPanel(page);
  const purgeBtn = page.locator(`button.trash-purge[aria-label*="${noteName}"]`);
  await expect(purgeBtn).toBeVisible({ timeout: 5_000 });
  await purgeBtn.click();

  // Wait for the trash list to refresh
  await page.waitForTimeout(800);

  // Note should be gone from trash list
  await expect(page.locator('.trash-path', { hasText: `${noteName}.md` })).not.toBeVisible({ timeout: 5_000 });

  // Note should also be absent from the main file tree
  await expect(page.locator('.tree-item-name', { hasText: noteName })).not.toBeVisible({ timeout: 3_000 });
});
