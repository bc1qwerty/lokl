# lokl Phase 2 — Playwright E2E Test Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Playwright + chromium real-browser test harness to lokl that locks in the user flows exercising Phase 1 safety nets (note CRUD with conflict detection, soft-delete → trash → restore, backup round-trip).

**Architecture:** New `tests/e2e/` directory holding 3 spec files (9 tests total) + 1 storage-reset helper, run by `@playwright/test` against `vite preview` on `:4173`. `vitest.config.ts` include glob tightened to `tests/unit/**/*.test.ts` so vitest doesn't try to run `.spec.ts` files. Production source code stays untouched in this cycle.

**Tech Stack:** `@playwright/test` ^1.49, chromium-only, Vite 6 + Preact 10 (existing). Node 22+ (existing).

**Spec:** `docs/superpowers/specs/2026-05-27-lokl-phase2-e2e-playwright-design.md` (commit `41c3fda`).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | add `@playwright/test` devDep + `test:e2e` / `test:e2e:install` scripts |
| `vitest.config.ts` | Modify | tighten `include` to `tests/unit/**/*.test.ts` |
| `playwright.config.ts` | Create | preview-server webServer + chromium project + baseURL |
| `tests/e2e/helpers/storage.ts` | Create | `resetStorage(page)` — IndexedDB/OPFS/localStorage/SW/cookies |
| `tests/e2e/notes-crud.spec.ts` | Create | 3 tests — CRUD + concurrent conflict + rapid-fire |
| `tests/e2e/trash-restore.spec.ts` | Create | 3 tests — soft delete + restore + permanent delete |
| `tests/e2e/backup.spec.ts` | Create | 3 tests — JSON round-trip + trash preservation + malformed import error |
| `.gitignore` | Modify | append `playwright-report/` and `test-results/` |

---

## Conventions

- **Branch:** `feature/phase2-e2e-playwright` (already created in prior brainstorming step — verify in Task 0).
- **Commits:** Conventional Commits (`chore(phase2):`, `test(phase2):`). One task = one commit.
- **TDD posture:** Tests-first per spec. Each spec file has 3 tests; write all 3, run, observe pass/fail, then iterate.
- **Selectors:** Prefer `getByRole(...)` with accessible name. Fall back to `getByText(...)` for content matches. Only add `data-testid` to production code if no role/text path exists — and if you reach for that, surface it as a `DONE_WITH_CONCERNS` so the controller can decide whether the production touch is justified for this cycle.

---

## Task 0 — Verify branch state + clean working tree

- [ ] **Step 1: Verify branch**

```bash
cd ~/lokl
git rev-parse --abbrev-ref HEAD
```
Expected: `feature/phase2-e2e-playwright` (created during brainstorming step with the spec commit `41c3fda` on top).

If the branch doesn't exist:
```bash
git checkout main && git pull --ff-only && git checkout -b feature/phase2-e2e-playwright
```

- [ ] **Step 2: Confirm spec is committed**

```bash
ls docs/superpowers/specs/2026-05-27-lokl-phase2-e2e-playwright-design.md && git log --oneline -2
```
Expected: file exists; top-of-log shows `41c3fda docs(phase2): spec ...` (or similar).

- [ ] **Step 3: Confirm working tree is clean**

```bash
git status --short
```
Expected: no output (clean tree). If any modified files, surface them — do not proceed with stale changes.

- [ ] **Step 4: Run existing vitest baseline**

```bash
npm test
```
Expected: green. Capture the test count (will assert unchanged after Task 2).

---

## Task 1 — Install Playwright + add scripts

**Files:** Modify `package.json`

- [ ] **Step 1: Install `@playwright/test` as devDep**

```bash
cd ~/lokl
npm install --save-dev @playwright/test@^1.49
```
Expected: `package.json` and `package-lock.json` updated; `node_modules/@playwright/test` present.

- [ ] **Step 2: Download chromium browser binary**

```bash
npx playwright install chromium
```
Expected: chromium downloaded to `~/.cache/ms-playwright/chromium-*`. ~150MB one-time. Skipped if already installed.

- [ ] **Step 3: Add `test:e2e` and `test:e2e:install` scripts**

Open `package.json`. In the `scripts` block (currently `test`, `test:watch`, `test:coverage` etc.), add at the end:

```json
    "test:e2e": "playwright test",
    "test:e2e:install": "playwright install chromium"
```

The resulting `scripts` section should look approximately like:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "deploy": "npm run build && npx gh-pages -d dist",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "test:e2e:install": "playwright install chromium"
  },
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(phase2): add @playwright/test devDep + e2e scripts"
```

---

## Task 2 — Tighten vitest include glob

**Files:** Modify `vitest.config.ts`

- [ ] **Step 1: Edit the `include` line**

Open `vitest.config.ts`. Find:

```typescript
    include: ['tests/**/*.test.ts'],
```

Change to:

```typescript
    include: ['tests/unit/**/*.test.ts'],
```

- [ ] **Step 2: Re-run vitest baseline — must be unchanged**

```bash
npm test
```
Expected: same test count as Task 0 Step 4. The change is functionally a no-op (every existing test lives under `tests/unit/`) but prevents future `.test.ts` files dropped into `tests/e2e/` from being silently captured by vitest.

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "chore(phase2): tighten vitest include to tests/unit/**/*.test.ts"
```

---

## Task 3 — Create `playwright.config.ts`

**Files:** Create `playwright.config.ts`

- [ ] **Step 1: Write the config**

Create `playwright.config.ts`:

```typescript
import { defineConfig, devices } from '@playwright/test';

// E2E tests run against `vite preview` (production build), bound to :4173
// by default. Playwright auto-starts the server before tests and tears
// down after. Override PLAYWRIGHT_BASE_URL to run against a different
// origin (e.g. https://lokl.txid.uk for a production smoke).
//
// Single project: chromium. lokl relies on File System Access API + OPFS
// which firefox/webkit either lack or partially implement. Cross-browser
// fallback-path coverage is a separate future cycle.

const PORT = 4173;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Storage-reset tests share OPFS root — keep serial within a worker
  workers: 1,           // OPFS root is per-origin; concurrent workers collide
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run preview -- --port ' + PORT,
        url: `http://localhost:${PORT}`,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
      },
});
```

- [ ] **Step 2: Smoke-check the config loads**

```bash
npx playwright test --list 2>&1 | head -20
```
Expected: lists 0 tests (no specs yet) without config errors. If a path or syntax error appears, fix before continuing.

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "chore(phase2): playwright.config.ts — chromium + vite preview webServer"
```

---

## Task 4 — Create storage-reset helper

**Files:** Create `tests/e2e/helpers/storage.ts`

- [ ] **Step 1: Write the helper**

Create `tests/e2e/helpers/storage.ts`:

```typescript
import type { Page } from '@playwright/test';

/**
 * Wipe every client-side persistence layer lokl touches so each test
 * starts from a known-empty state. Must be called AFTER navigating to
 * the app's origin (about:blank can't access same-origin OPFS).
 *
 * Layers reset:
 *   1. cookies
 *   2. IndexedDB (PouchDB lives here)
 *   3. OPFS (Origin Private File System)
 *   4. localStorage + sessionStorage
 *   5. ServiceWorker registrations (SW caches survive otherwise)
 */
export async function resetStorage(page: import('@playwright/test').Page): Promise<void> {
  await page.context().clearCookies();

  await page.evaluate(async () => {
    // IndexedDB
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      await Promise.all(
        dbs.map((db) =>
          db.name
            ? new Promise<void>((resolve) => {
                const req = indexedDB.deleteDatabase(db.name!);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
              })
            : Promise.resolve(),
        ),
      );
    }

    // OPFS — best-effort; not all contexts grant it.
    try {
      if (navigator.storage?.getDirectory) {
        const root = await navigator.storage.getDirectory();
        // @ts-expect-error values() is on FileSystemDirectoryHandle but not in DOM lib yet
        for await (const handle of (root as any).values()) {
          try {
            await root.removeEntry(handle.name, { recursive: true });
          } catch {
            // ignore per-entry failures
          }
        }
      }
    } catch {
      // OPFS unavailable — ignore
    }

    localStorage.clear();
    sessionStorage.clear();

    if (navigator.serviceWorker?.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => undefined)));
    }
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: zero errors (the existing `tsc --noEmit` baseline must remain green). If the project doesn't include `tests/` in its `tsconfig.json`, Playwright will type-check via its own pass when tests run; in that case `tsc --noEmit` may pass even on an error in the helper. Run Task 5 Step 4 to confirm.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/helpers/storage.ts
git commit -m "test(phase2): resetStorage() helper — wipes 5 client-side persistence layers"
```

---

## Task 5 — `notes-crud.spec.ts` (3 tests)

**Files:** Create `tests/e2e/notes-crud.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/notes-crud.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { resetStorage } from './helpers/storage';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await resetStorage(page);
  await page.reload();
});

test('create → edit → save → reload, content survives', async ({ page }) => {
  // Create a new note via the "+" / "New" button on the sidebar.
  // Adjust the locator to match the actual accessible name in lokl's
  // sidebar — common candidates: 'New file', 'New note', '+'.
  const newBtn = page.getByRole('button', { name: /new\s*(file|note)|^\+$/i }).first();
  await newBtn.click();

  // The new-file dialog has a name input + Create button.
  const nameInput = page.getByRole('textbox').first();
  await nameInput.fill('e2e-crud-test.md');
  await page.getByRole('button', { name: /create/i }).click();

  // Editor is CodeMirror; type into the focused editor surface.
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await editor.type('hello world from e2e\n\nsecond line');

  // lokl autosaves on idle; wait long enough to flush.
  await page.waitForTimeout(800);

  // Reload and assert content survived.
  await page.reload();
  await page.getByText('e2e-crud-test.md').first().click();
  await expect(page.locator('.cm-content')).toContainText('hello world from e2e');
  await expect(page.locator('.cm-content')).toContainText('second line');
});

test('edit in two contexts, second save triggers conflict UI', async ({ browser }) => {
  // Two independent BrowserContexts share the same origin's IndexedDB
  // only if they share the same persistent profile — by default they
  // don't, so simulate the conflict by writing directly into PouchDB
  // from the second context.
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto('/');
  await resetStorage(pageA);
  await pageA.reload();

  // Seed a note via the UI in ctxA.
  await pageA.getByRole('button', { name: /new\s*(file|note)|^\+$/i }).first().click();
  await pageA.getByRole('textbox').first().fill('conflict-test.md');
  await pageA.getByRole('button', { name: /create/i }).click();
  await pageA.locator('.cm-content').first().click();
  await pageA.locator('.cm-content').first().type('original content');
  await pageA.waitForTimeout(800);

  // Simulate a concurrent revision by writing a new _rev into PouchDB
  // from a fresh evaluate context — this mirrors a remote sync arriving.
  await pageA.evaluate(async () => {
    // PouchDB is exposed on window.__lokl?.db in dev builds OR we go
    // through the public API. Use the public putNote() if exported.
    // If neither is reachable, the spec falls back to opening a 2nd tab
    // and racing edits; capture as DONE_WITH_CONCERNS for the reviewer.
    const w = window as any;
    if (w.__lokl?.db) {
      const db = w.__lokl.db;
      const existing = await db.get('conflict-test.md');
      await db.put({ ...existing, content: 'concurrent remote edit', _rev: existing._rev });
    } else if (w.__lokl?.putNote) {
      // best-effort: bump revision via putNote with stale base
      await w.__lokl.putNote({ _id: 'conflict-test.md', content: 'concurrent remote edit' });
    }
  });

  // Edit again in ctxA, save — should detect conflict.
  await pageA.locator('.cm-content').first().click();
  await pageA.keyboard.press('End');
  await pageA.locator('.cm-content').first().type(' + my new edit');
  await pageA.waitForTimeout(1000);

  // ConflictPanel should surface. Its aria-label is `${t.value.conflicts.discard}: ${c._id}`
  // per src/components/ConflictPanel.tsx — match on the conflict note id.
  const conflictPanel = pageA.getByRole('button', { name: /conflict-test\.md/i }).first();
  await expect(conflictPanel).toBeVisible({ timeout: 5000 });

  await ctxA.close();
});

test('rapid-fire 10 edits, all persist without lock errors', async ({ page }) => {
  // Tests A1: putNote retry path under concurrent local writes.
  await page.getByRole('button', { name: /new\s*(file|note)|^\+$/i }).first().click();
  await page.getByRole('textbox').first().fill('rapid-fire.md');
  await page.getByRole('button', { name: /create/i }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();

  // Type 10 distinct lines with no debounce gap — exercises putNote serialization.
  for (let i = 0; i < 10; i++) {
    await editor.type(`line-${i}\n`);
  }

  // Allow last save to flush.
  await page.waitForTimeout(1200);

  // Reload and verify all 10 lines survived.
  await page.reload();
  await page.getByText('rapid-fire.md').first().click();
  for (let i = 0; i < 10; i++) {
    await expect(page.locator('.cm-content')).toContainText(`line-${i}`);
  }
});
```

- [ ] **Step 2: Run the spec**

```bash
npm run test:e2e -- tests/e2e/notes-crud.spec.ts
```
Expected: 3 tests run. They MAY fail on first run due to selector mismatch — lokl button accessible names may differ from the regex patterns guessed in the spec. If failures are purely selector-related, update the regex to match actual button text/role and re-run. If failures reveal real bugs in the safety-net logic, capture as DONE_WITH_CONCERNS and surface to the controller.

- [ ] **Step 3: Iterate selectors until all 3 pass**

For each failing test:
1. Run `npm run test:e2e -- tests/e2e/notes-crud.spec.ts --headed` to watch the browser.
2. Use `page.pause()` mid-test if needed to inspect the DOM.
3. Update the locator. Prefer role-based; text-based for unambiguous content.
4. Re-run.

The "concurrent conflict" test specifically depends on whether lokl exposes a hook on `window` for tests. If it doesn't:
- Option A: skip the eval-based remote-rev injection and use a real second context with a shared persistent profile (`browser.newContext({ storageState: 'auth.json' })` won't share IndexedDB — needs a persistent context). Use `chromium.launchPersistentContext(dir)`.
- Option B: mark the test `.skip()` with a TODO comment pointing to this plan; surface as DONE_WITH_CONCERNS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/notes-crud.spec.ts
git commit -m "test(phase2): notes-crud.spec.ts — 3 tests (CRUD + concurrent conflict + rapid-fire)"
```

---

## Task 6 — `trash-restore.spec.ts` (3 tests)

**Files:** Create `tests/e2e/trash-restore.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/trash-restore.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { resetStorage } from './helpers/storage';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await resetStorage(page);
  await page.reload();
});

async function createNote(page: import('@playwright/test').Page, name: string, body: string) {
  await page.getByRole('button', { name: /new\s*(file|note)|^\+$/i }).first().click();
  await page.getByRole('textbox').first().fill(name);
  await page.getByRole('button', { name: /create/i }).click();
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await editor.type(body);
  await page.waitForTimeout(800);
}

test('delete note → disappears from main list, appears in Trash', async ({ page }) => {
  await createNote(page, 'trash-me.md', 'doomed content');

  // Open the sidebar context menu on the note. lokl uses ContextMenu.tsx
  // — right-click on the file row should open it.
  const row = page.getByText('trash-me.md').first();
  await row.click({ button: 'right' });

  // Trash / Delete entry from context menu.
  await page.getByRole('button', { name: /^delete$|trash/i }).click();

  // Note should disappear from main file list.
  await expect(page.getByText('trash-me.md')).toHaveCount(0);

  // Trash view: find the Trash navigation button or section.
  // lokl exposes Trash via Sidebar — adjust the selector after first run.
  await page.getByRole('button', { name: /trash|휴지통/i }).first().click();
  await expect(page.getByText('trash-me.md').first()).toBeVisible();
});

test('restore from Trash → reappears in main list with original content', async ({ page }) => {
  await createNote(page, 'restore-me.md', 'survive the trash');
  await page.getByText('restore-me.md').first().click({ button: 'right' });
  await page.getByRole('button', { name: /^delete$|trash/i }).click();

  await page.getByRole('button', { name: /trash|휴지통/i }).first().click();
  await page.getByText('restore-me.md').first().click({ button: 'right' });
  await page.getByRole('button', { name: /restore|복원/i }).click();

  // Back to main view — file should reappear with content intact.
  await page.getByRole('button', { name: /notes|files|메모|파일/i }).first().click();
  await page.getByText('restore-me.md').first().click();
  await expect(page.locator('.cm-content')).toContainText('survive the trash');
});

test('permanently delete from Trash → IndexedDB row gone', async ({ page }) => {
  await createNote(page, 'perma-delete.md', 'gone forever');
  await page.getByText('perma-delete.md').first().click({ button: 'right' });
  await page.getByRole('button', { name: /^delete$|trash/i }).click();

  await page.getByRole('button', { name: /trash|휴지통/i }).first().click();
  await page.getByText('perma-delete.md').first().click({ button: 'right' });

  // Permanent delete from trash UI (usually a second-stage confirmation).
  await page.getByRole('button', { name: /delete forever|영구\s*삭제|permanent/i }).click();

  // Verify it's gone from trash list too.
  await expect(page.getByText('perma-delete.md')).toHaveCount(0);

  // Verify the IndexedDB row is actually gone (not just trashed: true).
  const docExists = await page.evaluate(async () => {
    const w = window as any;
    if (!w.__lokl?.db) return null; // signal "can't check"
    try {
      await w.__lokl.db.get('perma-delete.md');
      return true;
    } catch {
      return false;
    }
  });
  // If we can't introspect (no debug hook), accept null but flag.
  if (docExists === null) {
    test.info().annotations.push({ type: 'note', description: 'window.__lokl.db unavailable; UI-only check used' });
  } else {
    expect(docExists).toBe(false);
  }
});
```

- [ ] **Step 2: Run + iterate selectors**

```bash
npm run test:e2e -- tests/e2e/trash-restore.spec.ts --headed
```
Same iteration pattern as Task 5: update locators to match real lokl UI labels. ContextMenu and trash navigation are the two unknowns.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/trash-restore.spec.ts
git commit -m "test(phase2): trash-restore.spec.ts — 3 tests (delete → trash → restore / permanent)"
```

---

## Task 7 — `backup.spec.ts` (3 tests)

**Files:** Create `tests/e2e/backup.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/backup.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { resetStorage } from './helpers/storage';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await resetStorage(page);
  await page.reload();
});

async function createNote(page: import('@playwright/test').Page, name: string, body: string) {
  await page.getByRole('button', { name: /new\s*(file|note)|^\+$/i }).first().click();
  await page.getByRole('textbox').first().fill(name);
  await page.getByRole('button', { name: /create/i }).click();
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await editor.type(body);
  await page.waitForTimeout(800);
}

test('export backup, clear vault, import backup → all notes restored', async ({ page }) => {
  await createNote(page, 'a.md', 'first');
  await createNote(page, 'b.md', 'second');
  await createNote(page, 'c.md', 'third');

  // Trigger export via the public API — UI path is the Settings panel
  // "Export JSON" button but the public surface is more deterministic.
  const exported = await page.evaluate(async () => {
    const w = window as any;
    if (!w.__lokl?.exportJSON) {
      // Fall back to UI: open Settings → Export JSON. Returns a Blob via download.
      throw new Error('window.__lokl.exportJSON not exposed — use Settings UI path');
    }
    const blob: Blob = await w.__lokl.exportJSON();
    return await blob.text();
  });

  expect(JSON.parse(exported).notes.length).toBeGreaterThanOrEqual(3);

  // Wipe the vault.
  await resetStorage(page);
  await page.reload();
  await expect(page.getByText('a.md')).toHaveCount(0);

  // Import via public API.
  await page.evaluate(async (json: string) => {
    const w = window as any;
    const blob = new Blob([json], { type: 'application/json' });
    await w.__lokl.importJSON(blob);
  }, exported);

  // Reload + assert all three reappear.
  await page.reload();
  for (const name of ['a.md', 'b.md', 'c.md']) {
    await expect(page.getByText(name).first()).toBeVisible();
  }
});

test('export with note in trash, import elsewhere → trash status preserved', async ({ page }) => {
  await createNote(page, 'live.md', 'visible');
  await createNote(page, 'trashed.md', 'soft-deleted');

  // Trash the second note.
  await page.getByText('trashed.md').first().click({ button: 'right' });
  await page.getByRole('button', { name: /^delete$|trash/i }).click();

  // Export — exportJSON should include the trashed doc.
  const exported = await page.evaluate(async () => {
    const w = window as any;
    const blob: Blob = await w.__lokl.exportJSON();
    return await blob.text();
  });

  const payload = JSON.parse(exported);
  const trashedDoc = payload.notes.find((n: { _id: string }) => n._id === 'trashed.md');
  expect(trashedDoc).toBeDefined();
  expect(trashedDoc.trashed).toBe(true); // exact field name from src/lib/db.ts NoteDoc

  // Wipe + re-import + verify trashed.md lands in trash, not main list.
  await resetStorage(page);
  await page.reload();
  await page.evaluate(async (json: string) => {
    const w = window as any;
    const blob = new Blob([json], { type: 'application/json' });
    await w.__lokl.importJSON(blob);
  }, exported);

  await page.reload();
  await expect(page.getByText('live.md').first()).toBeVisible();
  await expect(page.getByText('trashed.md')).toHaveCount(0);  // not in main list

  await page.getByRole('button', { name: /trash|휴지통/i }).first().click();
  await expect(page.getByText('trashed.md').first()).toBeVisible();  // in trash list
});

test('import malformed backup → user-facing error, vault unchanged', async ({ page }) => {
  await createNote(page, 'sentinel.md', 'must survive bad import');

  const result = await page.evaluate(async () => {
    const w = window as any;
    const bad = new Blob(['{"not":"a backup"}'], { type: 'application/json' });
    try {
      await w.__lokl.importJSON(bad);
      return { threw: false };
    } catch (e) {
      return { threw: true, message: e instanceof Error ? e.message : String(e) };
    }
  });

  expect(result.threw).toBe(true);
  expect(result.message).toMatch(/invalid|backup/i);

  // Vault is intact.
  await page.reload();
  await expect(page.getByText('sentinel.md').first()).toBeVisible();
  await page.getByText('sentinel.md').first().click();
  await expect(page.locator('.cm-content')).toContainText('must survive bad import');
});
```

- [ ] **Step 2: Run + iterate**

```bash
npm run test:e2e -- tests/e2e/backup.spec.ts --headed
```

Two unknowns:
1. **`window.__lokl.exportJSON` / `importJSON` hook** — if not exposed, the test must drive Settings UI ("Export" button → wait for download → save blob). If it IS exposed (look in `src/main.tsx` for `window.__lokl = ...`), the public-API path is much cleaner.
2. **Trash field name** — the spec assumes `doc.trashed === true`. Cross-check with `src/lib/db.ts` `NoteDoc` interface — if Phase 1 used `deletedAt: number | null` instead, update the assertion.

If `window.__lokl` hooks aren't present, add them in a separate small commit (`feat(phase2): expose internal API on window for e2e harness`) GATED to non-production builds: `if (import.meta.env.MODE === 'test' || ...) window.__lokl = { db, exportJSON, importJSON, putNote }`. Surface this addition as DONE_WITH_CONCERNS since it touches production code.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/backup.spec.ts
git commit -m "test(phase2): backup.spec.ts — 3 tests (round-trip + trash preservation + malformed input)"
```

---

## Task 8 — Update `.gitignore` and final verification

**Files:** Modify `.gitignore`

- [ ] **Step 1: Append Playwright artifacts**

Open `.gitignore`. Append:

```
# Playwright (Phase 2 E2E)
/playwright-report/
/test-results/
```

If those lines already exist (unlikely), skip.

- [ ] **Step 2: Run the full E2E suite end-to-end**

```bash
npm run test:e2e
```
Expected: 9 tests, all passing (or fewer if `.skip()` was applied per Task 5 Step 3 fallback). Capture pass/fail counts.

- [ ] **Step 3: Re-run vitest baseline — must stay green**

```bash
npm test
```
Expected: same count as Task 0 baseline. No regression from include-glob tightening.

- [ ] **Step 4: Commit and push**

```bash
git add .gitignore
git commit -m "chore(phase2): ignore playwright-report/ and test-results/"
git push -u origin feature/phase2-e2e-playwright
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --title "test(phase2): Playwright E2E test infrastructure (first cycle)" --body "$(cat <<'EOF'
## Summary
First Phase 2 cycle — adds Playwright + chromium real-browser harness verifying Phase 1 safety nets.

- 9 new E2E tests across 3 specs:
  - **notes-crud** (3) — A1 putNote retry + A2 conflict detection + CRUD round-trip
  - **trash-restore** (3) — B1/B2 soft-delete → trash → restore → permanent delete
  - **backup** (3) — JSON export/import round-trip + trash metadata preservation + malformed-input error path
- `vitest.config.ts` include glob tightened to `tests/unit/**/*.test.ts` (functional no-op, prevents future capture of `.test.ts` files in `tests/e2e/`).
- New scripts: `test:e2e` and `test:e2e:install`.

## Out of scope (deferred to future cycles)
- Lightning auth E2E (cross-origin cookie limitation)
- Sync (PouchDB → CouchDB) E2E (remote setup required)
- a11y / perf / error monitoring (separate workstreams from Phase 1 spec)
- CI workflow (`.github/workflows/e2e.yml`) — wire up after specs stabilize
- firefox / webkit fallback-path coverage
- mobile chromium

## Test plan
- [x] `npm test` (vitest) — unchanged baseline
- [x] `npm run build` — clean
- [x] `npm run test:e2e` — N/9 pass (capture actuals)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes (already applied)

- **Spec coverage** — every spec section maps to tasks: install (Task 1), vitest include (Task 2), playwright.config (Task 3), resetStorage helper (Task 4), 9 specs (Tasks 5-7), .gitignore (Task 8). Out-of-scope items explicitly reflected in PR body.
- **Placeholder scan** — no TBD/TODO in the plan. Every test file is shown in full. Selector iteration is described concretely with fallback options (skip + DONE_WITH_CONCERNS) when production hooks aren't present.
- **Type consistency** — `resetStorage(page: Page)` signature consistent across all callsites. `window.__lokl.exportJSON` / `importJSON` / `db` / `putNote` referenced uniformly in Tasks 5-7. `NoteDoc.trashed` field name flagged for cross-check against `src/lib/db.ts` since Phase 1 might use `deletedAt` instead.
- **Selector fragility** — every test uses regex patterns (`/new\s*(file|note)|^\+$/i`) to tolerate label variation; iteration step is built into Tasks 5-7. Real-DOM grounding is the unavoidable cost of E2E.
- **Production touch escalation** — if `window.__lokl` doesn't exist, plan calls for a gated debug hook in a separate commit, surfaced as DONE_WITH_CONCERNS to the controller (per spec's "production code stays untouched in this cycle" intent — controller decides whether the small gated hook is acceptable for the test goal).
