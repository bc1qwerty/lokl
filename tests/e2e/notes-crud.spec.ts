import { test, expect, type Page } from '@playwright/test';
import { resetStorage } from './helpers/storage';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Navigate to app, wipe storage, click "Start fresh" to enter the vault. */
async function freshStart(page: Page) {
  await page.goto(BASE_URL);
  await resetStorage(page);
  await page.reload();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });
}

/** Open the New File dialog and create a note with the given name. */
async function createNote(page: Page, name: string) {
  await page.locator('.sidebar-action-btn').click();
  await expect(page.getByRole('heading', { name: 'New File' })).toBeVisible();
  await page.locator('.new-file-input').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'New File' })).not.toBeVisible({ timeout: 5_000 });
  const displayName = name.replace(/\.md$/, '');
  await expect(page.locator('.tree-item-name', { hasText: displayName })).toBeVisible({ timeout: 5_000 });
  // Wait for the editor to become active
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5_000 });
}

/**
 * Switch view mode to Edit-only so only one .cm-content is in the DOM,
 * type text using CM6-compatible input (click + pressSequentially),
 * then force-save with Ctrl+S and wait for the save to complete.
 *
 * Why Ctrl+S instead of debounce: the beforeunload guard fires if
 * isDirty is true at reload time, which can lose data. Ctrl+S triggers
 * an immediate putNote() call, bypassing the 1 s debounce.
 */
async function typeAndForceSave(page: Page, text: string) {
  // Switch to Edit-only mode so the single .cm-content is unambiguous
  const editBtn = page.getByRole('button', { name: 'Edit' });
  if (await editBtn.isVisible()) {
    await editBtn.click();
  }

  const editor = page.locator('.cm-content');
  await editor.click();

  // CM6 contenteditable: pressSequentially fires real input events CM6 handles
  await editor.pressSequentially(text, { delay: 30 });

  // Force-save via Ctrl+S (handled in app.tsx keydown handler)
  await page.keyboard.press('Control+s');

  // Wait for save to complete: poll until isDirty is false via the save
  // indicator, or simply wait enough time for the synchronous putNote to finish.
  // The Ctrl+S path calls putNote directly (no debounce) — 1 500 ms is generous.
  await page.waitForTimeout(1_500);
}

/**
 * Reload the page, handling the beforeunload dialog if it appears
 * (it fires when isDirty=true, which shouldn't happen after force-save,
 * but we dismiss it defensively).
 */
async function safeReload(page: Page) {
  // Listen for the beforeunload dialog and dismiss it
  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });
  await page.reload();
  // Wait for the main layout to be ready
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });
}

// ─── TEST 1: create → edit → save → reload, content survives ────────────────

test('create → edit → save → reload, content survives', async ({ page }) => {
  await freshStart(page);

  const fileName = 'crud-test-note';
  await createNote(page, fileName);

  const uniqueContent = 'Hello lokl CRUD test content 9f3a';
  await typeAndForceSave(page, uniqueContent);

  await safeReload(page);

  // Click the note in the sidebar to load it
  await page.locator('.tree-item-name', { hasText: fileName }).click();

  // The editor should contain the saved content
  await expect(page.locator('.cm-content')).toContainText(uniqueContent, { timeout: 8_000 });
});

// ─── TEST 2 moved ───────────────────────────────────────────────────────────
// The ConflictPanel test lived here and injected a doc through raw IndexedDB,
// guessing at PouchDB's object store layout. The guess was wrong for the
// adapter in use, so it hit its own test.skip() on every run. It now produces a
// real conflict copy with two tabs — see data-safety.spec.ts.

// ─── TEST 3: rapid-fire 10 edits, all persist without lock errors ─────────
//
// Types 10 distinct lines quickly, force-saves, reloads, verifies all lines
// survived. Tests the putNote() 409-retry loop (A1 in the Phase 2 spec).

test('rapid-fire 10 edits, all persist without lock errors', async ({ page }) => {
  await freshStart(page);

  await createNote(page, 'rapid-fire-note');

  // Switch to Edit-only mode
  const editBtn = page.getByRole('button', { name: 'Edit' });
  if (await editBtn.isVisible()) {
    await editBtn.click();
  }

  const editor = page.locator('.cm-content');
  await editor.click();

  // Type 10 lines rapidly — no artificial pause between them
  const lines: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const line = `rapid-fire-line-${i}-marker`;
    lines.push(line);
    await editor.pressSequentially(line, { delay: 15 });
    await page.keyboard.press('Enter');
  }

  // Force-save with Ctrl+S — triggers immediate putNote() bypassing debounce
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(1_500);

  await safeReload(page);

  // Re-open the note
  await page.locator('.tree-item-name', { hasText: 'rapid-fire-note' }).click();

  const content = page.locator('.cm-content');
  for (const line of lines) {
    await expect(content).toContainText(line, { timeout: 8_000 });
  }
});
