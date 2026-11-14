import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { setDB } from '../../src/lib/db';
import type { NoteDoc } from '../../src/lib/db';
import { stopSync, isSyncing, __setRemoteFactory } from '../../src/lib/sync';
import { authState, syncState } from '../../src/lib/store';
import { initSyncController, notifySubscriptionChanged, __setRecheckBase } from '../../src/lib/sync-controller';

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
  localStorage.removeItem('lokl-sync-owner');
});

afterEach(async () => {
  dispose?.();
  dispose = null;
  stopSync();
  // PouchDB sync 취소는 비동기로 이벤트를 몇 번 더 뱉는다 — 리모트 팩토리와
  // fetch 스텁을 걷기 전에 배출을 기다려야 다음 테스트로 unhandled 가 새지 않는다.
  await tick();
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

  // 실패(순단·5xx·429)는 «구독 없음» 이 아니라 «모름» 이다: 상태를 그대로 두고 다시 묻는다.
  it('구독 확인이 실패하면 꺼진 채로 두되, 스스로 다시 확인해 켠다', async () => {
    __setRecheckBase(20);
    let up = false;
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (!up) return new Response('bad gateway', { status: 502 });
      return new Response(JSON.stringify({ active: true }), { status: 200 });
    }));
    dispose = initSyncController();
    authState.value = { status: 'authenticated', pubkey: 'ab'.repeat(33) };
    await tick();
    expect(isSyncing()).toBe(false);
    up = true; // online 이벤트도, 새로고침도 없이
    await new Promise(r => setTimeout(r, 300));
    expect(isSyncing()).toBe(true);
    __setRecheckBase(null);
  });

  it('돌던 동기화는 구독 확인 실패(502·429·순단) 한 번으로 꺼지지 않는다', async () => {
    __setRecheckBase(20);
    mockSubscription(true);
    dispose = initSyncController();
    authState.value = { status: 'authenticated', pubkey: 'ab'.repeat(33) };
    await tick();
    expect(isSyncing()).toBe(true);
    for (const bad of [() => new Response('x', { status: 502 }), () => new Response('x', { status: 429 }), () => { throw new Error('network'); }]) {
      vi.stubGlobal('fetch', vi.fn(async () => bad()));
      window.dispatchEvent(new Event('online'));
      await tick();
      expect(isSyncing()).toBe(true);
    }
    // 서버가 분명히 답하면 끈다.
    mockSubscription(false);
    await new Promise(r => setTimeout(r, 500));
    expect(isSyncing()).toBe(false);
    __setRecheckBase(null);
  });

  it('401 은 «모름» 이 아니다 — 끈다', async () => {
    mockSubscription(true);
    dispose = initSyncController();
    authState.value = { status: 'authenticated', pubkey: 'ab'.repeat(33) };
    await tick();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    notifySubscriptionChanged();
    await tick();
    expect(isSyncing()).toBe(false);
  });

  it('fetch 순단으로 꺼졌어도 online 복귀 시 재평가해 켠다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    dispose = initSyncController();
    authState.value = { status: 'authenticated', pubkey: 'ab'.repeat(33) };
    await tick();
    expect(isSyncing()).toBe(false);
    mockSubscription(true);
    window.dispatchEvent(new Event('online'));
    await tick();
    expect(isSyncing()).toBe(true);
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
  // 로컬 DB 는 계정과 무관하게 하나다 — 다른 계정으로 켜지면 두 계정의 노트가 섞여 올라간다.
  it('다른 계정으로 로그인하면 묻고, 거절하면 켜지 않는다(다시 묻지도 않는다)', async () => {
    mockSubscription(true);
    const ask = vi.fn(() => false);
    vi.stubGlobal('confirm', ask);
    dispose = initSyncController();
    authState.value = { status: 'authenticated', pubkey: 'ab'.repeat(33) };
    await tick();
    expect(isSyncing()).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    authState.value = { status: 'anonymous' };
    await tick();
    authState.value = { status: 'authenticated', pubkey: 'cd'.repeat(33) };
    await tick();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(isSyncing()).toBe(false);
    expect(syncState.value.status).toBe('error');
    notifySubscriptionChanged();
    await tick();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(isSyncing()).toBe(false);
    // 원래 계정으로 돌아오면 묻지 않고 켠다.
    authState.value = { status: 'anonymous' };
    await tick();
    authState.value = { status: 'authenticated', pubkey: 'ab'.repeat(33) };
    await tick();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(isSyncing()).toBe(true);
  });

  it('다른 계정이어도 승낙하면 켜고 그 계정을 기억한다', async () => {
    mockSubscription(true);
    localStorage.setItem('lokl-sync-owner', 'ab'.repeat(33));
    vi.stubGlobal('confirm', vi.fn(() => true));
    dispose = initSyncController();
    authState.value = { status: 'authenticated', pubkey: 'cd'.repeat(33) };
    await tick();
    expect(isSyncing()).toBe(true);
    expect(localStorage.getItem('lokl-sync-owner')).toBe('cd'.repeat(33));
  });
});
