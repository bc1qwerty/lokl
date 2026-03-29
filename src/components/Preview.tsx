import { useRef, useEffect } from 'preact/hooks';
import { currentFileContent, currentFilePath } from '../lib/store';
import { renderMarkdown } from '../lib/markdown';
import { t } from '../i18n';

interface Props {
  onNavigate: (path: string) => void;
}

export function Preview({ onNavigate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const content = currentFileContent.value;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const link = target.closest('[data-wikilink]') as HTMLElement;
      if (link) {
        e.preventDefault();
        const path = link.getAttribute('data-wikilink');
        if (path) onNavigate(path);
      }
    }

    el.addEventListener('click', handleClick);
    return () => el.removeEventListener('click', handleClick);
  }, [onNavigate]);

  if (!currentFilePath.value) {
    return (
      <div class="preview-pane" style="display: flex; align-items: center; justify-content: center; color: var(--text-muted)">
        {t.value.preview.empty}
      </div>
    );
  }

  const html = renderMarkdown(content);

  return (
    <div class="preview-pane" ref={containerRef}>
      <div
        class="markdown-preview"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
