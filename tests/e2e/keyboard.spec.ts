import { test, expect, type Page } from '@playwright/test';
import { resetStorage } from './helpers/storage';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';

// Everything here is done with real key presses. The other specs fill inputs directly, which
// is how "the New File box never gets the focus" went unnoticed.

async function freshStart(page: Page) {
  await page.goto(BASE_URL);
  await resetStorage(page);
  await page.reload();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });
}

const treeItem = (page: Page, name: string) => page.locator('.file-tree .tree-item', { has: page.getByText(name, { exact: true }) });
const treeNames = (page: Page) => page.locator('.file-tree .tree-item-name').allInnerTexts();
const focusIsIn = (page: Page, selector: string) => page.evaluate((s) => !!document.activeElement?.closest(s), selector);

async function createByTyping(page: Page, name: string) {
  await page.locator('.sidebar-action-btn').click();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(page.locator('.new-file-dialog')).toHaveCount(0);
  await expect(page.locator('.tab-item.active')).toContainText(name);
}

test('New File and Rename take what is typed, and nothing typed leaks into the note behind', async ({ page }) => {
  await freshStart(page);
  // opened with the mouse: the box has the focus without a click into it
  await createByTyping(page, 'first note');

  await page.locator('.cm-content').click();
  await page.keyboard.type('BODY');
  await expect(page.locator('.save-status.saved')).toBeVisible({ timeout: 10_000 });

  // opened by shortcut while the caret is in the editor
  await page.keyboard.press('ControlOrMeta+n');
  await expect(page.locator('.new-file-dialog')).toBeVisible();
  await page.keyboard.type('second note');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tab-item.active')).toContainText('second note');
  expect(await treeNames(page)).toEqual(['first note', 'second note']);

  await treeItem(page, 'first note').click();
  await expect(page.locator('.tab-item.active')).toContainText('first note');
  await expect(page.locator('.cm-content')).toHaveText('BODY');

  // Rename: the old name is selected, so typing replaces it
  await treeItem(page, 'first note').click({ button: 'right' });
  await page.locator('.context-menu-item').first().click();
  await expect(page.locator('.new-file-input')).toBeFocused();
  await page.keyboard.type('renamed');
  await page.keyboard.press('Enter');
  await expect.poll(() => treeNames(page)).toEqual(['renamed', 'second note']);
  await expect(page.locator('.cm-content')).toHaveText('BODY');
});

test('a note can be opened, renamed and deleted without a pointer', async ({ page }) => {
  await freshStart(page);
  await createByTyping(page, 'alpha');
  await createByTyping(page, 'beta');

  // open
  await treeItem(page, 'alpha').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.tab-item.active')).toContainText('alpha');

  // rename through the context menu (Shift+F10)
  await treeItem(page, 'alpha').focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('.context-menu')).toBeVisible();
  await expect(page.locator('.context-menu-item').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.new-file-input')).toBeFocused();
  await page.keyboard.type('gamma');
  await page.keyboard.press('Enter');
  await expect.poll(() => treeNames(page)).toEqual(['beta', 'gamma']);

  // delete: arrow keys walk the menu, Escape closes it and gives the focus back
  await treeItem(page, 'beta').focus();
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('Escape');
  await expect(page.locator('.context-menu')).toHaveCount(0);
  await expect(treeItem(page, 'beta')).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('ArrowUp');                       // wraps to the last item: Delete
  await expect(page.locator('.context-menu-item.danger')).toBeFocused();
  page.once('dialog', (d) => d.accept());
  await page.keyboard.press('Enter');
  await expect.poll(() => treeNames(page)).toEqual(['gamma']);
});

test('dialogs take the focus, keep Tab inside, and hand the focus back', async ({ page }) => {
  await freshStart(page);
  await createByTyping(page, 'note');

  const settings = page.locator('.toolbar-right > button.toolbar-btn').nth(3);
  await settings.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.settings-dialog')).toBeVisible();
  expect(await page.locator('.settings-dialog').getAttribute('role')).toBe('dialog');
  for (let i = 0; i < 30; i++) {
    expect(await focusIsIn(page, '.settings-dialog'), `Tab press ${i} left the dialog`).toBe(true);
    await page.keyboard.press('Tab');
  }
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await focusIsIn(page, '.settings-dialog')).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('.settings-dialog')).toHaveCount(0);
  await expect(settings).toBeFocused();

  const plus = page.locator('.sidebar-action-btn');
  await plus.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.new-file-input')).toBeFocused();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await focusIsIn(page, '.new-file-dialog')).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(plus).toBeFocused();
});

test('the selected search row is scrolled into view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await freshStart(page);
  for (let i = 0; i < 14; i++) await createByTyping(page, `row ${String(i).padStart(2, '0')}`);
  await page.keyboard.press('ControlOrMeta+p');
  const rows = await page.locator('.search-result-item').count();
  expect(rows).toBe(14);
  for (let i = 0; i < rows - 1; i++) {
    await page.keyboard.press('ArrowDown');
    const inView = await page.evaluate(() => {
      const row = document.querySelector('.search-result-item.selected')!.getBoundingClientRect();
      const list = document.querySelector('.search-results')!.getBoundingClientRect();
      return row.top >= list.top - 1 && row.bottom <= list.bottom + 1;
    });
    expect(inView, `row ${i + 1} is selected out of sight`).toBe(true);
  }
});

test('on a phone the note has the full width and the side panels are drawers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL);
  await resetStorage(page);
  await page.reload();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  const layout = page.locator('.app-layout');
  await expect(layout).toBeVisible({ timeout: 10_000 });
  await expect(layout).toHaveAttribute('data-sidebar', 'closed');
  await page.locator('.toolbar-left > button.toolbar-btn').click();
  await expect(layout).toHaveAttribute('data-sidebar', 'open');
  await createByTyping(page, 'pocket');
  // opening a note closes the drawer that was covering it
  await expect(layout).toHaveAttribute('data-sidebar', 'closed');
  expect((await page.locator('.cm-content').boundingBox())!.width).toBeGreaterThan(300);
  // the two drawers never sit on top of each other
  await page.locator('.toolbar-left > button.toolbar-btn').click();
  await page.locator('.toolbar-right > button.toolbar-btn').nth(2).click();
  await expect(layout).toHaveAttribute('data-backlinks', 'open');
  await expect(layout).toHaveAttribute('data-sidebar', 'closed');
});
