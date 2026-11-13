import { test, expect, type Page } from '@playwright/test';
import { resetStorage } from './helpers/storage';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';

async function freshStart(page: Page) {
  await page.goto(BASE_URL);
  await resetStorage(page);
  await page.reload();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await expect(page.locator('.app-layout')).toBeVisible({ timeout: 10_000 });
}

const treeItem = (page: Page, name: string) => page.locator('.file-tree .tree-item', { has: page.getByText(name, { exact: true }) });
const treeNames = (page: Page) => page.locator('.file-tree .tree-item-name').allInnerTexts();
const sidebarToggle = (page: Page) => page.locator('.toolbar-left > button.toolbar-btn');

async function create(page: Page, name: string) {
  await page.keyboard.press('ControlOrMeta+n');
  await expect(page.locator('.new-file-input')).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(page.locator('.new-file-dialog')).toHaveCount(0);
  const shown = name.split('/').pop()!;
  await expect(page.locator('.tab-item.active')).toContainText(shown);
}

/** Press Tab `n` times; report every stop that is inside `selector`. */
async function tabStopsInside(page: Page, selector: string, n: number): Promise<string[]> {
  const hits: string[] = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate((s) => {
      const a = document.activeElement as HTMLElement | null;
      return a && a.closest(s) ? (a.className || a.tagName) : '';
    }, selector);
    if (hit) hits.push(hit);
  }
  return hits;
}

test('a closed sidebar is out of the tab order — desktop and phone drawer', async ({ page }) => {
  await freshStart(page);
  await create(page, 'one');
  await create(page, 'two');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+\\');
  await expect(page.locator('.app-layout')).toHaveAttribute('data-sidebar', 'closed');
  await sidebarToggle(page).focus();
  expect(await tabStopsInside(page, '.sidebar', 25)).toEqual([]);

  // phone: the drawer starts closed
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.app-layout')).toHaveAttribute('data-sidebar', 'closed');
  await sidebarToggle(page).focus();
  expect(await tabStopsInside(page, '.sidebar, .backlinks-panel-wrapper', 25)).toEqual([]);
  // open: its rows are reachable again
  await sidebarToggle(page).click();
  await expect(page.locator('.app-layout')).toHaveAttribute('data-sidebar', 'open');
  await sidebarToggle(page).focus();
  expect((await tabStopsInside(page, '.sidebar', 20)).length).toBeGreaterThan(0);
});

test('the tree is one tab stop; arrows walk it, Left/Right fold folders', async ({ page }) => {
  await freshStart(page);
  await create(page, 'apple');
  await create(page, 'box/inner');
  await create(page, 'cherry');
  await expect.poll(() => treeNames(page)).toEqual(['box', 'inner', 'apple', 'cherry']);

  // exactly one row is tabbable, however many rows there are
  expect(await page.locator('.file-tree .tree-item[tabindex="0"]').count()).toBe(1);
  await page.locator('.sidebar-search-input').focus();
  expect((await tabStopsInside(page, '.file-tree', 4)).length).toBe(1);

  await treeItem(page, 'box').focus();
  await expect(treeItem(page, 'box')).toHaveAttribute('aria-level', '1');
  await expect(treeItem(page, 'inner')).toHaveAttribute('aria-level', '2');
  await page.keyboard.press('ArrowLeft');                         // fold
  await expect(treeItem(page, 'box')).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => treeNames(page)).toEqual(['box', 'apple', 'cherry']);
  await page.keyboard.press('ArrowRight');                        // unfold
  await expect(treeItem(page, 'box')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowRight');                        // into the folder
  await expect(treeItem(page, 'inner')).toBeFocused();
  await page.keyboard.press('ArrowLeft');                         // back to the parent
  await expect(treeItem(page, 'box')).toBeFocused();
  await page.keyboard.press('End');
  await expect(treeItem(page, 'cherry')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(treeItem(page, 'apple')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(treeItem(page, 'box')).toBeFocused();
  // the row that had the focus is the tab stop now
  expect(await page.locator('.file-tree .tree-item[tabindex="0"] .tree-item-name').innerText()).toBe('box');
  expect(await page.locator('.file-tree .tree-item[tabindex="0"]').count()).toBe(1);

  // the open note is announced as current
  await expect(treeItem(page, 'cherry')).toHaveAttribute('aria-current', 'page');

  // after a keyboard rename the focus is on the renamed row, not lost to <body>
  await treeItem(page, 'apple').focus();
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('Enter');
  await expect(page.locator('.new-file-input')).toBeFocused();
  await page.keyboard.type('avocado');
  await page.keyboard.press('Enter');
  await expect.poll(() => treeNames(page)).toEqual(['box', 'inner', 'avocado', 'cherry']);
  await expect(treeItem(page, 'avocado')).toBeFocused();
});

test('"Sort files by: Modified" follows saves without a reload', async ({ page }) => {
  await freshStart(page);
  await create(page, 'alpha');
  await create(page, 'mid');
  await create(page, 'zeta');

  await page.locator('.toolbar-right > button.toolbar-btn').nth(3).click();
  await page.locator('.settings-dialog button', { hasText: 'Modified' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(() => treeNames(page)).toEqual(['zeta', 'mid', 'alpha']);

  await treeItem(page, 'alpha').click();
  await expect(page.locator('.tab-item.active')).toContainText('alpha');
  await page.locator('.cm-content').click();
  await page.keyboard.type('edited');
  await expect(page.locator('.save-status.saved')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => treeNames(page)).toEqual(['alpha', 'zeta', 'mid']);

  await treeItem(page, 'mid').click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('edited too');
  await expect.poll(() => treeNames(page), { timeout: 10_000 }).toEqual(['mid', 'alpha', 'zeta']);
  // the open note and the selected row still agree
  await expect(treeItem(page, 'mid')).toHaveClass(/active/);
  await expect(page.locator('.tab-item.active')).toContainText('mid');

  // a re-sort moves rows in the DOM: the row a keyboard user is on keeps the focus
  await treeItem(page, 'zeta').click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('z');
  await treeItem(page, 'zeta').focus();
  await expect.poll(() => treeNames(page), { timeout: 10_000 }).toEqual(['zeta', 'mid', 'alpha']);
  await expect(treeItem(page, 'zeta')).toBeFocused();
});

test('opening Search or Quick Open over Settings closes Settings instead of hiding under it', async ({ page }) => {
  await freshStart(page);
  await create(page, 'note');
  await page.locator('.toolbar-right > button.toolbar-btn').nth(3).click();
  await expect(page.locator('.settings-dialog')).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('.settings-dialog')).toHaveCount(0);
  const search = page.locator('.search-dialog .search-input');
  await expect(search).toBeFocused();
  // the focused input is the element actually on top at its own centre
  expect(await search.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el;
  })).toBe(true);

  await page.keyboard.press('ControlOrMeta+p');
  await expect(page.locator('.search-dialog')).toHaveCount(1);     // quick open replaced search, one dialog only
  await page.keyboard.press('Escape');
  await expect(page.locator('.search-overlay')).toHaveCount(0);
});

test.describe('touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the "⋯" button reaches rename and delete without a context-menu event; the drawer closes by Esc and by a tap outside', async ({ page }) => {
    await freshStart(page);
    const layout = page.locator('.app-layout');
    await sidebarToggle(page).tap();
    await expect(layout).toHaveAttribute('data-sidebar', 'open');
    await page.locator('.sidebar-action-btn').tap();
    await page.locator('.new-file-input').fill('pocket');
    await page.keyboard.press('Enter');
    await expect(page.locator('.tab-item.active')).toContainText('pocket');
    await expect(layout).toHaveAttribute('data-sidebar', 'closed');

    // Esc closes an open drawer
    await sidebarToggle(page).tap();
    await expect(layout).toHaveAttribute('data-sidebar', 'open');
    await page.keyboard.press('Escape');
    await expect(layout).toHaveAttribute('data-sidebar', 'closed');
    // so does a tap on the note behind it
    await sidebarToggle(page).tap();
    await expect(layout).toHaveAttribute('data-sidebar', 'open');
    await page.touchscreen.tap(375, 500);
    await expect(layout).toHaveAttribute('data-sidebar', 'closed');

    // rename through "⋯"
    await sidebarToggle(page).tap();
    const more = treeItem(page, 'pocket').locator('.tree-item-more');
    await expect(more).toBeVisible();
    const box = (await more.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
    await more.tap();
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();
    const m = (await menu.boundingBox())!;
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(390);
    await page.locator('.context-menu-item').first().tap();
    await page.locator('.new-file-input').fill('wallet');
    await page.keyboard.press('Enter');
    await expect.poll(() => treeNames(page)).toEqual(['wallet']);

    // delete through "⋯"
    if ((await layout.getAttribute('data-sidebar')) === 'closed') await sidebarToggle(page).tap();
    await treeItem(page, 'wallet').locator('.tree-item-more').tap();
    page.once('dialog', (d) => d.accept());
    await page.locator('.context-menu-item.danger').tap();
    await expect.poll(() => treeNames(page)).toEqual([]);

    // a tab's close button is a finger-sized target
    await page.locator('.sidebar-action-btn').tap();
    await page.locator('.new-file-input').fill('tabbed');
    await page.keyboard.press('Enter');
    const close = (await page.locator('.tab-item .tab-close').first().boundingBox())!;
    expect(close.width).toBeGreaterThanOrEqual(24);
    expect(close.height).toBeGreaterThanOrEqual(24);
  });
});

test('at tablet width only one side panel is open at a time, so the note keeps its width', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await freshStart(page);
  await create(page, 'wide');
  const layout = page.locator('.app-layout');
  await expect(layout).toHaveAttribute('data-sidebar', 'open');
  await expect(layout).toHaveAttribute('data-backlinks', 'closed');
  expect((await page.locator('.main-content').boundingBox())!.width).toBeGreaterThanOrEqual(480);
  await page.locator('.toolbar-right > button.toolbar-btn').nth(2).click();
  await expect(layout).toHaveAttribute('data-backlinks', 'open');
  await expect(layout).toHaveAttribute('data-sidebar', 'closed');
  expect((await page.locator('.main-content').boundingBox())!.width).toBeGreaterThanOrEqual(480);
});
