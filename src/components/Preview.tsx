import { useRef, useEffect } from 'preact/hooks';
import { currentFileContent, currentFilePath, vault } from '../lib/store';
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

  // Resolve local images to blob URLs
  useEffect(() => {
    const el = containerRef.current;
    const v = vault.value;
    if (!el || !v || v.mode !== 'native' || !v.handle) return;

    const images = el.querySelectorAll('img[src]');
    for (const img of images) {
      const src = img.getAttribute('src') || '';
      if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('blob:')) continue;

      // Resolve relative path
      const currentDir = currentFilePath.value?.includes('/')
        ? currentFilePath.value.substring(0, currentFilePath.value.lastIndexOf('/'))
        : '';
      const imgPath = src.startsWith('/') ? src.slice(1) : (currentDir ? `${currentDir}/${src}` : src);

      (async () => {
        try {
          const parts = imgPath.split('/');
          let dir = v.handle!;
          for (let i = 0; i < parts.length - 1; i++) {
            dir = await dir.getDirectoryHandle(parts[i]);
          }
          const fh = await dir.getFileHandle(parts[parts.length - 1]);
          const file = await fh.getFile();
          const url = URL.createObjectURL(file);
          (img as HTMLImageElement).src = url;
        } catch { /* image not found */ }
      })();
    }
  });

  if (!currentFilePath.value) {
    return (
      <div class="preview-pane" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted)">
        {t.value.preview.empty}
      </div>
    );
  }

  const html = renderMarkdown(content);

  return (
    <div class="preview-pane" ref={containerRef}>
      <div class="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
