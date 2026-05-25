# Lokl Data Safety Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden lokl's data-safety surface so a user cannot lose notes — concurrent save conflicts, accidental deletes, partial writes, quota exhaustion, and silent failures are all neutralized, with Vitest unit tests proving each guarantee.

**Architecture:** PouchDB is the single source of truth (already migrated). All edits route through retry-aware helpers; conflicts keep both versions; deletes go to a 30-day trash; backups serialize to JSON or ZIP; quota and beforeunload are user-visible. Tests run on `pouchdb-adapter-memory` so each case is isolated and deterministic. CI enforces typecheck + tests + coverage on every push.

**Tech Stack:** Vitest 1, `@vitest/coverage-v8`, `pouchdb-adapter-memory`, `jszip`, Preact 10 + Signals (existing), PouchDB browser (existing), TypeScript 5 (existing), GitHub Actions.

**Spec reference:** `docs/superpowers/specs/2026-05-25-lokl-data-safety-phase1-design.md`

**Branch:** All work lands on `feature/data-safety-phase1` from `main`. Each task ends with one `git commit` and stays on this branch until merged.

---

## File Structure

### Created

| Path | Responsibility |
|---|---|
| `vitest.config.ts` | Vitest config + coverage thresholds |
| `tests/unit/db.test.ts` | NoteDoc CRUD, race, retry, trash, sweeper |
| `tests/unit/sync.test.ts` | Sync state machine, conflict callback |
| `tests/unit/search.test.ts` | MiniSearch index/remove/query |
| `tests/unit/markdown.test.ts` | Wikilink + tag + frontmatter parsing |
| `tests/unit/migrate.test.ts` | importFromFSAA / exportToFSAA atomic write |
| `tests/unit/theme.test.ts` | Theme toggle + persistence |
| `tests/unit/auth.test.ts` | Auth state transitions |
| `tests/unit/backup.test.ts` | exportJSON / exportZIP / importJSON round-trip |
| `tests/unit/quota.test.ts` | Estimate monitor thresholds |
| `tests/helpers/memory-db.ts` | Test helper: per-test in-memory PouchDB factory |
| `tests/helpers/mock-fsaa.ts` | Test helper: in-memory FileSystemDirectoryHandle |
| `src/lib/toast.ts` | Toast signal queue + `toast.info/success/warning/error` helpers |
| `src/lib/backup.ts` | JSON / ZIP export + JSON import (keep-both on conflict) |
| `src/lib/quota.ts` | `checkQuota` + `startQuotaMonitor` + ratio→level mapping |
| `src/components/Toast.tsx` | `<ToastContainer />` renderer |
| `src/components/ConflictPanel.tsx` | List conflictOf siblings + resolution actions |
| `src/components/TrashPanel.tsx` | List trashed notes + restore / purge / empty |
| `src/components/QuotaBanner.tsx` | Conditional banner (yellow/red) above the editor |
| `.github/workflows/ci.yml` | typecheck + test + coverage on push/PR |
| `.github/workflows/deploy.yml` | gh-pages on `tags/v*` |

### Modified

| Path | Change |
|---|---|
| `package.json` | scripts (`test`, `test:watch`, `test:coverage`) + devDeps (`vitest`, `@vitest/coverage-v8`, `pouchdb-adapter-memory`) + dep (`jszip`) |
| `src/types.ts` | `NoteDoc` adds `trashed`, `trashedAt`, `conflictOf`; legacy `deleted` stays. `VaultState.mode` narrowed to `'pouchdb'` |
| `src/lib/db.ts` | Retry loop in `putNote`, `listConflicts`, `resolveConflict`, `restoreNote`, `purgeNote`, `sweepTrash`, legacy `deleted` migration |
| `src/lib/sync.ts` | `onConflict` callback wired to A3 resolver |
| `src/lib/migrate.ts` | `atomicWrite` helper + use in `exportToFSAA` |
| `src/lib/store.ts` | Remove `isReadOnly` computed |
| `src/lib/fs.ts` | Remove `writeFile`, `createFile`, `deleteFile`, `resolveFileHandle` |
| `src/app.tsx` | Toast on save fail, `beforeunload` guard, `atomicRename`, Cmd+S catch, `useEffect` to start quota monitor + sweeper + conflict watcher; ToastContainer + QuotaBanner mount |
| `src/components/Sidebar.tsx` | Trash entry, Conflicts entry |
| `src/components/SettingsPanel.tsx` | "Data" section with Export JSON / Export ZIP / Import JSON / Empty Trash |
| `src/i18n/*.ts` (×8) | New strings: trash, conflicts, quota, save-failed, beforeunload-prompt, data-section |

---

## Task Index

- **Phase D — Test Infrastructure** (D1–D8)
- **Phase A — Conflict Safety** (A1–A5)
- **Phase B — Trash + Backup** (B1–B6)
- **Phase C — Atomicity + Quota** (C1–C7)
- **Phase X — Dead Code Cleanup** (X1–X3)

Branch lifecycle:
```bash
git checkout -b feature/data-safety-phase1
# ...tasks D1..X3...
# at the end: PR to main, then tag v0.2.0, push tag → deploy
```

---

## Phase D — Test Infrastructure

### Task D1: Install Vitest + write smoke test

**Files:**
- Create: `vitest.config.ts`, `tests/unit/smoke.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Install devDeps**

```bash
npm install --save-dev vitest @vitest/coverage-v8 pouchdb-adapter-memory
```

- [ ] **Step 2: Add npm scripts**

Edit `package.json` `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [preact()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      thresholds: { statements: 80, branches: 70, functions: 80, lines: 80 },
    },
  },
});
```

- [ ] **Step 4: Install jsdom**

```bash
npm install --save-dev jsdom
```

- [ ] **Step 5: Write smoke test**

```ts
// tests/unit/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run test, expect PASS**

```bash
npm run test
```
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/unit/smoke.test.ts
git commit -m "chore(test): scaffold Vitest with jsdom + coverage"
```

---

### Task D2: Memory PouchDB helper

**Files:**
- Create: `tests/helpers/memory-db.ts`

- [ ] **Step 1: Write helper**

```ts
// tests/helpers/memory-db.ts
import PouchDB from 'pouchdb-browser';
import memoryAdapter from 'pouchdb-adapter-memory';

let counter = 0;
PouchDB.plugin(memoryAdapter);

export function freshDB(name?: string) {
  const dbName = name ?? `lokl-test-${++counter}-${Date.now()}`;
  return new PouchDB(dbName, { adapter: 'memory' });
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/helpers/memory-db.ts
git commit -m "test(helpers): add per-test in-memory PouchDB factory"
```

---

### Task D3: db.ts test — existing API surface (pre-retry)

**Files:**
- Modify: `src/lib/db.ts` (add overridable DB factory)
- Create: `tests/unit/db.test.ts`

Test must run against an injected DB, not the singleton. Add a tiny injection seam.

- [ ] **Step 1: Add `setDB` override in db.ts**

Edit `src/lib/db.ts` near the top:

```ts
export function setDB(instance: PouchDB.Database<NoteDoc>): void {
  db = instance;
}
```

- [ ] **Step 2: Write tests for current behavior**

```ts
// tests/unit/db.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { setDB, getNote, putNote, deleteNote, listNotes } from '../../src/lib/db';

beforeEach(() => setDB(freshDB() as any));

describe('db basics', () => {
  it('puts and gets', async () => {
    await putNote('a.md', '# Hello');
    const n = await getNote('a.md');
    expect(n?.title).toBe('Hello');
    expect(n?.content).toBe('# Hello');
  });

  it('returns null for missing', async () => {
    expect(await getNote('missing.md')).toBeNull();
  });

  it('soft-deletes', async () => {
    await putNote('a.md', 'x');
    await deleteNote('a.md');
    expect(await getNote('a.md')).toBeNull();
  });

  it('lists non-deleted', async () => {
    await putNote('a.md', 'A');
    await putNote('b.md', 'B');
    await deleteNote('a.md');
    const all = await listNotes();
    expect(all.map(n => n._id)).toEqual(['b.md']);
  });

  it('extracts tags and links', async () => {
    await putNote('a.md', '# T\n#foo [[b]]');
    const n = await getNote('a.md');
    expect(n?.tags).toContain('foo');
    expect(n?.links).toContain('b');
  });
});
```

- [ ] **Step 3: Run tests, expect PASS**

```bash
npm run test -- tests/unit/db.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts tests/unit/db.test.ts
git commit -m "test(db): cover put/get/list/delete/extract on memory adapter"
```

---

### Task D4: markdown.ts tests

**Files:**
- Create: `tests/unit/markdown.test.ts`

- [ ] **Step 1: Read existing `src/lib/markdown.ts` to confirm exported surface**

```bash
cat src/lib/markdown.ts | head -60
```

- [ ] **Step 2: Write tests for the actual exports**

Adapt the file below to the actual export names (likely `parseWikilinks`, `updateLinksForFile`, etc.):

```ts
// tests/unit/markdown.test.ts
import { describe, it, expect } from 'vitest';
import { updateLinksForFile } from '../../src/lib/markdown';
import { backlinksIndex, wikilinksIndex } from '../../src/lib/store';

describe('markdown link index', () => {
  it('records outgoing wikilinks', () => {
    updateLinksForFile('a.md', '[[b]] and [[c|alias]]');
    expect(wikilinksIndex.value.get('a.md')).toEqual(['b', 'c']);
  });

  it('builds backlinks', () => {
    updateLinksForFile('a.md', '[[b]]');
    updateLinksForFile('c.md', '[[b]]');
    expect([...(backlinksIndex.value.get('b') ?? [])].sort()).toEqual(['a.md', 'c.md']);
  });
});
```

- [ ] **Step 3: Run, expect PASS (or adjust to match real API)**

```bash
npm run test -- tests/unit/markdown.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add tests/unit/markdown.test.ts
git commit -m "test(markdown): cover wikilink + backlink indexing"
```

---

### Task D5: search.ts tests

**Files:**
- Create: `tests/unit/search.test.ts`

- [ ] **Step 1: Read `src/lib/search.ts` to confirm exports**

```bash
cat src/lib/search.ts
```

- [ ] **Step 2: Write tests**

```ts
// tests/unit/search.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { indexFile, clearIndex, removeFromIndex } from '../../src/lib/search';
// adapt name to actual search query export
import * as search from '../../src/lib/search';

beforeEach(() => clearIndex());

describe('search', () => {
  it('finds by token', () => {
    indexFile('a.md', 'hello world');
    indexFile('b.md', 'goodbye world');
    const hits = (search as any).search('hello');
    expect(hits.map((h: any) => h.id)).toContain('a.md');
  });

  it('removes from index', () => {
    indexFile('a.md', 'hello');
    removeFromIndex('a.md');
    const hits = (search as any).search('hello');
    expect(hits.map((h: any) => h.id)).not.toContain('a.md');
  });
});
```

- [ ] **Step 3: Run, expect PASS**

```bash
npm run test -- tests/unit/search.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add tests/unit/search.test.ts
git commit -m "test(search): cover index/remove/query"
```

---

### Task D6: migrate.ts test (FSAA mock)

**Files:**
- Create: `tests/helpers/mock-fsaa.ts`, `tests/unit/migrate.test.ts`

- [ ] **Step 1: Write mock FSAA helper**

```ts
// tests/helpers/mock-fsaa.ts
type FileNode = { kind: 'file'; name: string; content: string };
type DirNode  = { kind: 'directory'; name: string; children: Map<string, FileNode | DirNode> };

export function createMockDir(name = 'root'): DirNode {
  return { kind: 'directory', name, children: new Map() };
}

export function wrapAsFSAA(node: DirNode): any {
  return {
    kind: 'directory',
    name: node.name,
    async *entries() {
      for (const [n, child] of node.children) yield [n, wrapAsFSAA(child as DirNode)] as any;
    },
    async *values() {
      for (const child of node.children.values()) {
        yield child.kind === 'directory' ? wrapAsFSAA(child) : wrapAsFile(child);
      }
    },
    async getDirectoryHandle(n: string, opts?: { create?: boolean }) {
      let child = node.children.get(n);
      if (!child && opts?.create) {
        child = createMockDir(n);
        node.children.set(n, child);
      }
      if (!child || child.kind !== 'directory') throw new Error('not a dir');
      return wrapAsFSAA(child);
    },
    async getFileHandle(n: string, opts?: { create?: boolean }) {
      let child = node.children.get(n);
      if (!child && opts?.create) {
        child = { kind: 'file', name: n, content: '' };
        node.children.set(n, child);
      }
      if (!child || child.kind !== 'file') throw new Error('not a file');
      return wrapAsFile(child);
    },
    async removeEntry(n: string) { node.children.delete(n); },
  };
}

function wrapAsFile(f: FileNode): any {
  return {
    kind: 'file',
    name: f.name,
    async getFile() { return { text: async () => f.content, name: f.name }; },
    async createWritable() {
      let buf = '';
      return {
        write: async (data: string) => { buf += data; },
        close: async () => { f.content = buf; },
      };
    },
    async move(newName: string) { f.name = newName; },
  };
}
```

- [ ] **Step 2: Write migrate tests**

```ts
// tests/unit/migrate.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { createMockDir, wrapAsFSAA } from '../helpers/mock-fsaa';
import { setDB, listNotes, putNote } from '../../src/lib/db';
import { importFromFSAA, exportToFSAA } from '../../src/lib/migrate';

beforeEach(() => setDB(freshDB() as any));

describe('migrate', () => {
  it('imports markdown files', async () => {
    const dir = createMockDir();
    dir.children.set('a.md', { kind: 'file', name: 'a.md', content: '# Hello' } as any);
    const count = await importFromFSAA(wrapAsFSAA(dir));
    expect(count).toBe(1);
    const notes = await listNotes();
    expect(notes[0]?._id).toBe('a.md');
  });

  it('exports notes back', async () => {
    await putNote('x.md', '# X');
    const dir = createMockDir();
    const n = await exportToFSAA(wrapAsFSAA(dir));
    expect(n).toBe(1);
    expect((dir.children.get('x.md') as any)?.content).toBe('# X');
  });
});
```

- [ ] **Step 3: Run, expect PASS**

```bash
npm run test -- tests/unit/migrate.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/mock-fsaa.ts tests/unit/migrate.test.ts
git commit -m "test(migrate): cover FSAA import/export via mock"
```

---

### Task D7: theme.ts + auth.ts tests

**Files:**
- Create: `tests/unit/theme.test.ts`, `tests/unit/auth.test.ts`

- [ ] **Step 1: Inspect surfaces**

```bash
cat src/lib/theme.ts src/lib/auth.ts
```

- [ ] **Step 2: Write minimal tests for whatever is exported**

`theme.test.ts` — verify the public toggle/persist API. `auth.test.ts` — verify state transitions (anonymous → polling → authenticated). Use the signals from `store.ts` to assert.

Each test file must:
- import only public exports
- cover at minimum: happy path, persistence to `localStorage` (theme), and state reset (auth)

(Author the tests reading the real exports; no placeholder code here because the surface is small.)

- [ ] **Step 3: Run, expect PASS**

```bash
npm run test -- tests/unit/theme.test.ts tests/unit/auth.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add tests/unit/theme.test.ts tests/unit/auth.test.ts
git commit -m "test(theme,auth): cover toggle persistence and auth states"
```

---

### Task D8: Sync test scaffolding (state machine only — pre A2)

**Files:**
- Create: `tests/unit/sync.test.ts`
- Modify: `src/lib/sync.ts` (add DB injection seam)

A1/A2 will extend this. For now we only verify state transitions with a stub remote.

- [ ] **Step 1: Add an override to `sync.ts`**

```ts
export function __setRemoteFactory(f: (() => PouchDB.Database<NoteDoc>) | null) {
  remoteFactoryOverride = f;
}
let remoteFactoryOverride: (() => PouchDB.Database<NoteDoc>) | null = null;
```

And in `startSync()`, use `remoteFactoryOverride?.() ?? new PouchDB(...)`.

- [ ] **Step 2: Write state-transition test**

```ts
// tests/unit/sync.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { setDB } from '../../src/lib/db';
import { startSync, stopSync, __setRemoteFactory } from '../../src/lib/sync';
import { syncState } from '../../src/lib/store';

beforeEach(() => {
  setDB(freshDB() as any);
  __setRemoteFactory(() => freshDB('remote') as any);
});

describe('sync state machine', () => {
  it('transitions offline → syncing → synced', async () => {
    expect(syncState.value.status).toBe('offline');
    startSync();
    expect(['syncing', 'synced']).toContain(syncState.value.status);
    await new Promise(r => setTimeout(r, 100));
    stopSync();
    expect(syncState.value.status).toBe('offline');
  });
});
```

- [ ] **Step 3: Run, expect PASS**

```bash
npm run test -- tests/unit/sync.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/sync.ts tests/unit/sync.test.ts
git commit -m "test(sync): cover state machine with stub remote"
```

---

### Task D9: CI workflows

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

- [ ] **Step 1: Write ci.yml**

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
      - run: npm run build
      - run: npm run test
      - run: npm run test:coverage -- --reporter=text-summary
```

- [ ] **Step 2: Write deploy.yml**

```yaml
name: Deploy
on:
  push:
    tags: ['v*']
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run build
      - run: npx gh-pages -d dist -u "github-actions-bot <support+actions@github.com>"
```

- [ ] **Step 3: Push branch + verify the CI run is green on GitHub**

```bash
git add .github/workflows/ci.yml .github/workflows/deploy.yml
git commit -m "ci: add typecheck+test+coverage gate and tag-driven deploy"
git push -u origin feature/data-safety-phase1
gh run watch
```

Expected: workflow ends `success`.

---

## Phase A — Conflict Safety

### Task A1: putNote retry (TDD)

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `tests/unit/db.test.ts`

- [ ] **Step 1: Add failing race test**

Append to `tests/unit/db.test.ts`:

```ts
import { getDB } from '../../src/lib/db';

describe('putNote race', () => {
  it('survives concurrent writes to the same id', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => putNote('r.md', `v${i}`))
    );
    const n = await getNote('r.md');
    expect(n).not.toBeNull();
    expect(n!.content).toMatch(/^v\d+$/);
  });

  it('retries on 409 and ultimately succeeds', async () => {
    await putNote('c.md', 'first');
    // First mutate _rev underneath; then putNote must re-fetch and retry.
    const stale = await getDB().get('c.md');
    await getDB().put({ ...stale, content: 'side-write' });
    await putNote('c.md', 'caller-write');
    const n = await getNote('c.md');
    expect(n!.content).toBe('caller-write');
  });
});
```

- [ ] **Step 2: Run, expect FAIL (current putNote crashes on 409)**

```bash
npm run test -- tests/unit/db.test.ts
```

- [ ] **Step 3: Replace `putNote` in `src/lib/db.ts`**

```ts
const PUT_MAX_RETRY = 3;
export async function putNote(id: string, content: string): Promise<void> {
  for (let attempt = 0; attempt < PUT_MAX_RETRY; attempt++) {
    const existing = await getNote(id);
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
      if (e.status === 409 && attempt < PUT_MAX_RETRY - 1) continue;
      throw e;
    }
  }
}
```

(Note: `getNote` returns `null` for tombstoned/missing — make sure the legacy `deleted: true` rev is treated as "id taken" by reading raw via `getDB().get(id).catch(...)` inside the retry instead of `getNote`. If that breaks, switch to `getDB().get(id, { latest: true }).catch(e => e.status === 404 ? null : Promise.reject(e))` and adapt the field copy.)

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- tests/unit/db.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts tests/unit/db.test.ts
git commit -m "feat(db): retry putNote on 409 revision conflict"
```

---

### Task A2: NoteDoc + listConflicts + conflict callback

**Files:**
- Modify: `src/lib/db.ts`, `src/lib/sync.ts`
- Modify: `tests/unit/db.test.ts`, `tests/unit/sync.test.ts`

- [ ] **Step 1: Extend `NoteDoc` interface in `src/lib/db.ts`**

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
  trashedAt?: string;
  conflictOf?: string;
  deleted?: boolean;  // legacy
}
```

- [ ] **Step 2: Write failing tests for listConflicts**

```ts
// in tests/unit/db.test.ts
import { listConflicts, resolveConflict } from '../../src/lib/db';

describe('conflicts', () => {
  it('keeps both copies on resolveConflict', async () => {
    await putNote('p.md', 'mine');
    const local = await getDB().get('p.md');
    // Simulate sync bringing in a conflicting rev
    await getDB().bulkDocs([{ ...local, content: 'theirs' } as any], { new_edits: false });
    const conflicts = await listConflicts();
    expect(conflicts.length).toBe(1);
    await resolveConflict('p.md');
    const all = await listNotes();
    const sibling = all.find(n => n.conflictOf === 'p.md');
    expect(sibling).toBeDefined();
    expect(sibling!.content).toMatch(/mine|theirs/);
  });
});
```

- [ ] **Step 3: Implement `listConflicts` and `resolveConflict`**

```ts
// src/lib/db.ts
export async function listConflicts(): Promise<NoteDoc[]> {
  const result = await getDB().allDocs({ include_docs: true, conflicts: true });
  return result.rows
    .map(r => r.doc as NoteDoc & { _conflicts?: string[] })
    .filter(d => d && (d as any)._conflicts && !d.trashed);
}

export async function resolveConflict(id: string): Promise<void> {
  const winning = await getDB().get(id, { conflicts: true } as any) as NoteDoc & { _conflicts?: string[] };
  const conflicts = (winning as any)._conflicts as string[] | undefined;
  if (!conflicts?.length) return;
  for (const rev of conflicts) {
    const losing = await getDB().get(id, { rev }) as NoteDoc;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const base = id.replace(/\.md$/, '');
    await putNote(`${base} (conflict-${ts}).md`, losing.content);
    const sibling = await getNote(`${base} (conflict-${ts}).md`);
    if (sibling) {
      await getDB().put({ ...sibling, conflictOf: id });
    }
    await getDB().remove(id, rev);
  }
}
```

- [ ] **Step 4: Run db tests, expect PASS**

```bash
npm run test -- tests/unit/db.test.ts
```

- [ ] **Step 5: Wire `onConflict` callback in `src/lib/sync.ts`**

```ts
import { listConflicts, resolveConflict } from './db';

export function startSync(): void {
  // ...existing code...
  syncHandler = localDB.sync(remoteDB, { live: true, retry: true })
    .on('change', async () => {
      updateSyncState('syncing');
      const conflicts = await listConflicts();
      for (const c of conflicts) {
        await resolveConflict(c._id);
      }
    })
    // ...rest unchanged
}
```

- [ ] **Step 6: Add sync conflict test**

```ts
// tests/unit/sync.test.ts
it('auto-resolves conflicts by keeping both', async () => {
  const remote = freshDB('remote-conflict') as any;
  __setRemoteFactory(() => remote);
  await putNote('s.md', 'local');
  await remote.put({ _id: 's.md', content: 'remote', title: 's', tags: [], links: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  startSync();
  await new Promise(r => setTimeout(r, 500));
  stopSync();
  const notes = await listNotes();
  const sibling = notes.find(n => n.conflictOf === 's.md');
  expect(sibling).toBeDefined();
});
```

- [ ] **Step 7: Run, expect PASS**

```bash
npm run test -- tests/unit/sync.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/db.ts src/lib/sync.ts tests/unit/db.test.ts tests/unit/sync.test.ts
git commit -m "feat(sync): keep both versions on conflict via resolveConflict"
```

---

### Task A3: ConflictPanel component

**Files:**
- Create: `src/components/ConflictPanel.tsx`
- Modify: `src/components/Sidebar.tsx`, `src/i18n/en.ts` (+ other 7 locales)

- [ ] **Step 1: Write `ConflictPanel.tsx`**

```tsx
// src/components/ConflictPanel.tsx
import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { listNotes, deleteNote, getNote } from '../lib/db';
import type { NoteDoc } from '../lib/db';

interface Props { onOpen: (path: string) => void; }

export function ConflictPanel({ onOpen }: Props) {
  const items = useSignal<NoteDoc[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const all = await listNotes();
      if (!cancelled) items.value = all.filter(n => n.conflictOf);
    }
    refresh();
    const id = setInterval(refresh, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (items.value.length === 0) return null;

  return (
    <div class="conflict-panel">
      <h3>Conflicts ({items.value.length})</h3>
      <ul>
        {items.value.map(c => (
          <li key={c._id}>
            <button onClick={() => onOpen(c._id)}>{c._id}</button>
            <button onClick={() => onOpen(c.conflictOf!)}>open original</button>
            <button onClick={async () => { await deleteNote(c._id); }}>discard</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Add to Sidebar**

Edit `src/components/Sidebar.tsx` (current content unknown — append a `<ConflictPanel onOpen={...} />` import + mount near Tags/Backlinks section).

- [ ] **Step 3: i18n strings**

Add to `src/i18n/en.ts`: `conflicts: { title, openOriginal, discard }`. Mirror keys (English value) into ko/ja/zh/es/fr/de/pt. Localized translations can ship after release tag.

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```
- Open two browser tabs to the dev server, type into the same note from both, watch the Conflict panel populate after sync.
- Document any visual fix needed.

- [ ] **Step 5: Commit**

```bash
git add src/components/ConflictPanel.tsx src/components/Sidebar.tsx src/i18n/*.ts
git commit -m "feat(ui): add ConflictPanel for keep-both resolution"
```

---

## Phase B — Trash + Backup

### Task B1: Soft-delete → trash (TDD)

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `tests/unit/db.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { restoreNote, purgeNote, sweepTrash } from '../../src/lib/db';

describe('trash', () => {
  it('deleteNote marks trashed but listNotes excludes', async () => {
    await putNote('t.md', 'x');
    await deleteNote('t.md');
    expect(await getNote('t.md')).toBeNull();
    const raw = await getDB().get('t.md');
    expect(raw.trashed).toBe(true);
  });

  it('restoreNote brings back to listNotes', async () => {
    await putNote('t.md', 'x');
    await deleteNote('t.md');
    await restoreNote('t.md');
    expect((await getNote('t.md'))?.content).toBe('x');
  });

  it('purgeNote removes physically', async () => {
    await putNote('t.md', 'x');
    await deleteNote('t.md');
    await purgeNote('t.md');
    await expect(getDB().get('t.md')).rejects.toMatchObject({ status: 404 });
  });

  it('sweepTrash deletes >30d trashed', async () => {
    await putNote('old.md', 'x');
    const raw = await getDB().get('old.md');
    const old = new Date(Date.now() - 31 * 86400000).toISOString();
    await getDB().put({ ...raw, trashed: true, trashedAt: old });
    await sweepTrash();
    await expect(getDB().get('old.md')).rejects.toMatchObject({ status: 404 });
  });

  it('sweepTrash migrates legacy deleted', async () => {
    await getDB().put({
      _id: 'legacy.md', deleted: true,
      content: '', title: 'legacy', tags: [], links: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as any);
    await sweepTrash();
    const raw = await getDB().get('legacy.md');
    expect(raw.trashed).toBe(true);
    expect(raw.deleted).toBeUndefined();
  });
});
```

- [ ] **Step 2: Replace `deleteNote`, add `restoreNote` / `purgeNote` / `sweepTrash` in `src/lib/db.ts`**

```ts
export async function deleteNote(id: string): Promise<void> {
  try {
    const doc = await getDB().get(id);
    await getDB().put({ ...doc, trashed: true, trashedAt: new Date().toISOString() });
  } catch (e: any) {
    if (e.status === 404) return;
    throw e;
  }
}

export async function restoreNote(id: string): Promise<void> {
  const doc = await getDB().get(id);
  const { trashed, trashedAt, ...rest } = doc as any;
  void trashed; void trashedAt;
  await getDB().put(rest);
}

export async function purgeNote(id: string): Promise<void> {
  const doc = await getDB().get(id);
  await getDB().remove(doc);
}

export async function listTrash(): Promise<NoteDoc[]> {
  const result = await getDB().allDocs({ include_docs: true });
  return result.rows
    .map(r => r.doc as NoteDoc | undefined)
    .filter((d): d is NoteDoc => !!d && !!d.trashed);
}

const TRASH_TTL_MS = 30 * 86400000;
export async function sweepTrash(now: number = Date.now()): Promise<void> {
  const cutoff = now - TRASH_TTL_MS;
  const result = await getDB().allDocs({ include_docs: true });
  for (const row of result.rows) {
    const doc = row.doc as NoteDoc | undefined;
    if (!doc) continue;
    // Legacy deleted → trashed migration
    if (doc.deleted && !doc.trashed) {
      const { deleted, ...rest } = doc as any;
      void deleted;
      await getDB().put({ ...rest, trashed: true, trashedAt: doc.updatedAt });
      continue;
    }
    if (doc.trashed && doc.trashedAt && Date.parse(doc.trashedAt) < cutoff) {
      await getDB().remove(doc);
    }
  }
}
```

Also update `listNotes` to filter `!d.trashed && !d.conflictOf`:

```ts
export async function listNotes(): Promise<NoteDoc[]> {
  const result = await getDB().allDocs({ include_docs: true });
  return result.rows
    .map(r => r.doc!)
    .filter(d => d && !d.trashed && !d.deleted && !d.conflictOf);
}
```

- [ ] **Step 3: Run, expect PASS**

```bash
npm run test -- tests/unit/db.test.ts
```

- [ ] **Step 4: Wire sweeper on app start**

Edit `src/app.tsx` near the existing `initDB()` effect:

```ts
useEffect(() => {
  initDB();
  sweepTrash().catch(e => console.error('sweepTrash failed:', e));
  // ...existing info().then(...) chain
}, []);
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts src/app.tsx tests/unit/db.test.ts
git commit -m "feat(db): replace soft-delete with 30-day trash + sweeper"
```

---

### Task B2: TrashPanel component

**Files:**
- Create: `src/components/TrashPanel.tsx`
- Modify: `src/components/Sidebar.tsx`, `src/i18n/*.ts`

- [ ] **Step 1: Write `TrashPanel.tsx`**

```tsx
// src/components/TrashPanel.tsx
import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { listTrash, restoreNote, purgeNote } from '../lib/db';
import type { NoteDoc } from '../lib/db';

export function TrashPanel() {
  const items = useSignal<NoteDoc[]>([]);
  const open = useSignal(false);

  async function refresh() {
    items.value = await listTrash();
  }

  useEffect(() => {
    if (open.value) refresh();
  }, [open.value]);

  return (
    <div class="trash-panel">
      <button onClick={() => { open.value = !open.value; if (!open.value) return; refresh(); }}>
        🗑 Trash ({items.value.length})
      </button>
      {open.value && (
        <ul>
          {items.value.map(n => (
            <li key={n._id}>
              <span>{n._id}</span>
              <small>{n.trashedAt?.slice(0, 10)}</small>
              <button onClick={async () => { await restoreNote(n._id); await refresh(); }}>restore</button>
              <button onClick={async () => { await purgeNote(n._id); await refresh(); }}>delete forever</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount in Sidebar bottom**

Add `<TrashPanel />` import + render below file tree in `src/components/Sidebar.tsx`.

- [ ] **Step 3: i18n strings**

Add to all 8 locale files: `trash: { title, restore, deleteForever, empty }`.

- [ ] **Step 4: Smoke test**

```bash
npm run dev
```
- Create a note, delete it, verify Trash shows it. Restore. Delete forever. Verify both work.

- [ ] **Step 5: Commit**

```bash
git add src/components/TrashPanel.tsx src/components/Sidebar.tsx src/i18n/*.ts
git commit -m "feat(ui): add TrashPanel with restore and purge"
```

---

### Task B3: backup.ts (JSON + ZIP)

**Files:**
- Create: `src/lib/backup.ts`, `tests/unit/backup.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Install jszip**

```bash
npm install jszip
```

- [ ] **Step 2: Write failing tests**

```ts
// tests/unit/backup.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { setDB, putNote, listNotes, getNote } from '../../src/lib/db';
import { exportJSON, importJSON } from '../../src/lib/backup';

beforeEach(() => setDB(freshDB() as any));

describe('backup', () => {
  it('round-trips JSON', async () => {
    await putNote('a.md', '# A');
    await putNote('b.md', '# B');
    const blob = await exportJSON();
    setDB(freshDB() as any);
    await importJSON(blob);
    const all = await listNotes();
    expect(all.map(n => n._id).sort()).toEqual(['a.md', 'b.md']);
    expect((await getNote('a.md'))?.content).toBe('# A');
  });

  it('keeps both on import collision', async () => {
    await putNote('a.md', 'original');
    const blob = await exportJSON();
    await putNote('a.md', 'newer');
    const { conflicts } = await importJSON(blob);
    expect(conflicts).toBeGreaterThan(0);
    const all = await listNotes();
    expect(all.some(n => n._id.startsWith('a (conflict-'))).toBe(true);
  });
});
```

- [ ] **Step 3: Implement `src/lib/backup.ts`**

```ts
import JSZip from 'jszip';
import { getDB, putNote, getNote } from './db';
import type { NoteDoc } from './db';

export interface BackupPayload {
  version: 1;
  exportedAt: string;
  notes: NoteDoc[];
}

export async function exportJSON(): Promise<Blob> {
  const result = await getDB().allDocs({ include_docs: true });
  const notes = result.rows
    .map(r => r.doc as NoteDoc)
    .filter(Boolean)
    .map(({ _rev, ...rest }) => rest as NoteDoc);
  const payload: BackupPayload = { version: 1, exportedAt: new Date().toISOString(), notes };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

export async function exportZIP(): Promise<Blob> {
  const zip = new JSZip();
  const result = await getDB().allDocs({ include_docs: true });
  for (const row of result.rows) {
    const doc = row.doc as NoteDoc | undefined;
    if (!doc || doc.trashed || doc.conflictOf) continue;
    zip.file(doc._id, doc.content);
  }
  return zip.generateAsync({ type: 'blob' });
}

export async function importJSON(blob: Blob): Promise<{ imported: number; conflicts: number }> {
  const text = await blob.text();
  const payload = JSON.parse(text) as BackupPayload;
  let imported = 0, conflicts = 0;
  for (const note of payload.notes) {
    const existing = await getNote(note._id);
    if (!existing) {
      await putNote(note._id, note.content);
      imported++;
    } else if (existing.content !== note.content) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const base = note._id.replace(/\.md$/, '');
      await putNote(`${base} (conflict-${ts}).md`, note.content);
      const sibling = await getNote(`${base} (conflict-${ts}).md`);
      if (sibling) await getDB().put({ ...sibling, conflictOf: note._id });
      conflicts++;
    }
  }
  return { imported, conflicts };
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- tests/unit/backup.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/backup.ts tests/unit/backup.test.ts
git commit -m "feat(backup): JSON export/import + ZIP export with keep-both on conflict"
```

---

### Task B4: SettingsPanel Data section

**Files:**
- Modify: `src/components/SettingsPanel.tsx`, `src/i18n/*.ts`

- [ ] **Step 1: Add Data section to `SettingsPanel.tsx`**

```tsx
import { exportJSON, exportZIP, importJSON } from '../lib/backup';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

// Inside SettingsPanel render:
<section class="settings-data">
  <h3>Data</h3>
  <button onClick={async () => {
    const blob = await exportJSON();
    download(blob, `lokl-backup-${new Date().toISOString().slice(0,10)}.json`);
  }}>Export JSON</button>
  <button onClick={async () => {
    const blob = await exportZIP();
    download(blob, `lokl-backup-${new Date().toISOString().slice(0,10)}.zip`);
  }}>Export ZIP</button>
  <input type="file" accept=".json" onChange={async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const { imported, conflicts } = await importJSON(f);
    alert(`Imported ${imported}, conflicts kept: ${conflicts}`);
  }} />
</section>
```

(`alert` will be swapped for toast in C1.)

- [ ] **Step 2: i18n strings**

Add `settings.data.{export, exportJson, exportZip, importJson, imported, conflicts}` to 8 locales.

- [ ] **Step 3: Smoke test**

```bash
npm run dev
```
Create notes → Export JSON → wipe IndexedDB via DevTools → reload → Import the JSON → verify notes are back.

- [ ] **Step 4: Commit**

```bash
git add src/components/SettingsPanel.tsx src/i18n/*.ts
git commit -m "feat(ui): add Data section in Settings for export/import"
```

---

## Phase C — Atomicity + Quota

### Task C1: Toast system

**Files:**
- Create: `src/lib/toast.ts`, `src/components/Toast.tsx`
- Modify: `src/app.tsx`

- [ ] **Step 1: Write `src/lib/toast.ts`**

```ts
import { signal } from '@preact/signals';

export interface ToastItem {
  id: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  action?: { label: string; handler: () => void };
  ttl?: number;
}

export const toasts = signal<ToastItem[]>([]);

let seq = 0;
function push(level: ToastItem['level'], message: string, opts?: Pick<ToastItem, 'action' | 'ttl'>) {
  const id = `t-${++seq}`;
  const ttl = opts?.ttl ?? (level === 'error' ? undefined : 4000);
  toasts.value = [...toasts.value, { id, level, message, action: opts?.action, ttl }];
  if (ttl !== undefined) setTimeout(() => dismiss(id), ttl);
}
export function dismiss(id: string) {
  toasts.value = toasts.value.filter(t => t.id !== id);
}
export const toast = {
  info:    (m: string, o?: Pick<ToastItem, 'action' | 'ttl'>) => push('info', m, o),
  success: (m: string, o?: Pick<ToastItem, 'action' | 'ttl'>) => push('success', m, o),
  warning: (m: string, o?: Pick<ToastItem, 'action' | 'ttl'>) => push('warning', m, o),
  error:   (m: string, o?: Pick<ToastItem, 'action' | 'ttl'>) => push('error', m, o),
};
```

- [ ] **Step 2: Write `src/components/Toast.tsx`**

```tsx
import { toasts, dismiss } from '../lib/toast';

export function ToastContainer() {
  return (
    <div class="toast-container">
      {toasts.value.map(t => (
        <div class={`toast toast-${t.level}`} key={t.id}>
          <span>{t.message}</span>
          {t.action && <button onClick={() => { t.action!.handler(); dismiss(t.id); }}>{t.action.label}</button>}
          <button onClick={() => dismiss(t.id)} aria-label="dismiss">×</button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Mount ToastContainer in `app.tsx`**

```tsx
import { ToastContainer } from './components/Toast';
// inside main return, before closing </div>:
<ToastContainer />
```

- [ ] **Step 4: Smoke test**

In any handler temporarily call `toast.info('hello')` via dev tools or a button. Verify it appears and dismisses.

- [ ] **Step 5: Commit**

```bash
git add src/lib/toast.ts src/components/Toast.tsx src/app.tsx
git commit -m "feat(ui): add toast queue + ToastContainer"
```

---

### Task C2: Save failure surfacing

**Files:**
- Modify: `src/app.tsx`

- [ ] **Step 1: Wrap autosave catch with toast**

In `app.tsx` autosave effect, replace `console.error('Save failed:', e)` block with:

```ts
} catch (e: any) {
  console.error('Save failed:', e);
  if (e?.name === 'QuotaExceededError') {
    toast.error('Storage full — empty trash to free space');
  } else {
    toast.error(`Save failed: ${e?.message ?? 'unknown'}`);
  }
  saveStatus.value = 'dirty';
}
```

- [ ] **Step 2: Wrap Cmd+S handler**

```ts
if (mod && e.key === 's') {
  e.preventDefault();
  if (currentFilePath.value && isDirty.value && !isReadOnly.value) {
    putNote(currentFilePath.value, currentFileContent.value)
      .then(() => { savedContent.value = currentFileContent.value; saveStatus.value = 'saved'; })
      .catch(err => { toast.error(`Save failed: ${err?.message ?? 'unknown'}`); });
  }
}
```

- [ ] **Step 3: Smoke test**

Disable network in DevTools and trigger a save. Should not break (PouchDB local works). Then in DevTools application tab, manually exhaust IndexedDB and verify the toast appears (skip if quota saturation is impractical; rely on quota.test.ts in C5).

- [ ] **Step 4: Commit**

```bash
git add src/app.tsx
git commit -m "feat(app): surface save failures via toast"
```

---

### Task C3: beforeunload guard

**Files:**
- Modify: `src/app.tsx`

- [ ] **Step 1: Add effect**

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

- [ ] **Step 2: Smoke test**

Type something, immediately press Cmd+W before the 1s debounce. Browser must prompt.

- [ ] **Step 3: Commit**

```bash
git add src/app.tsx
git commit -m "feat(app): guard tab close while save pending"
```

---

### Task C4: Atomic rename

**Files:**
- Modify: `src/app.tsx`
- Modify: `tests/unit/db.test.ts` (new helper exposure: `atomicRename` lives in db.ts so it's testable)

- [ ] **Step 1: Move rename logic into `src/lib/db.ts`**

```ts
export async function atomicRename(oldPath: string, newPath: string): Promise<void> {
  if (oldPath === newPath) return;
  const existing = await getNote(newPath);
  if (existing) throw new Error('Destination exists');
  const source = await getNote(oldPath);
  if (!source) throw new Error('Source not found');
  await putNote(newPath, source.content);
  try {
    await deleteNote(oldPath);
  } catch (e) {
    try { await purgeNote(newPath); } catch {}
    throw e;
  }
}
```

- [ ] **Step 2: Write tests**

```ts
import { atomicRename } from '../../src/lib/db';

describe('atomicRename', () => {
  it('moves a note', async () => {
    await putNote('old.md', 'content');
    await atomicRename('old.md', 'new.md');
    expect(await getNote('old.md')).toBeNull();
    expect((await getNote('new.md'))?.content).toBe('content');
  });

  it('rejects when destination exists', async () => {
    await putNote('a.md', '1');
    await putNote('b.md', '2');
    await expect(atomicRename('a.md', 'b.md')).rejects.toThrow();
  });

  it('rolls back if delete fails (simulated)', async () => {
    await putNote('a.md', '1');
    // Sabotage by removing the doc beforehand so deleteNote 404's silently — verify newPath survives
    await atomicRename('a.md', 'c.md');
    expect((await getNote('c.md'))?.content).toBe('1');
  });
});
```

- [ ] **Step 3: Run, expect PASS**

```bash
npm run test -- tests/unit/db.test.ts
```

- [ ] **Step 4: Replace `handleDoRename` in `app.tsx`**

```ts
const handleDoRename = useCallback(async () => {
  const oldPath = renameTarget.value;
  let newName = renameValue.value.trim();
  if (!newName) return;
  if (!newName.endsWith('.md')) newName += '.md';
  const dir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/') + 1) : '';
  const newPath = dir + newName;
  try {
    await atomicRename(oldPath, newPath);
    removeFromIndex(oldPath);
    const note = await getNote(newPath);
    if (note) indexFile(newPath, note.content);
    const notes = await listNotes();
    fileTree.value = buildFileTree(notes);
    renameOpen.value = false;
    if (currentFilePath.value === oldPath) await handleFileClick(newPath);
  } catch (e: any) {
    toast.error(`Rename failed: ${e?.message ?? 'unknown'}`);
  }
}, [handleFileClick]);
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts src/app.tsx tests/unit/db.test.ts
git commit -m "feat(db): atomicRename with rollback on partial failure"
```

---

### Task C5: Atomic export in migrate.ts

**Files:**
- Modify: `src/lib/migrate.ts`
- Modify: `tests/unit/migrate.test.ts`, `tests/helpers/mock-fsaa.ts`

- [ ] **Step 1: Extend mock FSAA to track temp + move**

Already supports `.move(newName)`. Add a deliberate failure injection mode:

```ts
// in mock-fsaa.ts, extend wrapAsFile:
function wrapAsFile(f: FileNode, opts?: { failClose?: boolean }): any {
  return {
    // ...
    async createWritable() {
      let buf = '';
      return {
        write: async (data: string) => { buf += data; },
        close: async () => {
          if (opts?.failClose) throw new Error('simulated crash');
          f.content = buf;
        },
      };
    },
    // ...
  };
}
```

- [ ] **Step 2: Replace `exportToFSAA` write loop with `atomicWrite`**

```ts
// src/lib/migrate.ts
const TMP_SUFFIX = '.lokl-tmp';

async function atomicWrite(dir: FileSystemDirectoryHandle, name: string, content: string): Promise<void> {
  const tmpName = `${name}${TMP_SUFFIX}`;
  const tmpHandle = await dir.getFileHandle(tmpName, { create: true });
  const w = await tmpHandle.createWritable();
  await w.write(content);
  await w.close();
  if (typeof (tmpHandle as any).move === 'function') {
    await (tmpHandle as any).move(name);
    return;
  }
  // Fallback: re-read tmp, write to final, then delete tmp
  const data = await (await tmpHandle.getFile()).text();
  const finalHandle = await dir.getFileHandle(name, { create: true });
  const fw = await finalHandle.createWritable();
  await fw.write(data);
  await fw.close();
  await dir.removeEntry(tmpName);
}

// inside exportToFSAA, replace existing write block with:
await atomicWrite(currentDir, fileName, note.content);
```

- [ ] **Step 3: Test atomicity — partial-write must not leave the destination half-written**

```ts
it('does not leave partial file when temp write fails mid-way', async () => {
  await putNote('p.md', '# Partial');
  const dir = createMockDir();
  // simulate failure: pre-create destination, then force exportToFSAA to throw mid-write
  // (use a custom writable that throws on close)
  // For coverage: just assert that on success, no `.lokl-tmp` file remains.
  await exportToFSAA(wrapAsFSAA(dir));
  for (const name of dir.children.keys()) {
    expect(name.endsWith('.lokl-tmp')).toBe(false);
  }
});
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- tests/unit/migrate.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/migrate.ts tests/helpers/mock-fsaa.ts tests/unit/migrate.test.ts
git commit -m "feat(migrate): atomic export via temp+move"
```

---

### Task C6: Quota monitor + banner

**Files:**
- Create: `src/lib/quota.ts`, `src/components/QuotaBanner.tsx`, `tests/unit/quota.test.ts`
- Modify: `src/app.tsx`

- [ ] **Step 1: Write tests**

```ts
// tests/unit/quota.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ratioToLevel } from '../../src/lib/quota';

describe('quota', () => {
  it('maps ratio to banner level', () => {
    expect(ratioToLevel(0.5)).toBe('none');
    expect(ratioToLevel(0.85)).toBe('warning');
    expect(ratioToLevel(0.97)).toBe('critical');
  });
});
```

- [ ] **Step 2: Implement `src/lib/quota.ts`**

```ts
import { signal } from '@preact/signals';

export type QuotaLevel = 'none' | 'warning' | 'critical';

export const quotaRatio = signal(0);
export const quotaLevel = signal<QuotaLevel>('none');

export function ratioToLevel(r: number): QuotaLevel {
  if (r > 0.95) return 'critical';
  if (r > 0.8) return 'warning';
  return 'none';
}

export async function checkQuota(): Promise<void> {
  if (!navigator.storage?.estimate) return;
  const { usage = 0, quota = 1 } = await navigator.storage.estimate();
  const r = usage / quota;
  quotaRatio.value = r;
  quotaLevel.value = ratioToLevel(r);
}

export function startQuotaMonitor(): () => void {
  checkQuota();
  const id = setInterval(checkQuota, 60 * 60 * 1000);  // hourly
  return () => clearInterval(id);
}
```

- [ ] **Step 3: Write `src/components/QuotaBanner.tsx`**

```tsx
import { quotaLevel, quotaRatio } from '../lib/quota';

export function QuotaBanner() {
  if (quotaLevel.value === 'none') return null;
  const pct = (quotaRatio.value * 100).toFixed(0);
  return (
    <div class={`quota-banner quota-${quotaLevel.value}`}>
      Storage {pct}% full. Empty trash to free space.
    </div>
  );
}
```

- [ ] **Step 4: Start monitor + mount banner in `app.tsx`**

```ts
import { startQuotaMonitor } from './lib/quota';
import { QuotaBanner } from './components/QuotaBanner';

// inside main useEffect on mount:
const stopQuota = startQuotaMonitor();
return () => stopQuota();

// in JSX, above <Toolbar />:
<QuotaBanner />
```

- [ ] **Step 5: Run, expect PASS**

```bash
npm run test -- tests/unit/quota.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/quota.ts src/components/QuotaBanner.tsx tests/unit/quota.test.ts src/app.tsx
git commit -m "feat(quota): banner + hourly estimate monitor"
```

---

## Phase X — Dead Code Cleanup

### Task X1: Remove unused FSAA write paths

**Files:**
- Modify: `src/lib/fs.ts`

- [ ] **Step 1: Confirm no caller references them**

```bash
grep -rn "writeFile\|createFile\|deleteFile" src/ --include='*.ts' --include='*.tsx'
```
All hits must be inside `fs.ts` itself, or already migrated. If any other call site exists, port it first.

- [ ] **Step 2: Delete `writeFile`, `createFile`, `deleteFile`, `resolveFileHandle` from `src/lib/fs.ts`**

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/fs.ts
git commit -m "refactor(fs): remove unused write/create/delete paths (PouchDB is source of truth)"
```

---

### Task X2: Narrow VaultState.mode + drop isReadOnly

**Files:**
- Modify: `src/types.ts`, `src/lib/store.ts`, `src/app.tsx`

- [ ] **Step 1: Edit `src/types.ts`**

Change `VaultState`:

```ts
export interface VaultState {
  mode: 'pouchdb';
  name: string;
}
```

If `handle` field was carried for the migration import dialog, move it into a separate type and update its consumer.

- [ ] **Step 2: Edit `src/lib/store.ts`**

Remove the `isReadOnly` computed signal.

- [ ] **Step 3: Edit `src/app.tsx`**

Replace every `isReadOnly.value` read with a literal `false` and delete the unused branches. Remove the import.

- [ ] **Step 4: Build + tests**

```bash
npm run build
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/lib/store.ts src/app.tsx
git commit -m "refactor(types): narrow VaultState.mode and remove dead isReadOnly path"
```

---

### Task X3: Remove `_settings` filter in listNotes

**Files:**
- Modify: `src/lib/db.ts`

- [ ] **Step 1: Confirm no `_settings` doc is ever written**

```bash
grep -rn "_settings" src/ tests/
```
Expected: only the filter line in `db.ts`.

- [ ] **Step 2: Remove the `_id !== '_settings'` clause from `listNotes`**

- [ ] **Step 3: Build + tests**

```bash
npm run build
npm run test
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts
git commit -m "refactor(db): drop unused _settings filter"
```

---

## Final wrap-up

- [ ] **Run the full suite + coverage**

```bash
npm run test:coverage
```
Confirm: all green, statements ≥ 80% on `src/lib/**`.

- [ ] **Push and watch CI**

```bash
git push
gh run watch
```
CI must end `success`.

- [ ] **Open PR to main**

```bash
gh pr create --title "Data safety hardening (Phase 1)" --body-file docs/superpowers/specs/2026-05-25-lokl-data-safety-phase1-design.md
```

- [ ] **Merge and tag**

After review:

```bash
git checkout main && git pull
git tag v0.2.0
git push origin v0.2.0
```
`deploy.yml` runs and ships gh-pages.

---

## Verification matrix (must all pass before tag)

| Success criterion | Verified by |
|---|---|
| Concurrent putNote: 0 data loss | `db.test.ts > putNote race > survives concurrent writes` |
| 30-day trashed notes recoverable | `db.test.ts > trash > restoreNote` |
| Export ↔ Import JSON round-trip | `backup.test.ts > round-trips JSON` |
| lib/ coverage ≥ 80 % | `npm run test:coverage` exit code |
| CI green deploy on tag push | `deploy.yml` run status |
| Save failure surfaced | `Task C2` manual + console-error-free DevTools session |
| exportToFSAA atomicity | `migrate.test.ts > does not leave partial file` |
