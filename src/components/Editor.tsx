import { useRef, useEffect } from 'preact/hooks';
import { effect, useSignalEffect } from '@preact/signals';
import { EditorView, keymap, ViewPlugin, Decoration, type DecorationSet, type ViewUpdate, lineNumbers } from '@codemirror/view';
import { EditorState, Compartment, Transaction, type Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { currentFileContent, savedContent, currentFilePath, settings } from '../lib/store';
import { theme } from '../lib/theme';
import { t } from '../i18n';

const lightTheme = EditorView.theme({}, { dark: false });
const themeCompartment = new Compartment();
const readOnlyCompartment = new Compartment();
const fontSizeCompartment = new Compartment();
const lineNumbersCompartment = new Compartment();

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
      const ranges: { from: number; to: number; deco: ReturnType<typeof Decoration.mark> }[] = [];
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        const re = /\[\[([^\]]+)\]\]/g;
        let m;
        while ((m = re.exec(text)) !== null) {
          const start = from + m.index;
          const end = start + m[0].length;
          ranges.push({ from: start, to: start + 2, deco: Decoration.mark({ class: 'cm-wikilink-bracket' }) });
          ranges.push({ from: end - 2, to: end, deco: Decoration.mark({ class: 'cm-wikilink-bracket' }) });
          ranges.push({ from: start + 2, to: end - 2, deco: Decoration.mark({ class: 'cm-wikilink' }) });
        }
      }
      ranges.sort((a, b) => a.from - b.from || a.to - b.to);
      return Decoration.set(ranges.map((r) => r.deco.range(r.from, r.to)));
    }
  },
  { decorations: (v) => v.decorations }
);

function fontSizeTheme(size: number) {
  return EditorView.theme({ '.cm-content': { fontSize: `${size}px` }, '.cm-gutters': { fontSize: `${size - 2}px` } });
}

function getExtensions(): Extension[] {
  const s = settings.value;
  return [
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.lineWrapping,
    // Tab indents here, so a keyboard user needs to be told the way out (Esc, then Tab).
    EditorView.contentAttributes.of({ 'aria-description': t.peek().msg.tabHint }),
    wikilinkDeco,
    themeCompartment.of(theme.value === 'dark' ? oneDark : lightTheme),
    readOnlyCompartment.of(EditorState.readOnly.of(false)),
    fontSizeCompartment.of(fontSizeTheme(s.fontSize)),
    lineNumbersCompartment.of(s.editorLineNumbers ? lineNumbers() : []),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        currentFileContent.value = update.state.doc.toString();
      }
    }),
  ];
}

export function Editor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The note the current undo history belongs to.
  const shownPath = useRef<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    shownPath.current = currentFilePath.peek();
    const view = new EditorView({
      state: EditorState.create({ doc: currentFileContent.value, extensions: getExtensions() }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, []);

  // Swap the document when a note is put into the editor (showNote sets path,
  // savedContent and currentFileContent together).
  //  • The document mirrors currentFileContent — NOT savedContent: a finished
  //    save sets savedContent to the text as of when the save started, and
  //    copying that back here erased whatever was typed during the write.
  //  • A plain effect(), not useSignalEffect: that one waits for the next frame,
  //    and a keystroke landing in between went into the previous note's
  //    document while currentFilePath already named the new note — the old
  //    note's whole text was then saved under the new one.
  useEffect(() => effect(() => {
    const path = currentFilePath.value;
    void savedContent.value; // re-run when a note is (re)loaded
    const view = viewRef.current;
    const content = currentFileContent.peek();
    if (!view || path === null) return;
    //  • Undo history never crosses notes. Switching used to be an ordinary
    //    transaction in one shared history: Cmd+Z right after opening a note
    //    "undid" the switch — the previous note's text (or nothing) landed in
    //    this note and autosave wrote it. A different note gets a fresh state.
    if (path !== shownPath.current) {
      shownPath.current = path;
      view.setState(EditorState.create({ doc: content, extensions: getExtensions() }));
      return;
    }
    //  • Same note, text replaced from outside (another tab, sync): not an edit
    //    of the user's, so undo must not step back across it.
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        annotations: Transaction.addToHistory.of(false),
      });
    }
  }), []);

  // Sync theme
  useSignalEffect(() => {
    const view = viewRef.current;
    const t = theme.value;
    if (!view) return;
    view.dispatch({ effects: themeCompartment.reconfigure(t === 'dark' ? oneDark : lightTheme) });
  });

  // Sync font size
  useSignalEffect(() => {
    const view = viewRef.current;
    const s = settings.value;
    if (!view) return;
    view.dispatch({ effects: fontSizeCompartment.reconfigure(fontSizeTheme(s.fontSize)) });
  });

  // Sync line numbers
  useSignalEffect(() => {
    const view = viewRef.current;
    const s = settings.value;
    if (!view) return;
    view.dispatch({ effects: lineNumbersCompartment.reconfigure(s.editorLineNumbers ? lineNumbers() : []) });
  });

  return <div ref={containerRef} class="editor-pane" />;
}
