import { test, expect, type Page } from '@playwright/test';
import { resetStorage } from './helpers/storage';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

/**
 * Right-click a sidebar file row to open the context menu, then click Delete.
 */
async function deleteViaSidebar(page: Page, displayName: string) {
  const treeItem = page.locator('.tree-item-name', { hasText: displayName });
  await treeItem.click({ button: 'right' });
  await expect(page.locator('.context-menu')).toBeVisible({ timeout: 3_000 });
  const deleteBtn = page.locator('.context-menu-item.danger');
  await expect(deleteBtn).toBeVisible();
  await deleteBtn.click();
  await page.waitForTimeout(800);
}

/**
 * Open the Settings panel via the toolbar gear button.
 */
async function openSettings(page: Page) {
  await page.getByTitle('Settings').click();
  // settings-dialog should appear
  await expect(page.locator('.settings-dialog')).toBeVisible({ timeout: 5_000 });
}

/**
 * Export JSON from the Settings panel.
 * Returns the local temp-file path where the download was saved.
 */
async function exportJsonBackup(page: Page): Promise<string> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  const tmpPath = path.join(os.tmpdir(), `lokl-e2e-${Date.now()}.json`);
  await download.saveAs(tmpPath);
  return tmpPath;
}

/**
 * Import a JSON file via the Settings panel file input.
 */
async function importJsonBackup(page: Page, filePath: string) {
  await page.locator('input[type="file"][accept=".json"]').setInputFiles(filePath);
}

// ─── TEST 1: export backup → clear vault → import → all notes restored ───────

test('export backup, clear vault, import backup → all notes restored', async ({ page }) => {
  page.on('dialog', async (dialog) => { await dialog.accept(); });

  await freshStart(page);

  // Create 3 notes
  const notes = ['backup-note-alpha', 'backup-note-beta', 'backup-note-gamma'];
  for (const name of notes) {
    await createNote(page, name);
  }

  // Open Settings and export JSON
  await openSettings(page);
  const tmpPath = await exportJsonBackup(page);

  // Verify the exported file is valid JSON with version:1
  const raw = fs.readFileSync(tmpPath, 'utf-8');
  const payload = JSON.parse(raw);
  expect(payload.version).toBe(1);
  expect(Array.isArray(payload.notes)).toBe(true);

  // Close settings panel and wipe the vault
  await page.keyboard.press('Escape');
  await resetStorage(page);
  await page.reload();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });

  // Verify notes are gone
  for (const name of notes) {
    await expect(page.locator('.tree-item-name', { hasText: name })).not.toBeVisible({ timeout: 3_000 });
  }

  // Import the backup via Settings
  await openSettings(page);
  await importJsonBackup(page, tmpPath);

  // Wait for success toast: "Imported N. Conflicts kept: M."
  await expect(page.locator('.toast-success .toast-message')).toBeVisible({ timeout: 8_000 });

  // Close settings and verify all 3 notes reappear in the sidebar
  await page.keyboard.press('Escape');
  for (const name of notes) {
    await expect(page.locator('.tree-item-name', { hasText: name })).toBeVisible({ timeout: 8_000 });
  }

  // Clean up temp file
  fs.unlinkSync(tmpPath);
});

// ─── TEST 2: trash status round-trips end-to-end (export → wipe → import)
//
// exportJSON() includes trashed docs (allDocs() without filtering).
// importJSON() now uses getDB().put(payloadDoc) directly (replacing the
// earlier putNote-only path) so every NoteDoc field — including
// `trashed`, `trashedAt`, `tags`, `links`, `title` — survives the
// round-trip. After import the live note is back in the main list and
// the trashed note is back in the Trash panel.

test('export → import round-trips trashed flag (note returns to Trash)', async ({ page }) => {
  page.on('dialog', async (dialog) => { await dialog.accept(); });

  await freshStart(page);

  const liveName = 'backup-live-note';
  const trashedName = 'backup-trashed-note';

  await createNote(page, liveName);
  await createNote(page, trashedName);

  // Send one note to trash via right-click → Delete
  await deleteViaSidebar(page, trashedName);
  await expect(page.locator('.tree-item-name', { hasText: trashedName })).not.toBeVisible({ timeout: 5_000 });

  // Export JSON — exportJSON() uses allDocs() so it includes trashed docs
  await openSettings(page);
  const tmpPath = await exportJsonBackup(page);

  // Verify the exported blob contains the trashed note with trashed:true
  const raw = fs.readFileSync(tmpPath, 'utf-8');
  const payload = JSON.parse(raw);
  const trashedInBlob = payload.notes.find((n: any) => n._id === `${trashedName}.md`);
  expect(trashedInBlob).toBeDefined();
  expect(trashedInBlob.trashed).toBe(true);

  // Close settings, wipe vault, reload
  await page.keyboard.press('Escape');
  await resetStorage(page);
  await page.reload();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });

  // Import the backup
  await openSettings(page);
  await importJsonBackup(page, tmpPath);
  await expect(page.locator('.toast-success .toast-message')).toBeVisible({ timeout: 8_000 });
  await page.keyboard.press('Escape');

  // Live note is back in the main list; trashed note is NOT (FileTree
  // filters out trashed docs; TrashPanel renders by `_id` in `.trash-path`).
  await expect(page.locator('.tree-item-name', { hasText: liveName })).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.tree-item-name', { hasText: trashedName })).toHaveCount(0);

  // Trash panel shows (1) and contains the trashed note's _id.
  // TrashPanel polls listTrash() every 5s, so allow 7s for the count
  // to refresh after the importJSON write lands.
  const trashToggle = page.locator('.trash-toggle');
  await expect(trashToggle).toBeVisible({ timeout: 3_000 });
  await expect(trashToggle).toContainText('(1)', { timeout: 7_000 });
  await trashToggle.click();
  await expect(
    page.locator('.trash-list .trash-path', { hasText: `${trashedName}.md` }),
  ).toBeVisible({ timeout: 3_000 });

  // Clean up temp file
  fs.unlinkSync(tmpPath);
});

// ─── TEST 3: malformed backup → user-facing error, vault unchanged ────────────

test('import malformed backup → user-facing error, vault unchanged', async ({ page }) => {
  page.on('dialog', async (dialog) => { await dialog.accept(); });

  await freshStart(page);

  // Create a sentinel note to verify vault is unchanged after failed import
  const sentinelName = 'backup-sentinel-note';
  await createNote(page, sentinelName);

  // Write a malformed JSON file to a temp path
  const tmpPath = path.join(os.tmpdir(), `lokl-e2e-bad-${Date.now()}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify({ not: 'a backup' }), 'utf-8');

  // Attempt import via Settings panel
  await openSettings(page);
  await importJsonBackup(page, tmpPath);

  // Wait for the error toast: "Import failed: Invalid backup payload"
  const errorToast = page.locator('.toast-error .toast-message');
  await expect(errorToast).toBeVisible({ timeout: 8_000 });
  await expect(errorToast).toContainText(/Import failed/i);

  // Close settings; sentinel note must still be present — vault is unchanged
  await page.keyboard.press('Escape');
  await expect(page.locator('.tree-item-name', { hasText: sentinelName })).toBeVisible({ timeout: 5_000 });

  // Clean up temp file
  fs.unlinkSync(tmpPath);
});
