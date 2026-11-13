import { describe, it, expect, vi, beforeEach } from 'vitest';

// One note that could not be resolved used to end the whole pass — the notes after it
// stayed in conflict until some later change happened to start another pass.
const calls: string[] = [];
let failures: Record<string, { status?: number; times: number }> = {};
let pendingConflicts: string[][] = [];

vi.mock('../../src/lib/db', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/db')>()),
  listConflicts: vi.fn(async () => (pendingConflicts.shift() ?? []).map((_id) => ({ _id }))),
  resolveConflict: vi.fn(async (id: string) => {
    calls.push(id);
    const f = failures[id];
    if (f && f.times > 0) {
      f.times--;
      throw Object.assign(new Error('boom'), { status: f.status });
    }
  }),
}));

const { resolveAllConflicts } = await import('../../src/lib/sync');

beforeEach(() => {
  calls.length = 0;
  failures = {};
  pendingConflicts = [];
});

describe('conflict resolve pass', () => {
  it('goes on to the remaining notes when one fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    pendingConflicts = [['a.md', 'b.md', 'c.md']];
    failures = { 'b.md': { status: 500, times: 1 } };
    await resolveAllConflicts();
    expect(calls).toEqual(['a.md', 'b.md', 'c.md']);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it('looks again after a 404/409 — another device settled that branch first', async () => {
    pendingConflicts = [['a.md', 'b.md'], ['b.md'], []];
    failures = { 'a.md': { status: 409, times: 1 }, 'b.md': { status: 404, times: 1 } };
    await resolveAllConflicts();
    // first pass: both tried; second pass ran because of the 409/404 and retried what was still listed
    expect(calls).toEqual(['a.md', 'b.md', 'b.md']);
  });

  it('gives up re-running when a branch never stops answering 409', async () => {
    pendingConflicts = Array.from({ length: 50 }, () => ['stuck.md']);
    failures = { 'stuck.md': { status: 409, times: 1000 } };
    await resolveAllConflicts();
    expect(calls.length).toBeLessThanOrEqual(6);
  });
});
