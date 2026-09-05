// 로그인·구독 상태에 따라 PouchDB 동기화를 켜고 끄는 유일한 배선 지점.
// startSync/stopSync 자체는 구현돼 있었지만 어디서도 호출되지 않아 유료
// 동기화가 실제로는 도는 적이 없었다(2026-09-05 인증 지도 갭 ⑤).
// 서버(api.txid.uk /lokl/db)는 구독을 자체 검증하므로 이 게이트는 UX 용이다
// — 구독 없이 startSync 를 불러도 서버가 거부해 에러 상태만 띄운다.
import { effect } from '@preact/signals';
import { authState } from './store';
import { startSync, stopSync } from './sync';

const API_URL = import.meta.env.VITE_API_URL || 'https://api.txid.uk';

let checkSeq = 0;

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
  if (active) {
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
    // effect 는 authState 구독용 — 실제 판정은 비동기 evaluate 가 한다.
    void authState.value.status;
    void evaluate();
  });
  return () => {
    dispose();
    stopSync();
  };
}
