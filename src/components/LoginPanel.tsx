import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { authState } from '../lib/store';
import { loadSDK, openLogin, getUser, onAuthChange, type TxidUser } from '../lib/auth';
// sync is gated by subscription, not auto-started on login

export function LoginPanel() {
  const ready = useSignal(false);

  useEffect(() => {
    loadSDK().then(() => {
      ready.value = true;

      // SDK init is async, wait briefly for session check
      setTimeout(() => {
        const user = getUser();
        if (user?.authenticated) {
          authState.value = { status: 'authenticated', pubkey: user.pubkey };
        }
      }, 500);

      // Listen for auth changes
      onAuthChange((user: TxidUser | null) => {
        if (user?.authenticated) {
          authState.value = { status: 'authenticated', pubkey: user.pubkey };
          } else {
          authState.value = { status: 'anonymous' };
        }
      });
    });
  }, []);

  const auth = authState.value;

  if (!ready.value) return null;

  if (auth.status === 'authenticated') {
    const short = auth.pubkey ? auth.pubkey.slice(0, 8) + '...' + auth.pubkey.slice(-4) : '';
    return (
      <div class="login-panel" style="padding:4px 0">
        <span style="font-size:11px; color:var(--text-muted)" title={auth.pubkey}>{short}</span>
      </div>
    );
  }

  return (
    <div class="login-panel" style="padding:4px 0">
      <button
        class="btn-primary"
        style="font-size:11px; padding:3px 8px; width:100%"
        onClick={openLogin}
      >Login with Lightning</button>
    </div>
  );
}
