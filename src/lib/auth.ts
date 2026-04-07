// Thin wrapper around txid-auth.js SDK (window.txidAuth)

declare global {
  interface Window {
    txidAuth?: {
      openLogin: () => void;
      getUser: () => TxidUser | null;
      getCsrfToken: () => string | null;
      onAuthChange: (cb: (user: TxidUser | null) => void) => void;
    };
  }
}

export interface TxidUser {
  authenticated: boolean;
  pubkey: string;
  displayName?: string;
  selectedIcon?: string;
  avatarUrl?: string;
  isAdmin?: boolean;
  csrfToken?: string;
}

const SDK_URL = 'https://api.txid.uk/txid-auth.js';
const SDK_CSS = 'https://api.txid.uk/txid-auth.css';
let sdkLoaded = false;

export function loadSDK(): Promise<void> {
  if (sdkLoaded) return Promise.resolve();

  return new Promise((resolve) => {
    // CSS
    if (!document.getElementById('txid-auth-css')) {
      const link = document.createElement('link');
      link.id = 'txid-auth-css';
      link.rel = 'stylesheet';
      link.href = SDK_CSS;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    }

    // JS
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.defer = true;
    script.onload = () => {
      sdkLoaded = true;
      resolve();
    };
    script.onerror = () => resolve(); // graceful degradation
    document.head.appendChild(script);
  });
}

export function openLogin(): void {
  window.txidAuth?.openLogin();
}

export function getUser(): TxidUser | null {
  return window.txidAuth?.getUser() ?? null;
}

export function onAuthChange(cb: (user: TxidUser | null) => void): void {
  window.txidAuth?.onAuthChange(cb);
}

export function isAuthenticated(): boolean {
  const user = getUser();
  return !!user?.authenticated;
}
