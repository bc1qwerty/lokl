import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { authState } from '../lib/store';

const API_URL = import.meta.env.VITE_API_URL || 'https://api.txid.uk';

const PLANS = [
  { id: '1m', label: '1 Month', sats: 5000 },
  { id: '3m', label: '3 Months', sats: 10000, badge: 'Save 33%' },
  { id: '6m', label: '6 Months', sats: 20000, badge: 'Save 33%' },
  { id: '1y', label: '1 Year', sats: 30000, badge: 'Best value' },
];

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
      if (res.ok) sub.value = await res.json();
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
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed');
      }
      const data = await res.json();
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
          error.value = 'Payment timeout';
        }
      }, 15 * 60 * 1000);
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }

  if (authState.value.status !== 'authenticated') return null;

  // Active subscription
  if (sub.value?.active) {
    const planLabel = PLANS.find(p => p.id === sub.value!.plan)?.label || sub.value.plan;
    return (
      <div style="margin-top:4px">
        <div style="display:flex; justify-content:space-between; align-items:center">
          <span style="font-size:12px; color:#22c55e; font-weight:600">Active — {planLabel}</span>
          <span style="font-size:11px; color:var(--text-muted)">{sub.value.daysLeft}d left</span>
        </div>
      </div>
    );
  }

  // Payment invoice shown
  if (invoice.value) {
    return (
      <div style="margin-top:8px">
        <p style="font-size:12px; color:var(--text-muted); margin:0 0 6px">Pay with Lightning:</p>
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
            onClick={() => navigator.clipboard.writeText(invoice.value!.paymentRequest)}>Copy Invoice</button>
          <a href={`lightning:${invoice.value.paymentRequest}`} class="btn-primary"
            style="font-size:11px; padding:2px 6px; flex:1; text-align:center; text-decoration:none">Open Wallet</a>
        </div>
        {checking.value && <p style="font-size:11px; color:var(--text-muted); margin:6px 0 0">Waiting for payment...</p>}
        <button class="btn-secondary" style="font-size:11px; padding:2px 6px; margin-top:4px; width:100%"
          onClick={() => { invoice.value = null; checking.value = false; if (pollTimer.value) { clearInterval(pollTimer.value); pollTimer.value = null; } }}>Cancel</button>
      </div>
    );
  }

  // Plan selection
  return (
    <div style="margin-top:8px">
      <p style="font-size:11px; color:var(--text-muted); margin:0 0 6px">Subscribe to enable cloud sync:</p>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px">
        {PLANS.map(plan => (
          <button
            key={plan.id}
            class="btn-secondary"
            style="font-size:11px; padding:6px 4px; text-align:center; position:relative"
            disabled={loading.value}
            onClick={() => handleSubscribe(plan.id)}
          >
            <div style="font-weight:600">{plan.label}</div>
            <div style="color:var(--text-muted); font-size:10px">{plan.sats.toLocaleString()} sats</div>
            {plan.badge && <div style="font-size:9px; color:#f59e0b">{plan.badge}</div>}
          </button>
        ))}
      </div>
      {error.value && <p style="font-size:11px; color:#ef4444; margin:4px 0 0">{error.value}</p>}
    </div>
  );
}
