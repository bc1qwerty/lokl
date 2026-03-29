import { useRef, useEffect } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import { EditorView, keymap, ViewPlugin, Decoration, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { currentFileContent, savedContent, isReadOnly, currentFilePath } from '../lib/store';
import { theme } from '../lib/theme';

const lightTheme = EditorView.theme({}, { dark: false });
const themeCompartment = new Compartment();
const readOnlyCompartment = new Compartment();

// Wiki-link decoration
const wikilinkDeco = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const widgets: ReturnType<typeof Decoration.mark>[] = [];
      const ranges: { from: number; to: number; deco: ReturnType<typeof Decoration.mark> }[] = [];
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        const re = /\[\[([^\]]+)\]\]/g;
        let m;
        while ((m = re.exec(text)) !== null) {
          const start = from + m.index;
          const end = start + m[0].length;
          // Brackets
          ranges.push({ from: start, to: start + 2, deco: Decoration.mark({ class: 'cm-wikilink-bracket' }) });
          ranges.push({ from: end - 2, to: end, deco: Decoration.mark({ class: 'cm-wikilink-bracket' }) });
          // Content
          ranges.push({ from: start + 2, to: end - 2, deco: Decoration.mark({ class: 'cm-wikilink' }) });
        }
      }
      ranges.sort((a, b) => a.from - b.from || a.to - b.to);
      return Decoration.set(ranges.map((r) => r.deco.range(r.from, r.to)));
    }
  },
  { decorations: (v) => v.decorations }
);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function getExtensions(): Extension[] {
  return [
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.lineWrapping,
    wikilinkDeco,
    themeCompartment.of(theme.value === 'dark' ? oneDark : lightTheme),
    readOnlyCompartment.of(EditorState.readOnly.of(isReadOnly.value)),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const content = update.state.doc.toString();
        currentFileContent.value = content;
      }
    }),
  ];
}

export function Editor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: currentFileContent.value,
        extensions: getExtensions(),
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Sync document when file changes
  useSignalEffect(() => {
    const view = viewRef.current;
    const path = currentFilePath.value;
    const content = savedContent.value;
    if (!view || path === null) return;

    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
    }
  });

  // Sync theme
  useSignalEffect(() => {
    const view = viewRef.current;
    const t = theme.value;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.reconfigure(t === 'dark' ? oneDark : lightTheme),
    });
  });

  // Sync read-only
  useSignalEffect(() => {
    const view = viewRef.current;
    const ro = isReadOnly.value;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(ro)),
    });
  });

  return <div ref={containerRef} class="editor-pane" />;
}
