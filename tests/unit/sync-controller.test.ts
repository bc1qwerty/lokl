import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { setDB } from '../../src/lib/db';
import type { NoteDoc } from '../../src/lib/db';
import { stopSync, isSyncing, __setRemoteFactory } from '../../src/lib/sync';
import { authState, syncState } from '../../src/lib/store';
import { initSyncController, notifySubscriptionChanged } from '../../src/lib/sync-controller';

function mockSubscription(active: boolean) {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ active }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ));
}

const tick = () => new Promise(r => setTimeout(r, 50));

let dispose: (() => void) | null = null;

beforeEach(() => {
  setDB(freshDB() as unknown as PouchDB.Database<NoteDoc>);
  __setRemoteFactory(() => freshDB('remote') as unknown as PouchDB.Database<NoteDoc>);
  authState.value = { status: 'anonymous' };
  syncState.value = { status: 'offline' };
});

afterEach(() => {
  dispose?.();
  dispose = null;
  stopSync();
  __setRemoteFactory(null);
  vi.unstubAllGlobals();
});

describe('sync-controller', () => {
  it('로그인 + 활성 구독이면 동기화를 켠다', async () => {
    mockSubscription(true);
    dispose = initSyncController();
    authState.value = { status: 'authenticated', pubkey: 'ab'.repeat(33) };
    await tick();
    expect(isSyncing()).toBe(true);
  });

  it('구독이 없으면 로그인해도 켜지 않는다', async () => {
    mockSubscription(false);
    dispose = initSyncController();
    authState.value = { status: 'authenticated', pubkey: 'ab'.repeat(33) };
    await tick();
    expect(isSyncing()).toBe(false);
  });

  it('로그아웃하면 끈다', async () => {
    mockSubscription(true);
    dispose = initSyncController();
    authState.value = { status: 'authenticated', pubkey: 'ab'.repeat(33) };
    await tick();
    expect(isSyncing()).toBe(true);
    authState.value = { status: 'anonymous' };
    await tick();
    expect(isSyncing()).toBe(false);
  });

  it('구독 확인 fetch 가 죽어도 조용히 꺼진 상태를 유지한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    dispose = initSyncController();
    authState.value = { status: 'authenticated', pubkey: 'ab'.repeat(33) };
    await tick();
    expect(isSyncing()).toBe(false);
  });

  it('결제 확정 통지(notifySubscriptionChanged)로 재평가한다', async () => {
    mockSubscription(false);
    dispose = initSyncController();
    authState.value = { status: 'authenticated', pubkey: 'ab'.repeat(33) };
    await tick();
    expect(isSyncing()).toBe(false);
    mockSubscription(true);
    notifySubscriptionChanged();
    await tick();
    expect(isSyncing()).toBe(true);
  });

  it('dispose 하면 동기화도 함께 멎는다', async () => {
    mockSubscription(true);
    dispose = initSyncController();
    authState.value = { status: 'authenticated', pubkey: 'ab'.repeat(33) };
    await tick();
    expect(isSyncing()).toBe(true);
    dispose();
    dispose = null;
    expect(isSyncing()).toBe(false);
  });
});
