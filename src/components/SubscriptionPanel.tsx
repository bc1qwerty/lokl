import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { authState, syncState } from '../lib/store';
import { notifySubscriptionChanged } from '../lib/sync-controller';
import { t, tf } from '../i18n';

const API_URL = import.meta.env.VITE_API_URL || 'https://api.txid.uk';

const PLANS = [
  { id: '1m', label: 'plan1m', sats: 5000 },
  { id: '3m', label: 'plan3m', sats: 10000, badge: 'save33' },
  { id: '6m', label: 'plan6m', sats: 20000, badge: 'save33' },
  { id: '1y', label: 'plan1y', sats: 30000, badge: 'bestValue' },
] as const;

interface Subscription {
  active: boolean;
  plan?: string;
  expiresAt?: number;
  daysLeft?: number;
}

export function SubscriptionPanel() {
  const sub = useSignal<Subscription | null>(null);
  const loading = useSignal(false);
  const invoice = useSignal<{ paymentRequest: string; paymentHash: string; qr?: string } | null>(null);
  const checking = useSignal(false);
  const error = useSignal('');
  const pollTimer = useSignal<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (authState.value.status === 'authenticated') fetchSubscription();
    return () => { if (pollTimer.value) clearInterval(pollTimer.value); };
  }, []);

  async function fetchSubscription() {
    try {
      const res = await fetch(`${API_URL}/lokl/subscription`, { credentials: 'include' });
      if (res.ok) {
        sub.value = await res.json();
        // Paid while this panel was closed (the poll below dies with it), or renewed on another
        // device: nobody else tells the controller. A running sync is not restarted by this.
        if (sub.value?.active && syncState.value.status === 'offline') notifySubscriptionChanged(true);
      }
    } catch { /* ignore */ }
  }

  async function handleSubscribe(planId: string) {
    error.value = '';
    loading.value = true;
    try {
      const res = await fetch(`${API_URL}/lokl/subscribe`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      });
      // The server's own wording (and a JSON parse error when a proxy answers in HTML) is not
      // something to show in eight languages.
      if (!res.ok) throw new Error(res.status === 401 ? t.value.msg.sessionExpired : t.value.msg.subscribeFailed);
      const data = await res.json().catch(() => null);
      if (!data?.paymentHash) throw new Error(t.value.msg.subscribeFailed);
      invoice.value = data;

      // Start polling for payment
      if (pollTimer.value) clearInterval(pollTimer.value);
      checking.value = true;
      pollTimer.value = setInterval(async () => {
        try {
          const r = await fetch(`${API_URL}/lokl/payment/${data.paymentHash}`, { credentials: 'include' });
          if (r.ok) {
            const result = await r.json();
            if (result.paid) {
              clearInterval(pollTimer.value!);
              pollTimer.value = null;
              invoice.value = null;
              checking.value = false;
              // 결제 확정은 auth 상태 변화가 아니라서 컨트롤러가 못 본다 — fetchSubscription 이 재평가를 부른다.
              await fetchSubscription();
            }
          }
        } catch { /* retry */ }
      }, 3000);

      // Stop polling after 15 min
      setTimeout(() => {
        if (pollTimer.value) {
          clearInterval(pollTimer.value);
          pollTimer.value = null;
          checking.value = false;
          error.value = t.value.msg.paymentTimeout;
        }
      }, 15 * 60 * 1000);
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }

  if (authState.value.status !== 'authenticated') return null;
  const m = t.value.msg;

  // Active subscription
  if (sub.value?.active) {
    const plan = PLANS.find(p => p.id === sub.value!.plan);
    const planLabel = plan ? m[plan.label] : (sub.value.plan ?? '');
    return (
      <div style="margin-top:4px">
        <div style="display:flex; justify-content:space-between; align-items:center">
          <span style="font-size:12px; color:#22c55e; font-weight:600">{tf(m.subActive, { plan: planLabel })}</span>
          <span style="font-size:11px; color:var(--text-muted)">{tf(m.daysLeft, { n: sub.value.daysLeft ?? 0 })}</span>
        </div>
      </div>
    );
  }

  // Payment invoice shown
  if (invoice.value) {
    return (
      <div style="margin-top:8px">
        <p style="font-size:12px; color:var(--text-muted); margin:0 0 6px">{m.payLightning}</p>
        {invoice.value.qr && window.innerWidth >= 768 && (
          <div style="text-align:center; margin-bottom:8px">
            <img src={invoice.value.qr} alt="Lightning QR" width="200" height="200" style="border-radius:8px" />
          </div>
        )}
        <input
          type="text"
          value={invoice.value.paymentRequest}
          readOnly
          style="font-size:9px; width:100%; padding:4px; border:1px solid var(--border); border-radius:4px; background:var(--bg-secondary); color:var(--text-primary); box-sizing:border-box"
          onClick={(e) => (e.target as HTMLInputElement).select()}
        />
        <div style="display:flex; gap:4px; margin-top:4px">
          <button class="btn-secondary" style="font-size:11px; padding:2px 6px; flex:1"
            onClick={() => navigator.clipboard.writeText(invoice.value!.paymentRequest)}>{m.copyInvoice}</button>
          <a href={`lightning:${invoice.value.paymentRequest}`} class="btn-primary"
            style="font-size:11px; padding:2px 6px; flex:1; text-align:center; text-decoration:none">{m.openWallet}</a>
        </div>
        {checking.value && <p style="font-size:11px; color:var(--text-muted); margin:6px 0 0">{m.waitingPayment}</p>}
        <button class="btn-secondary" style="font-size:11px; padding:2px 6px; margin-top:4px; width:100%"
          onClick={() => { invoice.value = null; checking.value = false; if (pollTimer.value) { clearInterval(pollTimer.value); pollTimer.value = null; } }}>{t.value.common.cancel}</button>
      </div>
    );
  }

  // Plan selection
  return (
    <div style="margin-top:8px">
      <p style="font-size:11px; color:var(--text-muted); margin:0 0 6px">{m.subscribePrompt}</p>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px">
        {PLANS.map(plan => (
          <button
            key={plan.id}
            class="btn-secondary"
            style="font-size:11px; padding:6px 4px; text-align:center; position:relative"
            disabled={loading.value}
            onClick={() => handleSubscribe(plan.id)}
          >
            <div style="font-weight:600">{m[plan.label]}</div>
            <div style="color:var(--text-muted); font-size:10px">{plan.sats.toLocaleString()} sats</div>
            {'badge' in plan && <div style="font-size:9px; color:#f59e0b">{m[plan.badge]}</div>}
          </button>
        ))}
      </div>
      {error.value && <p style="font-size:11px; color:#ef4444; margin:4px 0 0">{error.value}</p>}
    </div>
  );
}
