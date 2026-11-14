// 로그인·구독 상태에 따라 PouchDB 동기화를 켜고 끄는 유일한 배선 지점.
// startSync/stopSync 자체는 구현돼 있었지만 어디서도 호출되지 않아 유료
// 동기화가 실제로는 도는 적이 없었다(2026-09-05 인증 지도 갭 ⑤).
// 서버(api.txid.uk /lokl/db)는 구독을 자체 검증하므로 이 게이트는 UX 용이다
// — 구독 없이 startSync 를 불러도 서버가 거부해 에러 상태만 띄운다.
import { effect } from '@preact/signals';
import { authState, syncState } from './store';
import { startSync, stopSync, onSubscriptionLost } from './sync';
import { dbEpoch } from './db';

const API_URL = import.meta.env.VITE_API_URL || 'https://api.txid.uk';

let checkSeq = 0;

// 로컬 DB 는 브라우저당 하나라, 다른 계정으로 로그인해 동기화가 켜지면 앞 계정의 노트가
// 새 계정 서버로 올라가고 두 계정의 노트가 섞인다. 마지막으로 동기화한 계정을 기억해 두고,
// 달라지면 켜기 전에 한 번 묻는다. 거절해도 로컬 노트는 그대로다(동기화만 꺼 둔다).
const SYNC_OWNER_NAME = 'lokl-sync-owner';
let declinedFor: string | null = null;

function ownerAllows(pubkey: string | undefined): boolean {
  if (!pubkey) return true;
  let owner: string | null = null;
  try { owner = localStorage.getItem(SYNC_OWNER_NAME); } catch { return true; }
  if (owner && owner !== pubkey) {
    if (declinedFor === pubkey) return false;
    const ok = typeof confirm === 'function' && confirm(
      'The notes in this browser were synced with a different account. Sync them into this account too? Both accounts\' notes will be merged. Cancel keeps sync off; your notes stay in this browser.',
    );
    if (!ok) { declinedFor = pubkey; return false; }
  }
  declinedFor = null;
  try { localStorage.setItem(SYNC_OWNER_NAME, pubkey); } catch { /* 기억 못 해도 동기화는 한다 */ }
  return true;
}

async function hasActiveSubscription(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/lokl/subscription`, { credentials: 'include' });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.active === true;
  } catch {
    return false;
  }
}

async function evaluate(): Promise<void> {
  const seq = ++checkSeq;
  if (authState.value.status !== 'authenticated') {
    stopSync();
    return;
  }
  const active = await hasActiveSubscription();
  // 확인 중에 로그아웃/재로그인이 겹치면 낡은 응답으로 켜고 끄지 않는다.
  if (seq !== checkSeq) return;
  if (active && !ownerAllows(authState.value.pubkey)) {
    stopSync();
    syncState.value = { status: 'error', error: 'Sync is off: these notes belong to another account' };
  } else if (active) {
    startSync();
  } else {
    stopSync();
  }
}

/** 구독 결제가 방금 확정됐을 때(SubscriptionPanel) 재평가를 요청한다. */
export function notifySubscriptionChanged(): void {
  void evaluate();
}

/** app 기동 시 1회 연결. 반환값은 dispose (effect 해제 + 동기화 중지). */
export function initSyncController(): () => void {
  const dispose = effect(() => {
    // effect 는 authState 구독용으로만 쓴다. evaluate 는 stopSync 를 통해
    // syncState 를 읽고-쓰는데, effect 실행 중에 하면 그 읽기가 의존성으로
    // 잡혀 signals 가 "Cycle detected" 를 던진다 — 마이크로태스크로 미뤄
    // effect 추적 밖에서 실행한다.
    void authState.value.status;
    // …and the database handle: a replaced handle (reopenDB) needs a new sync.
    void dbEpoch.value;
    queueMicrotask(() => { void evaluate(); });
  });
  // 구독 확인 fetch 순단(오프라인 기동·api 순단)이 '구독 없음'으로 그 세션
  // 내내 굳지 않도록, 네트워크 복귀 시 재평가한다.
  // The server refused a sync request for lack of a subscription (it lapsed mid-session).
  onSubscriptionLost(() => { void evaluate(); });
  const onOnline = () => { void evaluate(); };
  window.addEventListener('online', onOnline);
  return () => {
    dispose();
    window.removeEventListener('online', onOnline);
    onSubscriptionLost(null);
    stopSync();
  };
}
