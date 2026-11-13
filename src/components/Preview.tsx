import { currentFileContent, currentFilePath } from '../lib/store';
import { renderMarkdown } from '../lib/markdown';
import { t } from '../i18n';

interface Props {
  onNavigate: (path: string) => void;
}

export function Preview({ onNavigate }: Props) {
  const content = currentFileContent.value;

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

  if (!currentFilePath.value) {
    return (
      <div class="preview-pane" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted)">
        {t.value.preview.empty}
      </div>
    );
  }

  const html = renderMarkdown(content);

  return (
    <div class="preview-pane" onClick={handleClick}>
      <div class="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
