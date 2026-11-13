import { test, expect, type Page } from '@playwright/test';
import { resetStorage } from './helpers/storage';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';

// «닿지 않는 조작 0»: every control must be on screen, or reachable by scrolling something
// the user can scroll, in each window size — and not covered by something else.
// What this caught when it was first run by hand (2026-11): a dozen conflict copies squeezed the
// file tree to 8 px and pushed Trash/Login out of the sidebar; the context menu hung below the
// window for the last notes of a long tree; on a phone the editor was 0 px wide.

const VIEWPORTS: [number, number][] = [[1280, 720], [1366, 768], [1280, 600], [390, 844], [390, 600], [844, 390]];
const LANGS = ['de', 'fr'];   // the longest labels

/** Runs in the page. Returns the controls inside `scope` a pointer cannot get to. */
function scan(scope: string): { n: number; unreachable: string[]; pageOverflowX: boolean; missing?: boolean } {
  const root = document.querySelector(scope);
  if (!root) return { n: 0, unreachable: [], pageOverflowX: false, missing: true };
  const sel = 'button, input:not([type=hidden]), select, a[href], textarea, label.settings-import-label, .search-result-item, .tree-item, .tab-item, .backlink-item, .tag-item';
  const layout = document.querySelector<HTMLElement>('.app-layout');
  const out = { n: 0, unreachable: [] as string[], pageOverflowX: document.documentElement.scrollWidth > innerWidth };
  const name = (e: Element) => `${(e.getAttribute('aria-label') || (e as HTMLElement).title || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)}<${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}>`;
  for (const el of root.querySelectorAll<HTMLElement>(sel)) {
    if ((el as HTMLInputElement).type === 'file') continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.closest('.sidebar') && layout?.dataset.sidebar === 'closed') continue;
    if (el.closest('.backlinks-panel-wrapper') && layout?.dataset.backlinks === 'closed') continue;
    out.n++;
    // scroll only what a user can scroll (overflow auto/scroll) — never the overflow:hidden boxes
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ps = getComputedStyle(p);
      const er = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
      if (/auto|scroll/.test(ps.overflowY) && p.scrollHeight > p.clientHeight) p.scrollTop += (er.top - pr.top) - p.clientHeight / 2 + er.height / 2;
      if (/auto|scroll/.test(ps.overflowX) && p.scrollWidth > p.clientWidth) p.scrollLeft += (er.left - pr.left) - p.clientWidth / 2 + er.width / 2;
    }
    // an inline link wrapped over two lines: the middle of its bounding box can be empty space
    const boxes = el.getClientRects();
    const r = boxes.length > 1 ? boxes[0] : el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) { out.unreachable.push(`${name(el)} zero-size`); continue; }
    let x0 = Math.max(r.left, 0), y0 = Math.max(r.top, 0), x1 = Math.min(r.right, innerWidth), y1 = Math.min(r.bottom, innerHeight);
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.overflowX !== 'visible' || ps.overflowY !== 'visible') {
        const pr = p.getBoundingClientRect();
        x0 = Math.max(x0, pr.left); y0 = Math.max(y0, pr.top); x1 = Math.min(x1, pr.right); y1 = Math.min(y1, pr.bottom);
      }
      if (ps.position === 'fixed') break;
    }
    const visible = Math.max(0, x1 - x0) * Math.max(0, y1 - y0) / (r.width * r.height);
    let hit = false;
    if (visible > 0) {
      const h = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
      hit = !!h && (h === el || el.contains(h) || (h.contains(el) && h.closest(sel) === el) || !!h.closest('label')?.contains(el));
    }
    if (visible < 0.6 || !hit) out.unreachable.push(`${name(el)} visible=${visible.toFixed(2)} hit=${hit} at ${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}`);
  }
  return out;
}

/** A vault with a long tree, conflict copies and a full trash — through the app's own JSON import. */
function seedBackup(): string {
  const stamp = '2026-01-01T00:00:00.000Z';
  const doc = (id: string, content: string, extra: object = {}) =>
    ({ _id: id, content, title: id, tags: [], links: [], createdAt: stamp, updatedAt: stamp, ...extra });
  const notes: object[] = [];
  for (let i = 0; i < 40; i++) {
    const long = i % 5 === 0 ? ' with a very long descriptive title that goes on and on' : '';
    notes.push(doc(`${i % 7 === 0 ? 'projects/deep/' : ''}note ${String(i).padStart(2, '0')}${long}.md`,
      `# note ${i}\nalpha beta [[note ${String((i + 1) % 40).padStart(2, '0')}]] #tag${i % 9} #a-very-long-tag-name-number-${i % 4}\n`));
  }
  for (let i = 0; i < 14; i++) notes.push(doc(`note ${String(i).padStart(2, '0')} (conflict-import-00112233445566${String(i).padStart(2, '0')}).md`, `other ${i}`, { conflictOf: `note ${String(i).padStart(2, '0')}.md` }));
  for (let i = 0; i < 8; i++) notes.push(doc(`binned ${i} long long long name here.md`, 'x', { trashed: true, trashedAt: new Date().toISOString() }));
  return JSON.stringify({ version: 1, exportedAt: stamp, notes });
}

const toolbarRight = (page: Page, i: number) => page.locator('.toolbar-right > button.toolbar-btn').nth(i);   // 0 daily, 1 graph, 2 backlinks, 3 settings, 4 theme

async function seed(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(BASE_URL);
  await resetStorage(page);
  await page.reload();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });
  await toolbarRight(page, 3).click();
  await page.locator('.settings-import-label input[type=file]').setInputFiles({ name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(seedBackup()) });
  await expect(page.locator('.toast', { hasText: 'Imported 62' })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.tree-item')).not.toHaveCount(0);
}

async function expectReachable(page: Page, where: string, scope: string) {
  const r = await page.evaluate(scan, scope);
  expect(r.missing, `${where}: ${scope} is not there`).toBeFalsy();
  expect(r.n, `${where}: nothing to scan in ${scope}`).toBeGreaterThan(0);
  expect(r.unreachable, `${where}: unreachable controls in ${scope}`).toEqual([]);
  expect(r.pageOverflowX, `${where}: the page scrolls sideways`).toBe(false);
}

for (const [w, h] of VIEWPORTS) {
  test(`every control is reachable at ${w}×${h}`, async ({ page }) => {
    test.setTimeout(180_000);
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await seed(page);

    for (const lang of LANGS) {
      const at = `${w}×${h} ${lang}`;
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate((l) => localStorage.setItem('lokl-lang', l), lang);
      await page.reload();
      await expect(page.locator('.toolbar')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.conflict-item')).toHaveCount(14, { timeout: 10_000 });
      const narrow = w <= 720;

      // a note open
      await page.keyboard.press('ControlOrMeta+p');
      await page.locator('.search-input').fill('note 03');
      await page.keyboard.press('Enter');
      await expect(page.locator('.cm-content')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10_000 });

      if (narrow) {
        // drawers start closed: the note has the whole width
        expect((await page.locator('.cm-content').boundingBox())!.width).toBeGreaterThan(w * 0.8);
        await expectReachable(page, `${at} note`, '.toolbar');
        await expectReachable(page, `${at} note`, '.main-content');
        await page.locator('.toolbar-left > button.toolbar-btn').click();   // ☰
        await expect.poll(async () => (await page.locator('.sidebar').boundingBox())!.width).toBeGreaterThan(200);
        await expect(page.locator('.trash-toggle')).toContainText('(8)', { timeout: 10_000 });
        await page.locator('.trash-toggle').click();
        await expect(page.locator('.trash-list li')).toHaveCount(8);
        await expectReachable(page, `${at} sidebar drawer`, '.sidebar');
        await expectReachable(page, `${at} sidebar drawer`, '.toolbar');
        await page.locator('.toolbar-left > button.toolbar-btn').click();
        await toolbarRight(page, 2).click();                                 // backlinks drawer
        await expect.poll(async () => (await page.locator('.backlinks-panel-wrapper').boundingBox())!.width).toBeGreaterThan(200);
        await expectReachable(page, `${at} backlinks drawer`, '.backlinks-panel-wrapper');
        await toolbarRight(page, 2).click();
      } else {
        await expect(page.locator('.trash-toggle')).toContainText('(8)', { timeout: 10_000 });
        await page.locator('.trash-toggle').click();
        await expect(page.locator('.trash-list li')).toHaveCount(8);
        await expectReachable(page, `${at} main`, '.app-layout');
      }

      // context menu for the last row in view of a long tree
      if (narrow) {
        await page.locator('.toolbar-left > button.toolbar-btn').click();
        await expect.poll(async () => (await page.locator('.sidebar').boundingBox())!.width).toBeGreaterThan(200);
      }
      const last = await page.evaluate(() => {
        const tree = document.querySelector('.file-tree')!;
        const box = tree.getBoundingClientRect();
        const rows = [...tree.querySelectorAll<HTMLElement>('.tree-item')].filter((e) => { const r = e.getBoundingClientRect(); return r.top >= box.top && r.bottom <= box.bottom + 1; });
        const r = rows[rows.length - 1].getBoundingClientRect();
        return { x: Math.round(r.right - 8), y: Math.round(r.bottom - 3) };
      });
      await page.mouse.click(last.x, last.y, { button: 'right' });
      await expect(page.locator('.context-menu')).toBeVisible();
      await expectReachable(page, `${at} context menu`, '.context-menu');
      await page.keyboard.press('Escape');
      await expect(page.locator('.context-menu')).toHaveCount(0);
      if (narrow) await page.locator('.toolbar-left > button.toolbar-btn').click();

      // dialogs
      await toolbarRight(page, 3).click();
      await expectReachable(page, `${at} settings`, '.settings-dialog');
      await page.keyboard.press('Escape');

      await page.keyboard.press('ControlOrMeta+k');
      await page.locator('.search-input').fill('alpha');
      await expect(page.locator('.search-result-item').first()).toBeVisible();
      await expectReachable(page, `${at} search`, '.search-dialog');
      await page.keyboard.press('Escape');

      await page.keyboard.press('ControlOrMeta+p');
      await expectReachable(page, `${at} quick open`, '.search-dialog');
      await page.keyboard.press('Escape');

      await page.keyboard.press('ControlOrMeta+n');
      await expectReachable(page, `${at} new file`, '.new-file-dialog');
      await page.keyboard.press('Escape');

      await toolbarRight(page, 1).click();
      await expectReachable(page, `${at} graph`, '.graph-container');
      await page.keyboard.press('Escape');
      await expect(page.locator('.graph-container')).toHaveCount(0);
    }
  });
}
