import { useEffect, useMemo, useState } from 'preact/hooks';
import { currentFileContent, currentFilePath, allFilePaths } from '../lib/store';
import { renderMarkdown } from '../lib/markdown';
import { t } from '../i18n';

interface Props {
  onNavigate: (path: string) => void;
}

// Rendering a ~1MB note takes over 100ms, and in split view that ran on every keystroke.
// Small notes still render in step with typing; big ones trail it by a moment.
const BIG_NOTE = 100_000;
const BIG_NOTE_DELAY = 300;

export function Preview({ onNavigate }: Props) {
  const live = currentFileContent.value;
  const path = currentFilePath.value;
  const big = live.length > BIG_NOTE;
  const [late, setLate] = useState({ path, content: live });
  useEffect(() => {
    if (!big) return;
    const id = setTimeout(() => setLate({ path, content: live }), BIG_NOTE_DELAY);
    return () => clearTimeout(id);
  }, [big, path, live]);
  // A different note never shows the previous note's text: the trailing copy is used only for the same path.
  const content = big && late.path === path ? late.content : live;

  // 🔴 This was a listener attached in an effect to the pane's ref. The pane with
  //    the ref only exists once a note is open, the effect ran once at mount (no
  //    note yet) and never again — so clicking a [[wiki-link]] in the preview did
  //    nothing at all unless the view mode had been toggled since. Bind it in JSX.
  function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest('[data-wikilink]') as HTMLElement | null;
    if (!link) return;
    e.preventDefault();
    const path = link.getAttribute('data-wikilink');
    if (path) onNavigate(path);
  }

  // Not on every render: a sync status change or a toast re-rendered the pane and re-parsed a
  // large note each time. The note list is a dependency because it decides which [[links]] resolve.
  const paths = allFilePaths.value;
  const html = useMemo(() => renderMarkdown(content), [content, paths]);

  if (!currentFilePath.value) {
    return (
      <div class="preview-pane" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted)">
        {t.value.preview.empty}
      </div>
    );
  }

  return (
    <div class="preview-pane" onClick={handleClick}>
      <div class="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
