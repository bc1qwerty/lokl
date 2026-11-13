# Lokl

**Browser-based, offline-first personal knowledge base.**

Your notes stay in your browser unless you turn on sync. No account needed; sync is an optional paid add-on.

## Features

- **Local Storage** — Notes live in the browser's own database (IndexedDB); import an existing folder of markdown files once to get started
- **Auto-save, Trash, Backup** — Edits save as you type, deleted notes stay in Trash for 30 days, and everything exports to JSON or a ZIP of `.md` files
- **Markdown Editor** — CodeMirror 6 with syntax highlighting and live preview
- **[[Wiki-links]]** — Link between notes with `[[note-name]]` syntax
- **Backlinks** — See every note that links to the current one
- **Full-text Search** — Instant fuzzy search across all your notes (Cmd+K)
- **Quick Open** — Jump to any file instantly (Cmd+P)
- **Tags** — `#tag` extraction from content and YAML frontmatter
- **Graph View** — Visualize connections between your notes
- **Daily Notes** — One-click daily journal entry
- **Tabs** — Work with multiple files simultaneously
- **Dark / Light Theme** — Automatic or manual toggle
- **PWA** — Install as a desktop app, works offline
- **i18n** — English, Korean, Japanese

## How It Works

Notes are stored in the browser with [PouchDB](https://pouchdb.com/) (IndexedDB). A folder of markdown files can be imported on first run through the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API); after that Lokl works on its own copy and does not write back to the folder — use Settings → Export to get files out. Nothing is uploaded unless you sign in and turn on the optional paid sync, which replicates your notes to `api.txid.uk`.

Because the notes live in browser storage, clearing site data removes them. Export a backup, or turn on sync, for anything you cannot afford to lose.

| | Obsidian | Notion | **Lokl** |
|---|---|---|---|
| Install required | Yes (Electron) | No | **No (browser)** |
| Works offline | Yes | Limited | **Yes (PWA)** |
| Where notes live | Local files | Cloud | **Your browser** |
| Sync | $8/mo | Built-in | **Your choice** |
| Wiki-links | Yes | No | **Yes** |
| Open source | No | No | **Yes** |

## Quick Start

**Try it now:** [https://lokl.txid.uk/](https://lokl.txid.uk/)

Or run locally:

```bash
git clone https://github.com/bc1qwerty/lokl.git
cd lokl
npm install
npm run dev
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + K` | Search notes |
| `Cmd/Ctrl + P` | Quick open file |
| `Cmd/Ctrl + N` | New file |
| `Cmd/Ctrl + S` | Save |
| `Cmd/Ctrl + \` | Toggle sidebar |
| `Cmd/Ctrl + =/-` | Increase/decrease font size |
| `Esc` | Close dialog |

## Browser Support

| Browser | Support |
|---|---|
| Chrome / Edge / Arc / Brave | Full, including folder import |
| Firefox / Safari | Full editing; no folder import (start fresh or import a JSON backup) |

Editing, search and sync only need IndexedDB. The File System Access API is used for the one-time folder import.

## Deployment

lokl.txid.uk is a static build served from a VPS. Pushing a `v*` tag runs the tests and deploys (`.github/workflows/deploy.yml`).

## Tech Stack

- [Preact](https://preactjs.com/) + [Preact Signals](https://preactjs.com/guide/v10/signals/)
- [Vite](https://vite.dev/)
- [CodeMirror 6](https://codemirror.net/)
- [PouchDB](https://pouchdb.com/)
- [MiniSearch](https://lucaong.github.io/minisearch/)
- [marked](https://marked.js.org/)

## License

MIT
