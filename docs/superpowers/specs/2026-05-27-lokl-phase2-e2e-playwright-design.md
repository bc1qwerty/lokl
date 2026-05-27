# lokl Data Safety Phase 2 — Playwright E2E Test Infrastructure

**Date:** 2026-05-27
**Project:** lokl (Preact + Vite + browser-only PKM, deploys to GitHub Pages)
**Depends on:** Phase 1 (commit `64e591c`, merged 2026-05-25) — A1-A4 conflict safety + B1-B4 Trash/backup workstreams
**Scope:** First Phase 2 cycle. Adds a real-browser test harness (Playwright + chromium) that verifies Phase 1 safety nets against actual File System Access API + OPFS + IndexedDB. Out-of-scope future cycles (auth E2E, sync E2E, a11y audit, perf benchmarks, error monitoring) are explicitly deferred.

## Goal

Phase 1 added 65 vitest unit tests that exercise the storage and safety logic in isolation (`tests/unit/**`). The Phase 1 spec explicitly excluded `src/lib/fs.ts` from coverage because jsdom cannot simulate the File System Access API — and the file was deferred to "task C4/C5 with a real browser harness." This spec realizes that deferred work: install Playwright, point it at a real chromium browser running against `vite preview`, and lock in the user-facing flows that exercise the Phase 1 safety nets end-to-end (note CRUD with concurrent edits, soft-delete → trash → restore, backup export → re-import round-trip).

## Non-goals

- **Lightning auth E2E.** The login flow depends on `*.txid.uk` session cookies that don't cross-origin into a `localhost:4173` Playwright session. Either skip auth or stub it for tests that need a "logged-in" user — for this first cycle, choose vaults that don't require auth.
- **Sync (PouchDB → CouchDB) E2E.** Needs a real or mocked remote CouchDB. Deferred to a dedicated cycle that decides between a Dockerized CouchDB for CI or a fake adapter.
- **Accessibility audit, performance benchmarks, error monitoring.** All listed in Phase 1 spec under "Out of scope (Phase 2/3)" — each is its own cycle.
- **Auto-sweeper TTL E2E.** The 30-day trash sweeper is time-dependent; Phase 1 already covers it in `tests/unit/backup.test.ts` via injected clock. Re-testing in a real browser provides little additional confidence at high cost (need to mock `Date.now()` cross-context).
- **Service Worker E2E.** lokl ships a PWA SW. SW cache invalidation is a known fragile area but out of scope for this cycle.
- **Cross-browser coverage.** chromium only. firefox/webkit lack the File System Access API entirely; testing them would require a fork of every spec to exercise only the OPFS/IndexedDB fallback path. Worth a separate cycle when the fallback path matures.
- **CI integration.** Local + manual runs only in this cycle. GitHub Actions workflow lives in a follow-up PR so this cycle stays focused on spec definitions vs CI ergonomics.

## Architecture

### Test stack
- **`@playwright/test`** ^1.49 (devDependency) — only browser binary needed is chromium.
- **`vite preview`** — production-build server bound to `:4173`. Playwright `webServer` config auto-starts it before tests and tears down after.
- **Single project: `chromium`** with `devices['Desktop Chrome']`. Mobile chromium intentionally omitted from this cycle (mobile UX has fewer File System Access API code paths; revisit when mobile-specific bugs surface).

### Directory layout
```
lokl/
├── playwright.config.ts                  (new — preview server + chromium project)
├── tests/
│   ├── unit/**/*.test.ts                 (existing — vitest, unchanged)
│   └── e2e/
│       ├── helpers/
│       │   └── storage.ts                (new — resetStorage(page) for test isolation)
│       ├── notes-crud.spec.ts            (new — A1/A2: putNote retry, conflict detection)
│       ├── trash-restore.spec.ts         (new — B1/B2: deleteNote → trash → restore)
│       └── backup.spec.ts                (new — Phase 1 backup round-trip + trash metadata preservation)
└── .github/workflows/                    (untouched this cycle)
```

### Why `tests/e2e/` and not a sibling directory
- Mirrors `lib.txid.uk-next` pattern (`tests/e2e/` for Playwright, `tests/unit/` for vitest) — same mental model across repos.
- vitest config currently has `include: ['tests/**/*.test.ts']` — Playwright specs use `*.spec.ts` naming, but to be safe against future `*.test.ts` Playwright additions, we tighten the vitest glob to `tests/unit/**/*.test.ts`.

## Test isolation

Browser-only PKM means all state lives in the client. Without aggressive cleanup, tests pollute each other through OPFS files, IndexedDB rows, localStorage, cookies, or registered service workers. The `resetStorage(page)` helper handles all five in one call:

```typescript
// tests/e2e/helpers/storage.ts
export async function resetStorage(page: Page): Promise<void> {
  await page.context().clearCookies();

  await page.evaluate(async () => {
    // IndexedDB
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) {
          await new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(db.name!);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          });
        }
      }
    }

    // OPFS
    if (navigator.storage?.getDirectory) {
      try {
        const root = await navigator.storage.getDirectory();
        for await (const handle of (root as any).values()) {
          await root.removeEntry(handle.name, { recursive: true });
        }
      } catch {
        // OPFS may not be granted on the about:blank context — ignore.
      }
    }

    // localStorage + sessionStorage
    localStorage.clear();
    sessionStorage.clear();

    // ServiceWorker (SW caches survive otherwise)
    if (navigator.serviceWorker?.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) await reg.unregister();
    }
  });
}
```

Each `test.beforeEach`:
```typescript
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await resetStorage(page);
  await page.reload();  // fresh app state without registered SW or cached storage
});
```

### Why `goto('/')` before clear
`page.evaluate(...)` only runs against a real document — `about:blank` won't have access to a same-origin OPFS root. Navigating to the app first establishes the origin; cleanup then runs; reload starts the test from a guaranteed-empty state.

## Per-spec coverage

### `notes-crud.spec.ts` — exercises A1 (putNote retry) + A2 (conflict detection)

| Test | What it locks in |
|---|---|
| `create → edit → save → reload, content survives` | Basic OPFS round-trip; baseline that storage is wired up |
| `edit in two tabs, second save triggers conflict UI` | A2 conflict detection real-DOM path. Opens a second `BrowserContext`, edits same note from both, asserts ConflictPanel appears in the loser tab |
| `rapid-fire 10 saves, all succeed without lock errors` | A1 putNote retry — concurrent local writes |

### `trash-restore.spec.ts` — exercises B1 (deletedAt field) + B2 (soft-delete) + restore path

| Test | What it locks in |
|---|---|
| `delete note → disappears from main list, appears in Trash` | B2 soft-delete moves note to trash, not deleted from storage |
| `restore from Trash → reappears in main list with original content` | restore path round-trip |
| `permanently delete from Trash → cannot be restored` | hard-delete path; assert no IndexedDB row remains via `page.evaluate` |

### `backup.spec.ts` — exercises backup.ts round-trip + Phase 1 trash metadata preservation

| Test | What it locks in |
|---|---|
| `export backup, clear vault, import backup → all notes restored` | full round-trip, asserts content equality |
| `export with note in trash, import elsewhere, trash status preserved` | Phase 1 B1: `deletedAt` field survives JSON round-trip |
| `import malformed backup → user-facing error, vault unchanged` | error path: assert toast or banner, assert IndexedDB unchanged |

## Files to modify or create

| File | Action | Lines | Responsibility |
|---|---|---|---|
| `package.json` | Modify | +3 | add `@playwright/test` devDep; add `test:e2e` + `test:e2e:install` scripts |
| `vitest.config.ts` | Modify | 1 | tighten `include` from `tests/**/*.test.ts` to `tests/unit/**/*.test.ts` |
| `playwright.config.ts` | Create | ~40 | preview server + chromium project + baseURL |
| `tests/e2e/helpers/storage.ts` | Create | ~50 | `resetStorage(page)` |
| `tests/e2e/notes-crud.spec.ts` | Create | ~90 | 3 tests |
| `tests/e2e/trash-restore.spec.ts` | Create | ~80 | 3 tests |
| `tests/e2e/backup.spec.ts` | Create | ~110 | 3 tests |
| `.gitignore` | Modify | +2 | `playwright-report/`, `test-results/` |

Total: 9 tests, ~370 lines net new.

## Selector strategy

Prefer **role-based** locators (`page.getByRole('button', { name: 'New note' })`) over CSS or testid selectors:
- Survives styling refactors and class renames
- Doubles as a soft a11y check — if Playwright can't find the role, screen readers can't either
- testid is a fallback for cases where the same role appears multiple times and naming-by-text would be brittle

If a flow needs a testid, add `data-testid="..."` to the production component and reference it from the spec. Avoid generic `data-test-id` patterns or relying on CSS class names.

## Dependencies

- `@playwright/test` ^1.49 (latest stable, supports Node 22)
- Chromium browser binary downloaded by `npx playwright install chromium` (~150MB, gitignored)
- No production runtime dependencies added.

## Rollback safety

- Purely additive — production code is **not touched**. The `vitest.config.ts` `include` glob is tightened from `tests/**/*.test.ts` to `tests/unit/**/*.test.ts`, but all existing files live under `tests/unit/` so the resolved file set is identical before and after.
- Revert by deleting `tests/e2e/`, `playwright.config.ts`, and the new package.json scripts; restoring the vitest include glob.
- `npm test` (vitest) behavior is unchanged after the glob tightening.

## Verification

Local:
```
npm install
npx playwright install chromium
npm run build
npm run test:e2e
```
Expected: 9/9 pass; no leaked storage; no service worker warnings.

Pre-existing `npm test` (vitest) must remain green.

## Out-of-scope (future cycles)

- **CI workflow** (`.github/workflows/e2e.yml`) — wire into PR gates once the spec set stabilizes for a week.
- **Auth E2E** — needs decision on stubbing strategy vs reverse-proxy session cookie.
- **Sync E2E** — needs Dockerized CouchDB or fake PouchDB adapter.
- **Mobile chromium** — revisit when mobile-specific user reports surface.
- **firefox / webkit fallback path** — separate spec set that exercises only the OPFS-less code path.
- **a11y / perf / error monitoring** — Phase 1 explicitly listed these as separate cycles.
