import { useSignal } from '@preact/signals';
import { t, tf } from '../i18n';
import { importFromFSAA, describeImport, announceImport, isNativeSupported } from '../lib/migrate';
import { toast } from '../lib/toast';

interface Props {
  onLoadComplete: () => Promise<void>;
}

export function WelcomeScreen({ onLoadComplete }: Props) {
  const loading = useSignal(false);
  const dragover = useSignal(false);
  const progress = useSignal('');
  const str = t.value.welcome;
  const m = t.value.msg;

  // Shared by the picker and the drop path. The outcome is always shown: a partial
  // import used to look complete, and a failed one left the screen without a word.
  async function runImport(handle: FileSystemDirectoryHandle) {
    progress.value = m.importing;
    const report = await importFromFSAA(handle, (current, total) => {
      progress.value = tf(m.importingProgress, { current, total });
    });
    const summary = describeImport(report);
    if (report.imported + report.unchanged + report.conflicts.length === 0) {
      // Nothing came in — stay here instead of opening an empty vault as if it worked.
      toast.error(report.skipped.length ? summary : m.noMarkdown);
      progress.value = '';
      return;
    }
    announceImport(report);
    progress.value = tf(m.importedLoading, { n: report.imported });
    await onLoadComplete();
  }

  async function handleImportFolder() {
    if (!isNativeSupported()) return;
    loading.value = true;
    progress.value = m.selectingFolder;
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await runImport(handle);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        console.error('Import failed:', e);
        toast.error(tf(m.importFailed, { error: (e as Error)?.message ?? m.unknownError }));
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
        try {
          await runImport(handle as FileSystemDirectoryHandle);
        } catch (err) {
          console.error('Drop import failed:', err);
          toast.error(tf(m.importFailed, { error: (err as Error)?.message ?? m.unknownError }));
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
        await onLoadComplete();
    } finally {
      loading.value = false;
    }
  }

  return (
    <main
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
            {m.startFresh}
          </button>

          {isNativeSupported() && (
            <button class="welcome-btn" style="margin-top:8px" onClick={handleImportFolder} disabled={loading.value}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              {m.importFromFolder}
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
    </main>
  );
}
