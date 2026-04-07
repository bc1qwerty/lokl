import { useSignal } from '@preact/signals';
import { authState } from '../lib/store';
import { startLogin, startPolling, logout } from '../lib/auth';
import { startSync, stopSync } from '../lib/sync';

export function LoginPanel() {
  const lnurl = useSignal('');
  const k1 = useSignal('');
  const error = useSignal('');
  const cancelPoll = useSignal<(() => void) | null>(null);

  const handleLogin = async () => {
    error.value = '';
    try {
      const result = await startLogin();
      lnurl.value = result.lnurl;
      k1.value = result.k1;
      authState.value = { status: 'polling' };

      const cancel = startPolling(
        result.k1,
        (jwt, pubkey) => {
          authState.value = { status: 'authenticated', jwt, pubkey };
          lnurl.value = '';
          k1.value = '';
          startSync();
        },
        (err) => {
          error.value = err.message;
          authState.value = { status: 'anonymous' };
        },
      );
      cancelPoll.value = cancel;
    } catch (e) {
      error.value = (e as Error).message;
    }
  };

  const handleLogout = async () => {
    cancelPoll.value?.();
    stopSync();
    await logout();
    authState.value = { status: 'anonymous' };
  };

  const handleCancel = () => {
    cancelPoll.value?.();
    authState.value = { status: 'anonymous' };
    lnurl.value = '';
    k1.value = '';
  };

  const auth = authState.value;

  if (auth.status === 'authenticated') {
    const short = auth.pubkey ? auth.pubkey.slice(0, 8) + '...' + auth.pubkey.slice(-4) : '';
    return (
      <div class="login-panel">
        <div class="login-info" style="display:flex; align-items:center; gap:6px">
          <span style="font-size:11px; color:var(--text-muted)" title={auth.pubkey}>{short}</span>
          <button class="btn-secondary" style="font-size:11px; padding:2px 6px" onClick={handleLogout}>Logout</button>
        </div>
      </div>
    );
  }

  if (auth.status === 'polling') {
    return (
      <div class="login-panel" style="padding:8px">
        <p style="font-size:12px; color:var(--text-muted); margin:0 0 8px">
          Scan with Lightning wallet or copy LNURL:
        </p>
        <input
          type="text"
          value={lnurl.value}
          readOnly
          style="font-size:10px; width:100%; padding:4px; border:1px solid var(--border); border-radius:4px; background:var(--bg-secondary); color:var(--text-primary); box-sizing:border-box"
          onClick={(e) => (e.target as HTMLInputElement).select()}
        />
        <div style="display:flex; gap:4px; margin-top:6px">
          <button
            class="btn-secondary"
            style="font-size:11px; padding:2px 6px"
            onClick={() => navigator.clipboard.writeText(lnurl.value)}
          >Copy</button>
          <button
            class="btn-secondary"
            style="font-size:11px; padding:2px 6px"
            onClick={handleCancel}
          >Cancel</button>
        </div>
        <p style="font-size:11px; color:var(--text-muted); margin:6px 0 0">Waiting for wallet...</p>
        {error.value && <p style="color:var(--error); font-size:12px; margin:4px 0 0">{error.value}</p>}
      </div>
    );
  }

  return (
    <div class="login-panel" style="padding:4px 0">
      <button class="btn-primary" style="font-size:11px; padding:3px 8px; width:100%" onClick={handleLogin}>Login with Lightning</button>
      {error.value && <p style="color:var(--error); font-size:12px; margin:4px 0 0">{error.value}</p>}
    </div>
  );
}
