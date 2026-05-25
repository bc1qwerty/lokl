# Lokl — Data Safety Hardening (Phase 1)

**Date:** 2026-05-25
**Status:** Approved design
**Branch:** `feature/data-safety-phase1`
**Author:** brainstorming session with seo

## Context

Lokl (`/home/seo/lokl/`, https://github.com/bc1qwerty/lokl) is a browser-based, offline-first personal knowledge base. Since the initial release (2026-03-29), it has grown to include PouchDB (IndexedDB) as the primary store, optional CouchDB sync, Lightning login (`txid-auth` SDK), a subscription plan for sync, eight UI languages, DOMPurify XSS sanitization, and a force-directed graph view.

The next step is **production readiness**, scoped to **data safety and the tests that prove it**. Subsequent phases will cover error monitoring/observability and CI/CD automation.

## Architecture confirmation

After auditing `src/app.tsx`, `src/lib/{db,sync,store,fs,migrate}.ts`, the source-of-truth is already PouchDB. `vault.value = { mode: 'pouchdb' }` is set after `loadNotes()`. The File System Access API (`fs.ts`) is no longer an active editing channel — it survives only as a migration entry point inside `migrate.ts` (`importFromFSAA` / `exportToFSAA`).

The `native` / `fallback` modes in `types.ts` and the `writeFile` / `createFile` / `deleteFile` paths in `fs.ts` are dead code. They will be removed as part of this phase.

## Risks addressed

Source code audit surfaced these concrete risks. Phase 1 closes all of them:

1. **putNote race** (`db.ts:81-113`) — `get` → `put` window allows 409 on concurrent autosave + sync. No retry, no surface.
2. **No conflict resolution UI** (`sync.ts`) — PouchDB stores both revisions; user has no way to see or resolve.
3. **No trash + no restore** (`db.ts:116-124`) — soft-delete only, no recovery path; sync propagates deletions immediately.
4. **No backup / export channel** — only ad-hoc folder export via migration helper. No JSON dump, no restore.
5. **Non-atomic writes** (`migrate.ts:65-71`, `fs.ts:220-232`) — partial write on crash; no temp+rename.
6. **No quota handling** — `QuotaExceededError` silently fails save.
7. **Silent save failures** (`app.tsx:92-95, 258-263`) — `console.error` only; user has no feedback.
8. **No beforeunload guard** — dirty state can be lost on tab close during the 1s autosave debounce.
9. **Non-atomic rename** (`app.tsx:185-206`) — put-new → delete-old can leave duplicates on partial failure.
10. **Dead code drift** (`fs.ts` write paths, `VaultState.mode` 'native'/'fallback') — invites future bugs.

## Approach

Single-cycle, sequential workstreams with a test gate between each:

> **D (test infra) → A (conflicts) → B (trash + backup) → C (atomicity + quota) → dead code cleanup → CI activation**

Each workstream lands its own tests before the next begins. No parallel branches.

## Workstream D — Test infrastructure

**Tooling**
- Vitest (Vite 6 native, no extra build step)
- `pouchdb-adapter-memory` for isolated in-memory DBs per test
- No component testing library this phase (lib-only). UI flows go to Playwright in Phase 2.

**npm scripts**
```
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

**Test layout** (`tests/unit/`)
| File | Coverage |
|---|---|
| `db.test.ts` | getNote / putNote / deleteNote / listNotes, watchChanges, concurrent putNote race, 409 retry, soft-delete idempotence |
| `sync.test.ts` | mock remote (in-memory PouchDB), state transitions (offline/syncing/synced/error), conflict detection |
| `search.test.ts` | index / search / removeFromIndex / clearIndex; prefix + fuzzy |
| `markdown.test.ts` | wiki-link parse, backlink index, tag extraction, frontmatter |
| `migrate.test.ts` | importFromFSAA / exportToFSAA via mock FSAA over memory |
| `theme.test.ts` | dark/light toggle, persistence |
| `auth.test.ts` | anonymous/polling/authenticated state |
| `backup.test.ts` | JSON dump round-trip, ZIP creation |
| `quota.test.ts` | estimate monitor thresholds |

**Coverage gate**: lib/ ≥ 80 % statements. Enforced in CI.

**CI** (`.github/workflows/ci.yml`)
- Trigger: `push`, `pull_request`
- Steps: install → typecheck → test → build
- Failure blocks merge.

A separate `deploy.yml` runs on `tags/v*` push and deploys `dist/` to gh-pages. Push to `main` no longer deploys automatically.

## Workstream A — Conflict safety

### A1. putNote retry

`db.ts`:

```ts
const MAX_RETRY = 3;
export async function putNote(id: string, content: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const existing = await getNote(id);  // null if 404
    const now = new Date().toISOString();
    const doc: NoteDoc = {
      _id: id,
      _rev: existing?._rev,
      content,
      title: extractTitle(content, id),
      tags: extractTags(content),
      links: extractLinks(content),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      await getDB().put(doc);
      return;
    } catch (e: any) {
      if (e.status === 409 && attempt < MAX_RETRY - 1) continue;
      throw e;
    }
  }
}
```

Caller (`app.tsx`) catches the throw and surfaces a toast (see C5).

### A2. Conflict detection

`db.ts` adds:

```ts
export async function listConflicts(): Promise<NoteDoc[]> {
  const result = await getDB().allDocs({ include_docs: true, conflicts: true });
  return result.rows
    .map(r => r.doc!)
    .filter(d => d && (d as any)._conflicts && !d.trashed);
}
```

`sync.ts` extends the existing `.on('change', ...)` handler to call a callback whenever a conflicted doc is observed.

### A3. Resolution policy — keep both + notify

Default and only policy for Phase 1.

When a conflict is detected:
1. PouchDB already designates a winning revision deterministically (by revision depth, then lexicographic `_rev`). Read the **losing** revision via `getDB().get(id, { rev: conflictRev })`.
2. Copy the losing content to a sibling note with id `${original_id_without_md} (conflict-${YYYY-MM-DD-HHmmss}).md` and `conflictOf: original_id`.
3. Remove the losing revision from `_conflicts` via `getDB().remove(id, conflictRev)`.
4. A toast fires once per detection event: "Conflict resolved — both versions kept. Open Conflicts panel." The toast carries an action that opens `ConflictPanel`.

No automatic merging. No "last write wins" by timestamp. The user's data is never silently discarded.

### A4. ConflictPanel component

`src/components/ConflictPanel.tsx`:
- Listed in Sidebar near Trash.
- Lists notes with `conflictOf` set.
- Actions: Open both, Keep this one only (deletes the other to Trash), Merge manually (opens both in split tabs).

## Workstream B — Trash + backup

### B1. NoteDoc extension

`db.ts`:

```ts
export interface NoteDoc {
  _id: string;
  _rev?: string;
  content: string;
  title: string;
  tags: string[];
  links: string[];
  createdAt: string;
  updatedAt: string;
  trashed?: boolean;
  trashedAt?: string;       // ISO 8601
  conflictOf?: string;      // present on kept-both copies
  deleted?: boolean;        // legacy — migrated on first load
}
```

`listNotes()` excludes `trashed === true` and `conflictOf` notes (the latter appear only in ConflictPanel).

### B2. deleteNote → trash

```ts
export async function deleteNote(id: string): Promise<void> {
  const doc = await getNote(id);
  if (!doc) return;
  await getDB().put({ ...doc, trashed: true, trashedAt: new Date().toISOString() });
}

export async function restoreNote(id: string): Promise<void> {
  const doc = await getDB().get(id);  // bypasses listNotes filter
  delete doc.trashed;
  delete doc.trashedAt;
  await getDB().put(doc);
}

export async function purgeNote(id: string): Promise<void> {
  const doc = await getDB().get(id);
  await getDB().remove(doc);
}
```

### B3. Sweeper (30-day retention)

Runs once on app start:

```ts
async function sweepTrash(): Promise<void> {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const result = await getDB().allDocs({ include_docs: true });
  for (const row of result.rows) {
    const doc = row.doc as NoteDoc | undefined;
    if (!doc?.trashed || !doc.trashedAt) continue;
    if (Date.parse(doc.trashedAt) < cutoff) {
      await getDB().remove(doc);
    }
  }
}
```

### B4. Legacy migration

Same sweeper pass also handles legacy `deleted: true` docs:

```ts
if (doc.deleted && !doc.trashed) {
  await getDB().put({ ...doc, trashed: true, trashedAt: doc.updatedAt, deleted: undefined });
}
```

### B5. TrashPanel component

`src/components/TrashPanel.tsx`:
- Entry: Sidebar bottom — "🗑 Trash (N)"
- Shows path, deletedAt, "Restore" + "Delete forever" actions
- "Empty trash" bulk action

### B6. Backup library (`src/lib/backup.ts`)

```ts
export interface BackupPayload {
  version: 1;
  exportedAt: string;
  notes: NoteDoc[];  // includes trashed for full fidelity
}

export async function exportJSON(): Promise<Blob>;
export async function exportZIP(): Promise<Blob>;  // markdown only, ignores trash
export async function importJSON(blob: Blob): Promise<{ imported: number; conflicts: number }>;
```

Import uses A3 keep-both policy: any id collision creates a sibling `(conflict-YYYY-...)` doc.

### B7. UI integration

`SettingsPanel.tsx` gains a new "Data" section:
- Export — JSON / ZIP buttons (auto-named `lokl-backup-YYYY-MM-DD.{json,zip}`)
- Import — file picker accepting `.json`
- "Empty trash now" shortcut

## Workstream C — Atomicity + quota

### C1. exportToFSAA atomic write

`migrate.ts`:

```ts
const TMP_SUFFIX = '.lokl-tmp';
async function atomicWrite(dir: FileSystemDirectoryHandle, name: string, content: string) {
  const tmp = `${name}${TMP_SUFFIX}`;
  const tmpHandle = await dir.getFileHandle(tmp, { create: true });
  const w = await tmpHandle.createWritable();
  await w.write(content);
  await w.close();
  // FSAA move: Chromium 110+
  if ((tmpHandle as any).move) {
    await (tmpHandle as any).move(name);
  } else {
    // Fallback: re-read tmp, write to final, then delete tmp
    const data = await (await tmpHandle.getFile()).text();
    const finalHandle = await dir.getFileHandle(name, { create: true });
    const fw = await finalHandle.createWritable();
    await fw.write(data);
    await fw.close();
    await dir.removeEntry(tmp);
  }
}
```

### C2. Quota error handling

Wrap `putNote` calls in `app.tsx`:

```ts
try {
  await putNote(path, content);
} catch (e: any) {
  if (e?.name === 'QuotaExceededError') {
    toast.error('Storage full', {
      action: { label: 'Empty trash', handler: emptyTrash },
    });
  } else {
    toast.error(`Save failed: ${e?.message ?? 'unknown'}`);
  }
  throw e;
}
```

### C3. Storage estimate monitor (`src/lib/quota.ts`)

```ts
export async function checkQuota(): Promise<{ usage: number; quota: number; ratio: number }>;
export function startQuotaMonitor(onChange: (ratio: number) => void): () => void;
```

- Polls `navigator.storage.estimate()` on app start and every 1h.
- Ratio > 0.8: yellow banner. > 0.95: red banner.
- Banner is a persistent UI element, not a toast — it renders only when the threshold is exceeded and disappears when ratio drops (e.g. after Empty Trash). No re-fire dedup needed since it is declarative state, not a queue event.

### C4. beforeunload guard

`app.tsx`:

```ts
useEffect(() => {
  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (isDirty.value || saveStatus.value === 'saving') {
      e.preventDefault();
      e.returnValue = '';
    }
  }
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}, []);
```

### C5. Toast system (`src/lib/toast.ts` + `src/components/Toast.tsx`)

Signal-driven queue:

```ts
interface Toast {
  id: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  action?: { label: string; handler: () => void };
  ttl?: number;  // ms; undefined = sticky
}

export const toasts = signal<Toast[]>([]);
export function toast(t: Omit<Toast, 'id'>): void;
toast.info / .success / .warning / .error  // shortcuts
```

`<ToastContainer />` mounted in `App` root.

### C6. Save failure surfacing

- `app.tsx:82-95` (autosave) → catch → `toast.error`
- `app.tsx:255-263` (Cmd+S) → add `.catch(e => toast.error(...))`
- All `console.error` survival in current code stays; toasts are additive, not a replacement.

### C7. Atomic rename

`app.tsx:185-206` `handleDoRename`:

```ts
async function atomicRename(oldPath: string, newPath: string): Promise<void> {
  const note = await getNote(oldPath);
  if (!note) throw new Error('Source not found');
  // 1. Reserve newPath; abort if it already exists.
  const existing = await getNote(newPath);
  if (existing) throw new Error('Destination exists');
  try {
    await putNote(newPath, note.content);
  } catch (e) {
    throw new Error(`Rename failed at copy step: ${e}`);
  }
  try {
    await deleteNote(oldPath);
  } catch (e) {
    // Rollback: remove newPath copy
    try { await purgeNote(newPath); } catch {}
    throw new Error(`Rename failed at delete step (rolled back): ${e}`);
  }
}
```

The Toast system surfaces any rollback. Tests cover both partial-failure branches.

## Dead code cleanup (after C)

| File | Action |
|---|---|
| `src/lib/fs.ts` | Remove `writeFile`, `createFile`, `deleteFile`, `resolveFileHandle`. Keep only `openDirectory` (used by migrate import flow) and supporting helpers. |
| `src/types.ts` | Simplify `VaultState.mode` to `'pouchdb'` only. Remove `'native'` / `'fallback'` branches. Keep `handle?` field only on the migration import dialog state, not on app-wide `vault`. |
| `src/lib/store.ts` | Remove `isReadOnly` computed (always false now). Replace consumers with literal `false` then delete. |
| `app.tsx` | Replace `if (isReadOnly.value) return;` early-exits with assertion / delete. |
| `db.ts` | Remove `_id !== '_settings'` filter in `listNotes` (no `_settings` doc is ever written). |

Each removal lands as a separate commit with its own test pass.

## CI activation

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main, 'feature/**']
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run build  # already runs tsc --noEmit
      - run: npm run test
      - run: npm run test:coverage -- --reporter=text-summary
```

Coverage threshold is enforced in `vitest.config.ts`, not in the workflow:

```ts
// vitest.config.ts
test: {
  coverage: {
    provider: 'v8',
    include: ['src/lib/**/*.ts'],
    thresholds: { statements: 80, branches: 70, functions: 80, lines: 80 },
  },
},
```

If coverage drops below threshold, vitest exits non-zero and the CI job fails.

`.github/workflows/deploy.yml`:

```yaml
on:
  push:
    tags: ['v*']
```

Existing `gh-pages` script (`npx gh-pages -d dist`) stays.

## Type definition delta

`src/types.ts` will be updated to:

```ts
export interface VaultState {
  mode: 'pouchdb';
  name: string;
}
```

`src/lib/db.ts` `NoteDoc` extended with `trashed`, `trashedAt`, `conflictOf`, legacy `deleted` (migrated).

## Deliverable checklist

- [ ] `tests/unit/*.test.ts` ~30 tests across 9 files
- [ ] `vitest.config.ts`
- [ ] `package.json` devDeps: `vitest`, `@vitest/coverage-v8`, `pouchdb-adapter-memory`
- [ ] `package.json` deps: `jszip`
- [ ] `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`
- [ ] `src/components/ConflictPanel.tsx`
- [ ] `src/components/TrashPanel.tsx`
- [ ] `src/components/Toast.tsx` + `src/lib/toast.ts`
- [ ] `src/lib/backup.ts`
- [ ] `src/lib/quota.ts`
- [ ] `src/lib/db.ts` retry, conflict listing, trash helpers, sweeper
- [ ] `src/lib/sync.ts` conflict callback
- [ ] `src/lib/migrate.ts` atomic write
- [ ] `src/app.tsx` toast wiring, beforeunload, atomic rename, Cmd+S catch
- [ ] `src/lib/fs.ts`, `src/types.ts`, `src/lib/store.ts` dead-code purge
- [ ] i18n strings for all new UI in 8 languages

## Success criteria

| Metric | Target |
|---|---|
| Concurrent putNote (100 parallel) data loss | 0 events (test) |
| 30-day-old trashed notes recoverable | 100 % until purge |
| Export → Import JSON round-trip note equality | 100 % (test) |
| lib/ statement coverage | ≥ 80 % |
| CI green deploy on tag push | works end-to-end |
| Save failures surfaced to user | 100 % (no silent failures) |
| exportToFSAA partial-write on crash | 0 % (atomic via tmp + move) |

## Out of scope (Phase 2 / 3)

- Error monitoring (Sentry-equivalent self-hosted sink, structured client logs)
- Playwright E2E coverage
- Accessibility audit (ARIA, keyboard navigation, screen reader)
- Performance benchmarks (10k-file vault, memory leak audit)
- Rust/WASM search engine
- CRDT-based multi-device sync
- Plugin / extension system
- Subscription payment flow hardening (refund, receipts, usage tracking)

## Risks and open questions

| Risk | Mitigation |
|---|---|
| `pouchdb-adapter-memory` API drift across versions | Pin to specific minor; smoke test on upgrade |
| FSAA `move()` not in Safari/Firefox | Already fallback-handled (re-write + delete) |
| 8-language i18n cost for new strings | Use English first, mark others as TODO; localize before release tag |
| 80 % coverage may force tests for trivial code | Use `c8` ignore comments on type-only/glue files |
| Trash UI surface area in already-busy sidebar | Collapse to single icon entry; expand to panel on click |

## Next steps

1. User reviews this spec.
2. After approval, invoke `superpowers:writing-plans` to create a detailed implementation plan with task breakdown, dependency order, and verification steps per task.
3. Implementation happens on branch `feature/data-safety-phase1` from `main`.
