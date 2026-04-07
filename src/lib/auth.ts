const API_URL = import.meta.env.VITE_API_URL || 'https://api.txid.uk';

export interface AuthData {
  status: 'anonymous' | 'polling' | 'authenticated';
  pubkey?: string;
  jwt?: string;
  k1?: string;
  lnurl?: string;
}

const STORAGE_KEY = 'lokl-auth';

export function getStoredAuth(): { jwt: string; pubkey: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { jwt, pubkey } = JSON.parse(raw);
    if (jwt && pubkey) return { jwt, pubkey };
  } catch { /* ignore */ }
  return null;
}

export function storeAuth(jwt: string, pubkey: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ jwt, pubkey }));
}

export function clearAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export async function startLogin(): Promise<{ lnurl: string; k1: string; qr: string }> {
  const res = await fetch(`${API_URL}/auth/challenge`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to start login');
  return res.json();
}

export async function pollLogin(k1: string): Promise<{ status: string; token?: string; pubkey?: string }> {
  const res = await fetch(`${API_URL}/auth/status/${encodeURIComponent(k1)}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Poll failed');
  return res.json();
}

export function startPolling(
  k1: string,
  onSuccess: (jwt: string, pubkey: string) => void,
  onError?: (err: Error) => void,
): () => void {
  const es = new EventSource(`${API_URL}/auth/status/${k1}`, { withCredentials: true });
  const timeout = setTimeout(() => { es.close(); }, 5 * 60 * 1000);

  es.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.event === 'login' && data.sessionToken && data.pubkey) {
        es.close();
        clearTimeout(timeout);
        // Set HttpOnly session cookie
        await fetch(`${API_URL}/auth/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ token: data.sessionToken }),
        });
        storeAuth(data.sessionToken, data.pubkey);
        onSuccess(data.sessionToken, data.pubkey);
      }
    } catch (e) {
      onError?.(e as Error);
    }
  };

  es.onerror = () => {
    // SSE reconnects automatically, but check if challenge was completed
    fetch(`${API_URL}/auth/status/${k1}`, { credentials: 'include' })
      .then(r => r.json())
      .then(async (data) => {
        if (data.event === 'login' && data.sessionToken && data.pubkey) {
          es.close();
          clearTimeout(timeout);
          await fetch(`${API_URL}/auth/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ token: data.sessionToken }),
          });
          storeAuth(data.sessionToken, data.pubkey);
          onSuccess(data.sessionToken, data.pubkey);
        }
      })
      .catch(() => {});
  };

  return () => { es.close(); clearTimeout(timeout); };
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch { /* ignore */ }
  clearAuth();
}
