import { useSignal } from '@preact/signals';
import { t } from '../i18n';
import { isNativeSupported, openDirectory, reopenDirectory } from '../lib/fs';
import type { VaultState } from '../types';

interface Props {
  onOpen: (vault: VaultState) => void;
}

export function WelcomeScreen({ onOpen }: Props) {
  const hasStored = useSignal(false);
  const storedName = useSignal('');
  const loading = useSignal(false);
  const str = t.value.welcome;

  // Check for stored handle on mount
  if (isNativeSupported()) {
    reopenDirectory().then((vault) => {
      // Only update if we can silently check (won't prompt)
      // We just check existence, actual reopen needs user gesture
      if (vault) {
        hasStored.value = true;
        storedName.value = vault.name;
      }
    }).catch(() => {});
  }

  async function handleOpen() {
    loading.value = true;
    try {
      const vault = await openDirectory();
      onOpen(vault);
    } catch (e) {
      if ((e as Error).message !== 'Cancelled') {
        console.error('Failed to open directory:', e);
      }
    } finally {
      loading.value = false;
    }
  }

  async function handleReopen() {
    loading.value = true;
    try {
      const vault = await reopenDirectory();
      if (vault) onOpen(vault);
    } catch {
      // Permission denied, fall through
    } finally {
      loading.value = false;
    }
  }

  return (
    <div class="welcome">
      <div class="welcome-logo">Lokl</div>
      <p class="welcome-tagline">{str.subtitle}</p>

      <button class="welcome-btn" onClick={handleOpen} disabled={loading.value}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        {str.openButton}
      </button>

      {hasStored.value && (
        <button class="welcome-reopen" onClick={handleReopen} disabled={loading.value}>
          {str.reopenButton} "{storedName.value}"
        </button>
      )}

      <div class="welcome-features">
        <div class="welcome-feature">
          <span class="welcome-feature-icon">&#9889;</span>
          {str.features.offline}
        </div>
        <div class="welcome-feature">
          <span class="welcome-feature-icon">&#128279;</span>
          {str.features.wikilinks}
        </div>
        <div class="welcome-feature">
          <span class="welcome-feature-icon">&#128269;</span>
          {str.features.search}
        </div>
        <div class="welcome-feature">
          <span class="welcome-feature-icon">&#128274;</span>
          {str.features.privacy}
        </div>
      </div>

      <p class="welcome-privacy">{str.privacyNote}</p>

      {!isNativeSupported() && (
        <div class="welcome-unsupported">{str.unsupported}</div>
      )}
    </div>
  );
}
