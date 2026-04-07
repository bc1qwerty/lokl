import { useSignal } from '@preact/signals';
import { t } from '../i18n';
import { isNativeSupported } from '../lib/fs';
import { importFromFSAA, markMigrated } from '../lib/migrate';

interface Props {
  onLoadComplete: () => Promise<void>;
}

export function WelcomeScreen({ onLoadComplete }: Props) {
  const loading = useSignal(false);
  const dragover = useSignal(false);
  const progress = useSignal('');
  const str = t.value.welcome;

  async function handleImportFolder() {
    if (!isNativeSupported()) return;
    loading.value = true;
    progress.value = 'Selecting folder...';
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      progress.value = 'Importing files...';
      const count = await importFromFSAA(handle, (current, total) => {
        progress.value = `Importing ${current} / ${total}...`;
      });
      markMigrated();
      progress.value = `Imported ${count} files. Loading...`;
      await onLoadComplete();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        console.error('Import failed:', e);
      }
      progress.value = '';
    } finally {
      loading.value = false;
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    dragover.value = true;
  }
  function handleDragLeave() {
    dragover.value = false;
  }
  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragover.value = false;
    const items = e.dataTransfer?.items;
    if (!items || items.length === 0) return;
    const item = items[0];
    if ('getAsFileSystemHandle' in item) {
      const handle = await (item as any).getAsFileSystemHandle() as FileSystemDirectoryHandle;
      if (handle.kind === 'directory') {
        loading.value = true;
        progress.value = 'Importing files...';
        try {
          const count = await importFromFSAA(handle as FileSystemDirectoryHandle, (current, total) => {
            progress.value = `Importing ${current} / ${total}...`;
          });
          markMigrated();
          progress.value = `Imported ${count} files. Loading...`;
          await onLoadComplete();
        } catch (err) {
          console.error('Drop import failed:', err);
          progress.value = '';
        } finally {
          loading.value = false;
        }
      }
    }
  }

  async function handleStartFresh() {
    loading.value = true;
    try {
      markMigrated();
      await onLoadComplete();
    } finally {
      loading.value = false;
    }
  }

  return (
    <div
      class={`welcome welcome-dropzone${dragover.value ? ' dragover' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div class="welcome-logo">Lokl</div>
      <p class="welcome-tagline">{str.subtitle}</p>

      {progress.value ? (
        <p style="color:var(--text-muted); font-size:14px; margin:16px 0">{progress.value}</p>
      ) : (
        <>
          <button class="welcome-btn" onClick={handleStartFresh} disabled={loading.value}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Start fresh
          </button>

          {isNativeSupported() && (
            <button class="welcome-btn" style="margin-top:8px" onClick={handleImportFolder} disabled={loading.value}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              Import from folder
            </button>
          )}

          <p class="welcome-privacy" style="margin-top:16px">
            {str.dragHint}
            <br />{str.privacyNote}
          </p>
        </>
      )}

      <div class="welcome-features">
        <div class="welcome-feature"><span class="welcome-feature-icon">&#9889;</span>{str.features.offline}</div>
        <div class="welcome-feature"><span class="welcome-feature-icon">&#128279;</span>{str.features.wikilinks}</div>
        <div class="welcome-feature"><span class="welcome-feature-icon">&#128269;</span>{str.features.search}</div>
        <div class="welcome-feature"><span class="welcome-feature-icon">&#128274;</span>{str.features.privacy}</div>
      </div>
    </div>
  );
}
